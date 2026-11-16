import type { TocItem } from 'foliate-js/epub.js'
import {
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useMemo,
	useCallback,
	useRef,
	useState,
	type Dispatch,
	type MutableRefObject,
	type ReactNode,
	type SetStateAction,
} from 'react'

import { Icon } from '#components/reader/Icon'
import { ReaderProgress } from '#components/reader/ReaderProgress'
import { useReaderChrome } from '#components/reader/useReaderChrome'
import { openImageArchive } from '#lib/reader/archive'
import { openEpub } from '#lib/reader/epub'
import type { EpubSession } from '#lib/reader/epub-types'
import { bindHostInput } from '#lib/reader/input'
import { columnsForWidth, nextLead, visibleIndices } from '#lib/reader/layout'
import { animatePage, type SwipeDirection } from '#lib/reader/motion'
import {
	refreshPositionSession,
	rollbackPositionSession,
} from '#lib/reader/position-session'
import {
	hashBook,
	loadPosition,
	savePosition,
	syncPosition,
	adoptRemotePosition,
	chooseLocalPosition,
	chooseRemotePosition,
} from '#lib/reader/positions'
import type { RemotePosition } from '#lib/reader/positions'
import type { ReaderSettings } from '#lib/reader/preferences'

import styles from '#components/reader/Reader.module.css'

type Archive = Awaited<ReturnType<typeof openImageArchive>>
type Session =
	| { kind: 'zip'; archive: Archive }
	| { kind: 'epub'; epub: EpubSession; bookId?: string }
interface ReaderProps {
	file: File
	settings: ReaderSettings
	active: boolean
	onClose: () => void
	onSettings: () => void
}

const messageFor = (cause: unknown) =>
	cause instanceof Error ? cause.message : 'ファイルを開けませんでした。'

const syncMessages = {
	auth: 'ログインすると同期できます。',
	conflict: '同期に競合があります。',
	pending: '同期は保留中です。',
	synced: '同期済み',
}

interface TocProps {
	items: TocItem[]
	goTo: (href: string) => void
}

const Toc = ({ items, goTo }: TocProps) => (
	<>
		{items.map((item, index) => (
			<div key={`${item.href}-${index}`}>
				<button onClick={() => goTo(item.href)}>{item.label}</button>
				{item.subitems?.length ? (
					<div className={styles.subToc}>
						<Toc items={item.subitems} goTo={goTo} />
					</div>
				) : null}
			</div>
		))}
	</>
)

interface ZipRefs {
	generation: MutableRefObject<number>
	session: MutableRefObject<Session | null>
	queue: MutableRefObject<Promise<void>>
	lead: MutableRefObject<number>
	columns: MutableRefObject<1 | 2>
	animation: MutableRefObject<Animation | null>
	swipe: MutableRefObject<SwipeDirection | null>
	imageRequest: MutableRefObject<number>
	active: MutableRefObject<boolean>
	firstPageSingle: MutableRefObject<boolean>
}
interface ZipSetters {
	setIndices: Dispatch<SetStateAction<number[]>>
	setUrls: Dispatch<SetStateAction<string[]>>
	setProgress: Dispatch<SetStateAction<number>>
	setAtEnd: Dispatch<SetStateAction<boolean>>
	setError: Dispatch<SetStateAction<string>>
}
const updateZip = async (
	archive: Archive,
	lead: number,
	id: number,
	refs: ZipRefs,
	setters: ZipSetters,
	swipeDirection?: SwipeDirection,
) => {
	const request = ++refs.imageRequest.current
	const columns = refs.columns.current
	const count = refs.firstPageSingle.current && lead === 0 ? 1 : columns
	const indices = visibleIndices(lead, archive.names.length, count)
	const urls = await Promise.all(indices.map((index) => archive.getUrl(index)))
	if (
		refs.generation.current !== id ||
		refs.imageRequest.current !== request ||
		refs.session.current?.kind !== 'zip'
	)
		return
	refs.lead.current = lead
	refs.swipe.current = swipeDirection ?? null
	setters.setError('')
	setters.setIndices(indices)
	setters.setUrls(urls)
	setters.setProgress(
		Math.round(((lead + indices.length) / archive.names.length) * 100),
	)
	setters.setAtEnd(lead + indices.length >= archive.names.length)
}
const scheduleZipUpdate = (refs: ZipRefs, setters: ZipSetters) => {
	const id = refs.generation.current
	refs.queue.current = refs.queue.current
		.then(async () => {
			if (!refs.active.current || refs.generation.current !== id) return
			const current = refs.session.current
			if (current?.kind !== 'zip') return
			await updateZip(current.archive, refs.lead.current, id, refs, setters)
		})
		.catch((cause) => {
			if (refs.generation.current === id) setters.setError(messageFor(cause))
		})
}

