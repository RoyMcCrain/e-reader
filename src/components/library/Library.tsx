import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import { Bookshelf, BookshelfBook } from '#components/library/Bookshelf'
import { History } from '#components/library/History'
import { useReaderApp } from '#components/providers/ReaderProvider'
import { latestReadBook, sortBooks } from '#lib/library/bookshelf'
import { parseAuthorName, validBookMetadata } from '#lib/library/metadata'
import {
	listOfflineSaves,
	loadOfflineFile,
	removeOfflineBook,
	saveOfflineBook,
} from '#lib/library/offline-books'
import type { OfflineSave } from '#lib/library/offline-books'
import { fetchRecency } from '#lib/library/recency'
import type { CloudBook } from '#lib/library/types'

import styles from '#components/library/Library.module.css'

interface LibraryProps {
	cancelPending: RefObject<(() => void) | null>
	presentation?: 'list' | 'bookshelf' | 'series' | 'history'
	seriesName?: string
	returnFromSeries?: boolean
	seriesFrom?: SeriesFrom
}

const formatSize = (size: number) =>
	size < 1024 * 1024
		? `${Math.max(1, Math.round(size / 1024))} KB`
		: `${(size / (1024 * 1024)).toFixed(1)} MB`
const validId = (id: unknown) =>
	typeof id === 'string' && /^[a-f\d]{64}$/i.test(id)
const validFormat = (format: unknown) => format === 'epub' || format === 'zip'
const validSize = (size: unknown) =>
	typeof size === 'number' && Number.isFinite(size) && size >= 0
const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const validBook = (value: unknown): value is CloudBook => {
	if (!isRecord(value)) return false
	const book = value
	return (
		validId(book.id) &&
		typeof book.name === 'string' &&
		validFormat(book.format) &&
		validSize(book.size) &&
		validBookMetadata(book)
	)
}

export const booksFromResponse = (value: unknown): CloudBook[] => {
	if (!isRecord(value) || !Array.isArray(value.books))
		throw new Error('Invalid book list response')
	return value.books.filter(validBook)
}

const getBooksError = (
	response: Response,
): 'auth' | 'offline' | 'unavailable' | '' => {
	if (response.status === 401 || response.status === 403) return 'auth'
	if (response.status === 503) return 'unavailable'
	return response.ok ? '' : 'offline'
}

const applyBooksResponse = async (
	response: Response,
	setBooks: (books: CloudBook[]) => void,
	setListError: (error: 'auth' | 'offline' | 'unavailable' | '') => void,
	controller: AbortController,
) => {
	if (controller.signal.aborted) return
	const error = getBooksError(response)
	if (error) {
		await response.body?.cancel()
		if (!controller.signal.aborted) setListError(error)
		return
	}
	const result: unknown = await response.json()
	if (!controller.signal.aborted) setBooks(booksFromResponse(result))
}

const loadBooks = async (
	setBooks: (books: CloudBook[]) => void,
	setListError: (error: 'auth' | 'offline' | 'unavailable' | '') => void,
	setLoading: (loading: boolean) => void,
	controller: AbortController,
) => {
	setLoading(true)
	setListError('')
	try {
		const response = await fetch('/api/books', {
			credentials: 'same-origin',
			signal: controller.signal,
		})
		await applyBooksResponse(response, setBooks, setListError, controller)
	} catch {
		if (!controller.signal.aborted) setListError('offline')
	} finally {
		if (!controller.signal.aborted) setLoading(false)
	}
}

const mimeType = (format: CloudBook['format']) =>
	format === 'epub' ? 'application/epub+zip' : 'application/zip'

const downloadBlob = async (
	book: CloudBook,
	signal: AbortSignal,
): Promise<Blob> => {
	const response = await fetch(`/api/books/${encodeURIComponent(book.id)}`, {
		credentials: 'same-origin',
		signal,
	})
	const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
	if (!response.ok || !contentType.includes(mimeType(book.format))) {
		await response.body?.cancel()
		throw new Error('download')
	}
	return response.blob()
}

const downloadBook = async (
	book: CloudBook,
	controller: AbortController,
	setFile: (file: File) => void,
) => {
	const blob = await downloadBlob(book, controller.signal)
	if (!controller.signal.aborted)
		setFile(new File([blob], book.name, { type: mimeType(book.format) }))
}

