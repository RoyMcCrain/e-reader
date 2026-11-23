import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import { Bookshelf, BookshelfBook } from '#components/library/Bookshelf'
import { useReaderApp } from '#components/providers/ReaderProvider'
import { sortBooks } from '#lib/library/bookshelf'
import { validBookMetadata } from '#lib/library/metadata'
import type { CloudBook } from '#lib/library/types'

import styles from '#components/library/Library.module.css'

interface LibraryProps {
	cancelPending: RefObject<(() => void) | null>
	presentation?: 'list' | 'bookshelf' | 'series'
	seriesName?: string
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

const booksFromResponse = (value: unknown): CloudBook[] => {
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

const downloadBook = async (
	book: CloudBook,
	controller: AbortController,
	setFile: (file: File) => void,
) => {
	const response = await fetch(`/api/books/${encodeURIComponent(book.id)}`, {
		credentials: 'same-origin',
		signal: controller.signal,
	})
	const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
	const expectedType =
		book.format === 'epub' ? 'application/epub+zip' : 'application/zip'
	if (!response.ok || !contentType.includes(expectedType)) {
		await response.body?.cancel()
		throw new Error('download')
	}
	const blob = await response.blob()
	if (!controller.signal.aborted)
		setFile(new File([blob], book.name, { type: expectedType }))
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
	if (loading) return <p>クラウドの本を確認しています…</p>
	switch (listError) {
		case 'auth':
			return (
				<p>
					クラウドの本を読むにはログインが必要です。{' '}
					<a href="https://reader.rrrr.dev/">ログイン</a>
				</p>
			)
		case 'offline':
			return <p>クラウドの本を確認できませんでした。</p>
		case 'unavailable':
			return (
				<div>
					<p>クラウドの本は現在利用できません。</p>
					<button onClick={retry}>再試行</button>
				</div>
			)
		case '':
			return books.length === 0 ? <p>クラウドに本はありません。</p> : null
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
			actions.setDownloadError(
				'本をダウンロードできませんでした。通信状況を確認して、もう一度お試しください。',
			)
	} finally {
		if (!controller.signal.aborted) actions.setBusyId('')
	}
}

interface SeriesDetailsProps {
	books: CloudBook[]
	seriesName?: string
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
}: SeriesDetailsProps) => {
	const title = seriesName ?? 'シリーズ未設定'
	if (loading || listError) return null
	if (!books.length) return <p>このシリーズの本は見つかりません。</p>
	return (
		<ul className={styles.books} aria-label={`${title}の収録本`}>
			{sortBooks(books, 'title').map((book) => (
				<li key={book.id}>
					<BookshelfBook book={book} busyId={busyId} openBook={openBook} />
				</li>
			))}
		</ul>
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
	} = props

	const title = seriesName ?? 'シリーズ未設定'
	const selected = books.filter((book) => book.series === seriesName)
	return (
		<main className={`${styles.library} ${styles.series}`}>
			<Link to="/bookshelf">本棚に戻る</Link>
			<h1>{title}</h1>
			{!loading && !listError && <p>{selected.length} 冊</p>}
			<LibraryState
				loading={loading}
				listError={listError}
				books={books}
				retry={retry}
			/>
			<SeriesBookList {...props} books={selected} />
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
			/>
		)

	if (presentation === 'series')
		return (
			<SeriesDetails
				books={books}
				seriesName={seriesName}
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
			<h2 id="library-heading">クラウドの本</h2>
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