const scheduleTurn = (
	next: boolean,
	swipeDirection: SwipeDirection | undefined,
	refs: ZipRefs,
	setters: ZipSetters,
) => {
	const id = refs.generation.current
	refs.queue.current = refs.queue.current
		.then(async () => {
			if (!refs.active.current || refs.generation.current !== id) return
			const current = refs.session.current
			if (!current) return
			if (current.kind === 'epub') {
				await (next ? current.epub.next() : current.epub.prev())
				return
			}
			const currentLead = refs.lead.current
			const cover =
				refs.firstPageSingle.current &&
				refs.columns.current === 2 &&
				currentLead === 0
			const step = cover ? 1 : refs.columns.current
			const minimumPreviousLead =
				!next &&
				refs.firstPageSingle.current &&
				refs.columns.current === 2 &&
				currentLead > 1
					? 1
					: 0
			const lead = next
				? nextLead(currentLead, current.archive.names.length, step)
				: Math.max(minimumPreviousLead, currentLead - step)
			if (lead === refs.lead.current) return
			refs.animation.current?.cancel()
			refs.animation.current = null
			await updateZip(current.archive, lead, id, refs, setters, swipeDirection)
		})
		.catch((cause) => {
			if (refs.generation.current === id) setters.setError(messageFor(cause))
		})
}

interface ReaderStageProps {
	archive: Archive | null
	indices: number[]
	urls: string[]
	host: React.RefObject<HTMLDivElement | null>
	padding: string
	gutter: number
	count: number
	loading: boolean
	error: string
	setError: Dispatch<SetStateAction<string>>
	cover: boolean
}

const ReaderStage = ({
	archive,
	indices,
	urls,
	host,
	padding,
	gutter,
	count,
	loading,
	error,
	setError,
	cover,
}: ReaderStageProps) => (
	<main
		className={styles.pages}
		aria-label="読書ページ"
		ref={host}
		style={{ padding }}
	>
		{archive && (
			<div
				className={styles.imagePair}
				style={{
					gap: gutter,
					width: cover ? `calc((100% - ${gutter}px) / 2)` : undefined,
				}}
			>
				{urls.map((url, index) => (
					<img
						key={indices[index]}
						className={styles.pageImage}
						src={url}
						alt={`画像 ${indices[index] + 1} / ${count}`}
						onError={() => setError('画像を読み込めませんでした。')}
					/>
				))}
			</div>
		)}
		{loading && <output className={styles.message}>本を開いています…</output>}
		{error && (
			<p className={styles.error} role="alert">
				{error}
			</p>
		)}
	</main>
)

interface OpenReaderFileOptions {
	file: File
	id: number
	active: boolean
	settings: ReaderSettings
	host: HTMLElement
	signal: AbortSignal
	refs: ZipRefs
	setters: ZipSetters
	setArchive: Dispatch<SetStateAction<Archive | null>>
	setToc: Dispatch<SetStateAction<TocItem[]>>
	setDirection: Dispatch<SetStateAction<'ltr' | 'rtl'>>
	setHasSession: Dispatch<SetStateAction<boolean>>
	setPositionStatus: Dispatch<SetStateAction<string>>
	setRemoteCFI: Dispatch<SetStateAction<RemotePosition | undefined>>
	setConflictPosition: (value: RemotePosition | null | undefined) => void
	refreshPosition: (options: {
		epub: EpubSession
		bookId: string
		id: number
		signal: AbortSignal
	}) => Promise<void>
}