interface LibraryStateProps {
	loading: boolean
	listError: 'auth' | 'offline' | 'unavailable' | ''
	books: CloudBook[]
	retry: () => void
}

const LibraryState = ({
	loading,
	listError,
	books,
	retry,
}: LibraryStateProps) => {
	if (loading) return <p>本を確認しています…</p>
	switch (listError) {
		case 'auth':
			return (
				<p>
					本を読むにはログインが必要です。{' '}
					<a href="https://reader.rrrr.dev/">ログイン</a>
				</p>
			)
		case 'offline':
			return <p>本を確認できませんでした。</p>
		case 'unavailable':
			return (
				<div>
					<p>本は現在利用できません。</p>
					<button onClick={retry}>再試行</button>
				</div>
			)
		case '':
			return books.length === 0 ? <p>本はありません。</p> : null
	}
}

interface BookListProps {
	books: CloudBook[]
	busyId: string
	openBook: (book: CloudBook) => void
}

const BookList = ({ books, busyId, openBook }: BookListProps) =>
	books.length > 0 ? (
		<ul className={styles.books}>
			{books.map((book) => (
				<li key={book.id}>
					<button
						className={styles.book}
						aria-label={`${book.name}、${book.format.toUpperCase()}、${formatSize(book.size)}`}
						disabled={Boolean(busyId)}
						onClick={() => openBook(book)}
					>
						<span className={styles.name}>{book.name}</span>
						<span className={styles.metadata}>
							{book.format.toUpperCase()} · {formatSize(book.size)}
						</span>
					</button>
				</li>
			))}
		</ul>
	) : null

interface DownloadActions {
	setBusyId: (id: string) => void
	setDownloadError: (message: string) => void
	setFile: (file: File) => void
}

const downloadFailed =
	'本をダウンロードできませんでした。通信状況を確認して、もう一度お試しください。'
const offlineSaveFailed =
	'オフライン保存に失敗しました。通信状況を確認して、もう一度お試しください。'

const openSavedOrFail = async (
	book: CloudBook,
	actions: DownloadActions,
	signal: AbortSignal,
) => {
	const saved = await loadOfflineFile(book.id).catch(() => undefined)
	if (signal.aborted) return
	if (saved) actions.setFile(saved)
	else actions.setDownloadError(downloadFailed)
}

const openCloudBook = async (
	book: CloudBook,
	actions: DownloadActions,
	cancelPending: LibraryProps['cancelPending'],
) => {
	const controller = new AbortController()
	cancelPending.current = () => controller.abort()
	actions.setBusyId(book.id)
	actions.setDownloadError('')
	try {
		await downloadBook(book, controller, actions.setFile)
	} catch {
		if (!controller.signal.aborted)
			await openSavedOrFail(book, actions, controller.signal)
	} finally {
		if (!controller.signal.aborted) actions.setBusyId('')
	}
}

// Saved state lives in IndexedDB; this hook keeps the shelf's view in step with it.
const useOfflineSaves = (setDownloadError: (message: string) => void) => {
	const [savedBooks, setSavedBooks] = useState<OfflineSave[]>([])
	const [saveBusyId, setSaveBusyId] = useState('')
	const inFlight = useRef(new Set<string>())
	const reloadId = useRef(0)
	const reloadSaves = useCallback(() => {
		reloadId.current += 1
		const current = reloadId.current
		void listOfflineSaves().then(
			(saves) => {
				if (reloadId.current === current) setSavedBooks(saves)
			},
			() => {
				if (reloadId.current === current) setSavedBooks([])
			},
		)
	}, [])
	useEffect(() => {
		reloadSaves()
	}, [reloadSaves])
	const settle = async (bookId: string, action: () => Promise<void>) => {
		if (inFlight.current.has(bookId)) return
		inFlight.current.add(bookId)
		setSaveBusyId(bookId)
		setDownloadError('')
		try {
			await action()
		} catch {
			setDownloadError(offlineSaveFailed)
		} finally {
			inFlight.current.delete(bookId)
			setSaveBusyId((current) => (current === bookId ? '' : current))
			reloadSaves()
		}
	}
	const removeSave = (bookId: string) =>
		void settle(bookId, () => removeOfflineBook(bookId))
	const saveBook = (book: CloudBook) =>
		void settle(book.id, async () =>
			saveOfflineBook(
				book,
				await downloadBlob(book, new AbortController().signal),
			),
		)
	const toggleSave = (book: CloudBook) => {
		if (savedBooks.some((save) => save.bookId === book.id)) {
			removeSave(book.id)
		} else {
			saveBook(book)
		}
	}
	return { savedBooks, saveBusyId, toggleSave, removeSave }
}