const loadInitialPosition = async ({
	file,
	id,
	signal,
	refs,
	setPositionStatus,
}: Pick<
	OpenReaderFileOptions,
	'file' | 'id' | 'signal' | 'refs' | 'setPositionStatus'
>) => {
	let bookId: string | undefined
	let initialCFI: string | undefined
	try {
		bookId = await hashBook(file)
		initialCFI = (await loadPosition(bookId))?.cfi
	} catch {
		if (!signal.aborted && refs.generation.current === id)
			setPositionStatus('端末内の読書位置を利用できません。')
	}
	return { bookId, initialCFI }
}

const openEpubFile = async ({
	file,
	id,
	active,
	settings,
	host,
	signal,
	refs,
	setters,
	setToc,
	setDirection,
	setHasSession,
	setPositionStatus,
	setConflictPosition,
	refreshPosition,
}: OpenReaderFileOptions) => {
	const { bookId, initialCFI } = await loadInitialPosition({
		file,
		id,
		signal,
		refs,
		setPositionStatus,
	})
	if (signal.aborted) return
	const epub = await openEpub({
		initialCFI,
		onConfirmedPosition: (cfi) => {
			if (!bookId || signal.aborted || refs.generation.current !== id) return
			setPositionStatus('端末に保存中…')
			void savePosition(bookId, cfi)
				.then(async () => {
					if (signal.aborted || refs.generation.current !== id) return
					setPositionStatus('端末に保存しました。同期中…')
					const status = await syncPosition(bookId!)
					if (signal.aborted || refs.generation.current !== id) return
					const saved = await loadPosition(bookId!)
					if (signal.aborted || refs.generation.current !== id) return
					if (saved?.conflict !== undefined) setConflictPosition(saved.conflict)
					if (status === 'auth') {
						setPositionStatus(syncMessages.auth)
						return
					}
					if (saved?.conflict !== undefined || status === 'conflict') {
						setPositionStatus(syncMessages.conflict)
						return
					}
					setPositionStatus(
						saved?.pending || status === 'pending'
							? syncMessages.pending
							: '端末に保存し、同期しました。',
					)
				})
				.catch(() => {
					if (!signal.aborted && refs.generation.current === id)
						setPositionStatus('読書位置を保存できません。')
				})
		},
		file,
		host,
		settings,
		columns: refs.columns.current,
		active,
		signal,
		onLocation: (location) => {
			if (signal.aborted || refs.generation.current !== id) return
			setters.setProgress(Math.round(location.progress))
			setters.setAtEnd(location.atEnd)
		},
		onError: (cause) => {
			if (!signal.aborted && refs.generation.current === id)
				setters.setError(cause.message)
		},
	})
	if (signal.aborted) {
		await epub.close()
		return
	}
	refs.session.current = { kind: 'epub', epub, bookId }
	setHasSession(true)
	setDirection(epub.dir)
	setToc(epub.toc)
	if (epub.initialRestoreFailed)
		setPositionStatus('保存した位置を開けず、先頭から表示しています。')
	if (bookId) void refreshPosition({ epub, bookId, id, signal })
}