interface SeriesDetailsProps {
	books: CloudBook[]
	seriesName?: string
	seriesFrom?: '/' | '/bookshelf' | '/history'
	loading: boolean
	listError: LibraryStateProps['listError']
	retry: () => void
	busyId: string
	openBook: (book: CloudBook) => void
	downloadError: string
}

const SeriesBookList = ({
	books,
	seriesName,
	loading,
	listError,
	busyId,
	openBook,
	latest,
}: SeriesDetailsProps & { latest?: ReturnType<typeof latestReadBook> }) => {
	const title = seriesName ?? 'シリーズ未設定'
	if (loading || listError) return null
	if (!books.length) return <p>このシリーズの本は見つかりません。</p>
	return (
		<ul className={styles.books} aria-label={`${title}の収録本`}>
			{sortBooks(books, 'title').map((book) => (
				<li
					key={book.id}
					className={book.id === latest?.book.id ? styles.latest : undefined}
					aria-current={book.id === latest?.book.id ? 'true' : undefined}
				>
					<BookshelfBook book={book} busyId={busyId} openBook={openBook} />
				</li>
			))}
		</ul>
	)
}

// Authors are de-duplicated in first-seen order across the series volumes.
const authorLabel = (books: CloudBook[]) =>
	[
		...new Set(
			books
				.map((book) => parseAuthorName(book.author))
				.filter((author) => author !== undefined),
		),
	].join('、')

type SeriesFrom = '/' | '/bookshelf' | '/history'

const SeriesBackLink = ({ from }: { from?: SeriesFrom }) =>
	from === '/' || from === '/history' ? (
		<Link to={from}>← 戻る</Link>
	) : (
		<Link to="/bookshelf" search={{ from: 'series' }}>
			← 戻る
		</Link>
	)

const loadRecency = (
	requestId: { current: number },
	setRecency: (values: Record<string, number>) => void,
) => {
	requestId.current += 1
	const current = requestId.current
	// Keep the previous mark while refetching or after a failed refetch.
	void fetchRecency().then((values) => {
		if (values && current === requestId.current) setRecency(values)
	})
}

// Loads read positions on mount and again after the reader closes.
const useLatestRead = (books: CloudBook[], ready: boolean) => {
	const { file } = useReaderApp()
	const [recency, setRecency] = useState<Record<string, number>>()
	const requestId = useRef(0)
	const wasOpen = useRef(false)
	useEffect(() => {
		loadRecency(requestId, setRecency)
		return () => {
			requestId.current += 1
		}
	}, [])
	useEffect(() => {
		if (file !== undefined) {
			wasOpen.current = true
			return
		}
		if (!wasOpen.current) return
		wasOpen.current = false
		loadRecency(requestId, setRecency)
	}, [file])
	return ready && recency ? latestReadBook(books, recency) : undefined
}

const SeriesProgress = ({
	latest,
	busyId,
	openBook,
}: {
	latest?: ReturnType<typeof latestReadBook>
	busyId: string
	openBook: (book: CloudBook) => void
}) => {
	if (!latest) return null
	return (
		<button
			className={styles.resume}
			aria-label={`続きを読む、${latest.book.name}`}
			disabled={Boolean(busyId)}
			onClick={() => openBook(latest.book)}
		>
			続きを読む
			<span>{latest.book.name.replace(/\.(epub|zip)$/i, '')}</span>
		</button>
	)
}