const openReaderFile = async (options: OpenReaderFileOptions) => {
	const { file, id, signal, refs, setters, setArchive, setHasSession } = options
	if (file.name.toLowerCase().endsWith('.zip')) {
		const archive = await openImageArchive(file)
		if (signal.aborted) {
			await archive.close()
			return
		}
		refs.session.current = { kind: 'zip', archive }
		setHasSession(true)
		setArchive(archive)
		await updateZip(archive, 0, id, refs, setters)
		return
	}
	if (file.name.toLowerCase().endsWith('.epub')) return openEpubFile(options)
	throw new Error('EPUBまたは画像ZIPを選んでください。')
}
const useResizeColumns = (
	host: React.RefObject<HTMLDivElement | null>,
	settings: ReaderSettings,
	columnsRef: MutableRefObject<1 | 2>,
	setColumns: Dispatch<SetStateAction<1 | 2>>,
) => {
	useEffect(() => {
		const node = host.current
		if (!node) return
		const observe = (width: number) => {
			const count = columnsForWidth(settings.spread, width)
			columnsRef.current = count
			setColumns(count)
		}
		const observer = new ResizeObserver(([entry]) =>
			observe(entry.contentRect.width),
		)
		observer.observe(node)
		const computed = getComputedStyle(node)
		observe(
			node.clientWidth -
				Number.parseFloat(computed.paddingLeft) -
				Number.parseFloat(computed.paddingRight),
		)
		return () => observer.disconnect()
	}, [
		host,
		settings.spread,
		settings.marginLeft,
		settings.marginRight,
		columnsRef,
		setColumns,
	])
}
const useOpenFile = ({
	file,
	active,
	settings,
	host,
	refs,
	setters,
	setArchive,
	setToc,
	setUrls,
	setShowToc,
	setLoading,
	setDirection,
	setHasSession,
	setPositionStatus,
	setRemoteCFI,
	setConflictPosition,
	refreshPosition,
}: {
	file: File
	active: boolean
	settings: ReaderSettings
	host: React.RefObject<HTMLDivElement | null>
	refs: ZipRefs
	setters: ZipSetters
	setArchive: Dispatch<SetStateAction<Archive | null>>
	setToc: Dispatch<SetStateAction<TocItem[]>>
	setUrls: Dispatch<SetStateAction<string[]>>
	setShowToc: Dispatch<SetStateAction<boolean>>
	setLoading: Dispatch<SetStateAction<boolean>>
	setDirection: Dispatch<SetStateAction<'ltr' | 'rtl'>>
	setHasSession: Dispatch<SetStateAction<boolean>>
	setPositionStatus: Dispatch<SetStateAction<string>>
	setRemoteCFI: Dispatch<SetStateAction<RemotePosition | undefined>>
	setConflictPosition: (value: RemotePosition | null | undefined) => void
	refreshPosition: OpenReaderFileOptions['refreshPosition']
}) => {
	const currentOpenOptions = useEffectEvent(() => ({ active, settings }))
	useEffect(() => {
		const { generation: generationRef, lead: leadRef } = refs
		const controller = new AbortController()
		const id = ++generationRef.current
		const hostNode = host.current
		if (!hostNode) return
		const { active: currentActive, settings: currentSettings } =
			currentOpenOptions()
		setLoading(true)
		setters.setError('')
		setters.setProgress(0)
		setters.setAtEnd(false)
		setArchive(null)
		setUrls([])
		setters.setIndices([])
		setToc([])
		setDirection('ltr')
		setHasSession(false)
		setPositionStatus('')
		setRemoteCFI(undefined)
		setConflictPosition(undefined)
		setShowToc(false)
		leadRef.current = 0
		void openReaderFile({
			file,
			id,
			active: currentActive,
			settings: currentSettings,
			host: hostNode,
			signal: controller.signal,
			refs,
			setters,
			setArchive,
			setToc,
			setDirection,
			setHasSession,
			setPositionStatus,
			setRemoteCFI,
			setConflictPosition,
			refreshPosition,
		})
			.then(() => {
				if (!controller.signal.aborted && generationRef.current === id)
					setLoading(false)
			})
			.catch((cause) => {
				if (generationRef.current !== id || controller.signal.aborted) return
				setters.setError(messageFor(cause))
				setLoading(false)
			})
		const {
			animation: animationRef,
			session: sessionRef,
			swipe: swipeRef,
		} = refs
		return () => {
			controller.abort()
			generationRef.current++
			animationRef.current?.cancel()
			animationRef.current = null
			swipeRef.current = null
			const previous = sessionRef.current
			sessionRef.current = null
			if (previous?.kind === 'zip') void previous.archive.close()
			if (previous?.kind === 'epub') void previous.epub.close()
		}
	}, [
		file,
		host,
		refs,
		setters,
		setLoading,
		setArchive,
		setUrls,
		setToc,
		setDirection,
		setShowToc,
		setHasSession,
		setPositionStatus,
		setRemoteCFI,
		setConflictPosition,
		refreshPosition,
	])
}