const SeriesDetails = (props: SeriesDetailsProps) => {
	const {
		books,
		seriesName,
		loading,
		listError,
		retry,
		busyId,
		downloadError,
		seriesFrom,
	} = props

	const title = seriesName ?? 'シリーズ未設定'
	const selected = books.filter((book) => book.series === seriesName)
	const authors = seriesName === undefined ? '' : authorLabel(selected)
	const ready = !loading && !listError
	const latest = useLatestRead(selected, ready)
	return (
		<main className={`${styles.library} ${styles.series}`}>
			<SeriesBackLink from={seriesFrom} />
			<h1>{title}</h1>
			{authors && <p>著者: {authors}</p>}
			{ready && <p>{selected.length} 冊</p>}
			<SeriesProgress
				latest={latest}
				busyId={busyId}
				openBook={props.openBook}
			/>
			<LibraryState
				loading={loading}
				listError={listError}
				books={books}
				retry={retry}
			/>
			<SeriesBookList {...props} books={selected} latest={latest} />
			{busyId && <output>本をダウンロードしています…</output>}
			{downloadError && (
				<p role="alert" className={styles.error}>
					{downloadError}
				</p>
			)}
		</main>
	)
}

export const Library = ({
	cancelPending,
	presentation = 'list',
	seriesName,
	returnFromSeries,
	seriesFrom,
}: LibraryProps) => {
	const { setFile } = useReaderApp()
	const [books, setBooks] = useState<CloudBook[]>([])
	const [loading, setLoading] = useState(true)
	const [listError, setListError] = useState<
		'auth' | 'offline' | 'unavailable' | ''
	>('')
	const [busyId, setBusyId] = useState('')
	const [downloadError, setDownloadError] = useState('')
	const listController = useRef<AbortController | null>(null)
	const { savedBooks, saveBusyId, toggleSave, removeSave } =
		useOfflineSaves(setDownloadError)
	const savedIds = new Set(savedBooks.map((save) => save.bookId))

	useEffect(() => {
		const controller = new AbortController()
		listController.current = controller
		void loadBooks(setBooks, setListError, setLoading, controller)
		return () => {
			listController.current?.abort()
			cancelPending.current?.()
			cancelPending.current = null
		}
	}, [cancelPending])

	const actions = { setBusyId, setDownloadError, setFile }
	const openBook = (book: CloudBook) => {
		if (!busyId) void openCloudBook(book, actions, cancelPending)
	}

	const retry = () => {
		listController.current?.abort()
		const controller = new AbortController()
		listController.current = controller
		void loadBooks(setBooks, setListError, setLoading, controller)
	}

	if (presentation === 'bookshelf')
		return (
			<Bookshelf
				books={books}
				loading={loading}
				listError={listError}
				retry={retry}
				busyId={busyId}
				openBook={openBook}
				downloadError={downloadError}
				returnFromSeries={returnFromSeries}
				savedIds={savedIds}
				saveBusyId={saveBusyId}
				onToggleSave={toggleSave}
				savedBooks={savedBooks}
				onRemoveSave={removeSave}
				onOpenSave={(save) =>
					openBook({
						id: save.bookId,
						name: save.name,
						format: save.format,
						size: save.size,
					})
				}
			/>
		)

	if (presentation === 'history')
		return (
			<History
				books={books}
				loading={loading}
				listError={listError}
				retry={retry}
				busyId={busyId}
				openBook={openBook}
				downloadError={downloadError}
			/>
		)

	if (presentation === 'series')
		return (
			<SeriesDetails
				books={books}
				seriesName={seriesName}
				seriesFrom={seriesFrom}
				loading={loading}
				listError={listError}
				retry={retry}
				busyId={busyId}
				openBook={openBook}
				downloadError={downloadError}
			/>
		)
	return (
		<section className={styles.library} aria-labelledby="library-heading">
			<h2 id="library-heading">本</h2>
			<LibraryState
				loading={loading}
				listError={listError}
				books={books}
				retry={() => {
					listController.current?.abort()
					const controller = new AbortController()
					listController.current = controller
					void loadBooks(setBooks, setListError, setLoading, controller)
				}}
			/>
			{!loading && !listError && (
				<BookList books={books} busyId={busyId} openBook={openBook} />
			)}
			{busyId && <output>本をダウンロードしています…</output>}
			{downloadError && (
				<p role="alert" className={styles.error}>
					{downloadError}
				</p>
			)}
		</section>
	)
}