interface PositionStatusProps {
	positionStatus: string
	remoteAvailable: boolean
	useRemote: () => void
	busy: boolean
	conflict: boolean
	useLocal: () => void
}

const PositionStatus = ({
	positionStatus,
	remoteAvailable,
	useRemote,
	busy,
	conflict,
	useLocal,
}: PositionStatusProps) =>
	positionStatus || conflict || remoteAvailable ? (
		<output className={styles.positionStatus}>
			{positionStatus}
			{conflict ? (
				<>
					<button disabled={busy} onClick={useLocal}>
						この端末の位置を使う
					</button>
					{remoteAvailable && (
						<button disabled={busy} onClick={useRemote}>
							別端末の位置を使う
						</button>
					)}
				</>
			) : remoteAvailable ? (
				<button disabled={busy} onClick={useRemote}>
					別端末の位置に移動
				</button>
			) : null}
		</output>
	) : null

interface ReaderControlsProps {
	onClose: () => void
	onSettings: () => void
	toc: TocItem[]
	showToc: boolean
	toggleToc: () => void
	goTo: (href: string) => void
	loading: boolean
	atEnd: boolean
	hasSession: boolean
	error: string
	count: number
	currentIndex: number
	indices: number[]
	progress: number
	direction: 'ltr' | 'rtl'
	headerVisible: boolean
	footerVisible: boolean
	title: string
	dialog: React.RefObject<HTMLDialogElement | null>
	closeToc: () => void
	children: ReactNode
	positionStatus: string
	remoteAvailable: boolean
	useRemote: () => void
	busy: boolean
	conflict: boolean
	useLocal: () => void
}

const ReaderControls = ({
	title,
	dialog,
	closeToc,
	children,
	positionStatus,
	remoteAvailable,
	useRemote,
	busy,
	conflict,
	useLocal,
	onClose,
	onSettings,
	toc,
	showToc,
	toggleToc,
	goTo,
	loading,
	atEnd,
	hasSession,
	error,
	count,
	currentIndex,
	indices,
	progress,
	direction,
	headerVisible,
	footerVisible,
}: ReaderControlsProps) => (
	<>
		<header
			className={`${styles.toolbar} ${headerVisible ? '' : styles.hidden}`}
		>
			<button aria-label="本を閉じる" title="本を閉じる" onClick={onClose}>
				<Icon name="close" />
			</button>
			<span className={styles.bookTitle} title={title}>
				{title}
			</span>
			<div className={styles.toolbarActions}>
				<button
					aria-label="目次"
					title="目次"
					aria-haspopup="dialog"
					aria-expanded={showToc}
					aria-controls="reader-toc-dialog"
					disabled={toc.length === 0}
					onClick={toggleToc}
				>
					<Icon name="toc" />
				</button>
				<button aria-label="設定" title="設定" onClick={onSettings}>
					<Icon name="settings" />
				</button>
			</div>
		</header>
		{children}
		<footer
			className={`${styles.footer} ${footerVisible ? '' : styles.hidden}`}
			dir={direction}
		>
			<PositionStatus
				positionStatus={positionStatus}
				remoteAvailable={remoteAvailable}
				useRemote={useRemote}
				busy={busy}
				conflict={conflict}
				useLocal={useLocal}
			/>
			<ReaderProgress
				count={count}
				currentIndex={currentIndex}
				indices={indices}
				progress={progress}
				atEnd={atEnd}
				loading={loading}
				unavailable={Boolean(error) && !hasSession}
				direction={direction}
			/>
		</footer>
		{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- native dialog backdrop clicks dismiss; Escape and the close button provide keyboard dismissal. */}
		<dialog
			ref={dialog}
			id="reader-toc-dialog"
			className={styles.tocDialog}
			tabIndex={-1}
			aria-labelledby="reader-toc-heading"
			onCancel={(event) => {
				event.preventDefault()
				closeToc()
			}}
			onClose={closeToc}
			onKeyDownCapture={(event) => event.stopPropagation()}
			onClick={(event) => {
				const rect = event.currentTarget.getBoundingClientRect()
				if (
					event.target === event.currentTarget &&
					(event.clientX < rect.left ||
						event.clientX > rect.right ||
						event.clientY < rect.top ||
						event.clientY > rect.bottom)
				)
					closeToc()
			}}
		>
			<div className={styles.tocHeading}>
				<h2 id="reader-toc-heading">目次</h2>
				<button aria-label="目次を閉じる" onClick={closeToc}>
					閉じる
				</button>
			</div>
			<nav aria-label="目次">
				<Toc items={toc} goTo={goTo} />
			</nav>
		</dialog>
	</>
)

export const Reader = ({
	file,
	settings,
	active,
	onClose,
	onSettings,
}: ReaderProps) => {
	const host = useRef<HTMLDivElement>(null)
	const tocDialog = useRef<HTMLDialogElement>(null)
	const session = useRef<Session | null>(null)
	const generation = useRef(0)
	const queue = useRef<Promise<void>>(Promise.resolve())
	const leadRef = useRef(0)
	const columnsRef = useRef<1 | 2>(1)
	const animation = useRef<Animation | null>(null)
	const swipe = useRef<SwipeDirection | null>(null)
	const imageRequest = useRef(0)
	const activeRef = useRef(active)
	const firstPageSingleRef = useRef(settings.firstPageSingle)
	const [columns, setColumns] = useState<1 | 2>(1)
	const [archive, setArchive] = useState<Archive | null>(null)
	const [urls, setUrls] = useState<string[]>([])
	const [indices, setIndices] = useState<number[]>([])
	const [toc, setToc] = useState<TocItem[]>([])
	const [showToc, setShowToc] = useState(false)
	const [direction, setDirection] = useState<'ltr' | 'rtl'>('ltr')
	const [progress, setProgress] = useState(0)
	const [atEnd, setAtEnd] = useState(false)
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(true)
	const [hasSession, setHasSession] = useState(false)
	const pinned = loading || Boolean(error) || showToc
	const { headerVisible, footerVisible } = useReaderChrome({
		active,
		file,
		pinned,
	})
	const [positionStatus, setPositionStatus] = useState('')
	const [remotePosition, setRemoteCFI] = useState<RemotePosition | undefined>()
	const [hasConflict, setHasConflict] = useState(false)
	const [choiceBusy, setChoiceBusy] = useState(false)
	const choiceInFlight = useRef(false)
	const positionQueue = useRef<Promise<void>>(Promise.resolve())
	const handleConflictPosition = useCallback(
		(value: RemotePosition | null | undefined) => {
			setHasConflict(value !== undefined)
			setRemoteCFI(value ?? undefined)
		},
		[],
	)

	const refs = useMemo<ZipRefs>(
		() => ({
			generation,
			session,
			queue,
			lead: leadRef,
			columns: columnsRef,
			animation,
			swipe,
			imageRequest,
			active: activeRef,
			firstPageSingle: firstPageSingleRef,
		}),
		[],
	)
	const setters = useMemo<ZipSetters>(
		() => ({
			setIndices,
			setUrls,
			setProgress,
			setAtEnd,
			setError,
		}),
		[],
	)
	const turn = useCallback(
		(next: boolean, swipeDirection?: SwipeDirection) =>
			scheduleTurn(next, swipeDirection, refs, setters),
		[refs, setters],
	)

	useLayoutEffect(() => {
		activeRef.current = active
		firstPageSingleRef.current = settings.firstPageSingle
	}, [active, settings.firstPageSingle])

	useLayoutEffect(() => {
		const element = tocDialog.current
		if (!element) return
		const shouldShowToc = active && showToc
		if (shouldShowToc && !element.open) element.showModal()
		if (!shouldShowToc && element.open) element.close()
	}, [active, showToc])

	const refreshPosition = useCallback<OpenReaderFileOptions['refreshPosition']>(
		(options) => {
			const run = async () => {
				if (choiceInFlight.current) return
				const { epub, bookId, id, signal } = options
				const result = await refreshPositionSession({
					bookId,
					epub,
					isCurrent: () =>
						!signal.aborted &&
						generation.current === id &&
						!choiceInFlight.current &&
						session.current?.kind === 'epub' &&
						session.current.epub === epub,
				})
				if (
					signal.aborted ||
					generation.current !== id ||
					choiceInFlight.current
				)
					return
				handleConflictPosition(result.conflict)
				if (result.remote) setRemoteCFI(result.remote)
				if (!result.status) return
				setPositionStatus((previous) => {
					const restored = [
						'別端末の位置に移動しました。',
						'端末の新しい位置を保持しました。',
					].includes(result.status)
					return previous ===
						'保存した位置を開けず、先頭から表示しています。' && !restored
						? previous
						: (syncMessages[result.status as keyof typeof syncMessages] ??
								result.status)
				})
			}
			positionQueue.current = positionQueue.current.catch(() => {}).then(run)
			return positionQueue.current
		},
		[handleConflictPosition],
	)

	useResizeColumns(host, settings, columnsRef, setColumns)
	useEffect(() => {
		const retry = () => {
			const current = session.current
			const id = generation.current
			if (
				current?.kind !== 'epub' ||
				!current.bookId ||
				document.visibilityState === 'hidden'
			)
				return
			if (choiceInFlight.current) return
			void refreshPosition({
				epub: current.epub,
				bookId: current.bookId,
				id,
				signal: new AbortController().signal,
			})
		}
		window.addEventListener('online', retry)
		document.addEventListener('visibilitychange', retry)
		return () => {
			window.removeEventListener('online', retry)
			document.removeEventListener('visibilitychange', retry)
		}
	}, [file, refreshPosition])
	useEffect(() => {
		const current = session.current
		if (current?.kind === 'epub') void current.epub.configure(settings, columns)
		if (current?.kind === 'zip' && archive) scheduleZipUpdate(refs, setters)
	}, [settings, columns, loading, archive, refs, setters])

	useEffect(() => {
		const current = session.current
		if (current?.kind === 'epub') current.epub.setActive(active)
		if (!active) {
			animation.current?.cancel()
			animation.current = null
			swipe.current = null
			return
		}
		if (!host.current || current?.kind !== 'zip') return
		scheduleZipUpdate(refs, setters)
		return bindHostInput(host.current, 'ltr', turn)
	}, [active, loading, refs, setters, turn])

	useOpenFile({
		file,
		active,
		settings,
		host,
		refs,
		setters,
		setArchive,
		setToc,
		setUrls,
		setShowToc,
		setLoading,
		setDirection,
		setHasSession,
		setPositionStatus,
		setRemoteCFI,
		setConflictPosition: handleConflictPosition,
		refreshPosition,
	})

	useLayoutEffect(() => {
		const direction = swipe.current
		swipe.current = null
		if (direction && activeRef.current)
			animatePage(
				host.current?.querySelector(`.${styles.imagePair}`) ?? null,
				direction,
				animation,
			)
	}, [urls])

	const goTo = (href: string) => {
		setShowToc(false)
		const current = session.current
		if (current?.kind === 'epub') void current.epub.goTo(href)
	}
	const useRemote = () => {
		if (choiceInFlight.current) return
		const current = session.current
		const id = generation.current
		const candidate = remotePosition
		if (current?.kind !== 'epub' || !current.bookId || !candidate) return
		choiceInFlight.current = true
		setChoiceBusy(true)
		current.epub.markTouched()
		const checkpoint = current.epub.checkpoint()
		const bookId = current.bookId
		void (async () => {
			try {
				const local = await loadPosition(bookId)
				if (generation.current !== id || session.current !== current) return
				const restored = await current.epub.restore(
					candidate.cfi,
					false,
					checkpoint.epoch,
				)
				if (
					generation.current !== id ||
					session.current !== current ||
					!restored
				)
					return
				const chosen = local
					? await chooseRemotePosition(bookId, candidate, local.mutationId)
					: await adoptRemotePosition(bookId, candidate, undefined).then(
							(adopted) => (adopted ? candidate.cfi : undefined),
						)
				if (generation.current !== id || session.current !== current) return
				if (!chosen) {
					await rollbackPositionSession(
						{
							bookId,
							epub: current.epub,
							isCurrent: () =>
								generation.current === id && session.current === current,
						},
						checkpoint,
					)
					if (generation.current !== id || session.current !== current) return
					setPositionStatus('同期に競合があります。')
					return
				}
				setRemoteCFI(undefined)
				setHasConflict(false)
				setPositionStatus('別端末の位置に移動しました。')
			} catch {
				if (generation.current === id && session.current === current) {
					await rollbackPositionSession(
						{
							bookId,
							epub: current.epub,
							isCurrent: () =>
								generation.current === id && session.current === current,
						},
						checkpoint,
					)
					if (generation.current === id && session.current === current)
						setPositionStatus('読書位置を保存できません。')
				}
			} finally {
				choiceInFlight.current = false
				setChoiceBusy(false)
			}
		})()
	}

	const useLocal = () => {
		if (choiceInFlight.current) return
		const current = session.current
		const id = generation.current
		if (current?.kind !== 'epub' || !current.bookId) return
		choiceInFlight.current = true
		setChoiceBusy(true)
		current.epub.markTouched()
		const bookId = current.bookId
		void (async () => {
			try {
				await chooseLocalPosition(bookId)
				if (generation.current !== id || session.current !== current) return
				const status = await syncPosition(bookId)
				if (generation.current !== id || session.current !== current) return
				const latest = await loadPosition(bookId)
				if (generation.current !== id || session.current !== current) return
				const conflicted = latest?.conflict !== undefined
				setHasConflict(conflicted)
				setRemoteCFI(latest?.conflict ?? undefined)
				setPositionStatus(syncMessages[status])
			} catch {
				if (generation.current === id && session.current === current)
					setPositionStatus('読書位置を保存できません。')
			} finally {
				choiceInFlight.current = false
				setChoiceBusy(false)
			}
		})()
	}

	const currentIndex = indices[0] ?? 0
	const count = archive?.names.length ?? 0
	const title = file.name.replace(/\.(epub|zip)$/i, '')
	const padding = `${settings.marginTop}px ${settings.marginRight}px ${settings.marginBottom}px ${settings.marginLeft}px`
	return (
		<section className={styles.reader} aria-label="読書画面">
			<h1 className={styles.srOnly}>{file.name}</h1>
			<ReaderControls
				onClose={onClose}
				onSettings={onSettings}
				toc={toc}
				showToc={showToc}
				toggleToc={() => setShowToc(!showToc)}
				goTo={goTo}
				loading={loading}
				atEnd={atEnd}
				hasSession={hasSession}
				error={error}
				count={count}
				currentIndex={currentIndex}
				indices={indices}
				progress={progress}
				direction={direction}
				headerVisible={headerVisible}
				footerVisible={footerVisible}
				title={title}
				positionStatus={positionStatus}
				remoteAvailable={Boolean(remotePosition)}
				useRemote={useRemote}
				busy={choiceBusy}
				conflict={hasConflict}
				useLocal={useLocal}
				dialog={tocDialog}
				closeToc={() => setShowToc(false)}
			>
				<ReaderStage
					archive={archive}
					indices={indices}
					urls={urls}
					host={host}
					padding={padding}
					gutter={settings.gutter}
					count={count}
					loading={loading}
					error={error}
					setError={setError}
					cover={
						settings.firstPageSingle && columns === 2 && currentIndex === 0
					}
				/>
			</ReaderControls>
		</section>
	)
}
