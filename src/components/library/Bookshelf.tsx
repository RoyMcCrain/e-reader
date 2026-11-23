import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useReaderApp } from '#components/providers/ReaderProvider'
import {
	filterBooks,
	groupBooks,
	selectRecentBooks,
	sortBooks,
} from '#lib/library/bookshelf'
import type { BookSort } from '#lib/library/bookshelf'
import type { CloudBook } from '#lib/library/types'

import styles from '#components/library/Bookshelf.module.css'

interface BookshelfProps {
	books: CloudBook[]
	loading: boolean
	listError: 'auth' | 'offline' | 'unavailable' | ''
	retry: () => void
	busyId: string
	openBook: (book: CloudBook) => void
	downloadError: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const parsePosition = (item: unknown) => {
	if (!isRecord(item)) return undefined
	const { bookId, updatedAt } = item
	if (
		typeof bookId !== 'string' ||
		typeof updatedAt !== 'number' ||
		!Number.isSafeInteger(updatedAt) ||
		updatedAt < 0
	)
		return undefined
	return [bookId, updatedAt] as const
}

const parseRecency = (data: unknown) => {
	if (!isRecord(data) || !Array.isArray(data.positions)) return undefined
	const values: Record<string, number> = {}
	for (const item of data.positions as unknown[]) {
		const position = parsePosition(item)
		if (position) values[position[0]] = position[1]
	}
	return values
}

const fetchRecency = async () => {
	try {
		const response = await fetch('/api/reading-positions', {
			credentials: 'same-origin',
		})
		if (!response.ok) {
			// Unread bodies keep network requests in flight and block networkidle.
			await response.body?.cancel()
			return undefined
		}
		return parseRecency(await response.json())
	} catch {
		return undefined
	}
}

const coverPalette = [
	'linear-gradient(145deg,#576f58,#385441)',
	'linear-gradient(145deg,#866448,#6d5038)',
	'linear-gradient(145deg,#5d6770,#414f59)',
	'linear-gradient(145deg,#825a5f,#694c54)',
	'linear-gradient(145deg,#716d40,#5f613c)',
]

interface BookActions {
	busyId: string
	openBook: (book: CloudBook) => void
}

const BookshelfBook = ({
	book,
	busyId,
	openBook,
}: BookActions & { book: CloudBook }) => {
	const [coverLoaded, setCoverLoaded] = useState(false)
	return (
		<button
			className={styles.book}
			aria-label={`${book.name}、${book.format.toUpperCase()}`}
			disabled={Boolean(busyId)}
			onClick={() => openBook(book)}
		>
			<span
				className={styles.cover}
				style={{
					background: coverPalette[book.id.charCodeAt(0) % coverPalette.length],
				}}
			>
				<img
					className={styles.coverImage}
					src={`/api/books/${encodeURIComponent(book.id)}/cover`}
					alt=""
					loading="lazy"
					decoding="async"
					data-loaded={coverLoaded}
					onLoad={() => setCoverLoaded(true)}
				/>
				<span className={styles.spine} />
				<span className={styles.coverTitle}>
					{book.name.replace(/\.(epub|zip)$/i, '')}
				</span>
				<span className={styles.badge}>{book.format.toUpperCase()}</span>
			</span>
			<span className={styles.cardTitle}>{book.name}</span>
		</button>
	)
}

const BookGrid = ({
	books,
	...actions
}: BookActions & { books: CloudBook[] }) => (
	<div className={styles.grid}>
		{books.map((book) => (
			<BookshelfBook key={book.id} book={book} {...actions} />
		))}
	</div>
)

interface FilterControlsProps {
	query: string
	setQuery: (value: string) => void
	format: 'all' | 'epub' | 'zip'
	setFormat: (value: 'all' | 'epub' | 'zip') => void
	sort: BookSort
	setSort: (value: BookSort) => void
}

const FilterControls = ({
	query,
	setQuery,
	format,
	setFormat,
	sort,
	setSort,
}: FilterControlsProps) => {
	const clear = () => {
		setQuery('')
		setFormat('all')
	}
	return (
		<div className={styles.filters}>
			<label>
				形式
				<select
					aria-label="形式"
					value={format}
					onChange={(event) =>
						setFormat(event.currentTarget.value as typeof format)
					}
				>
					<option value="all">すべての形式</option>
					<option value="epub">EPUB</option>
					<option value="zip">ZIP</option>
				</select>
			</label>
			<label>
				表示順
				<select
					aria-label="表示順"
					value={sort}
					onChange={(event) => setSort(event.currentTarget.value as BookSort)}
				>
					<option value="series">シリーズ別</option>
					<option value="newest">新しい順</option>
					<option value="title">タイトル順</option>
				</select>
			</label>
			{(query || format !== 'all') && (
				<button className={styles.clearButton} onClick={clear}>
					条件をクリア
				</button>
			)}
		</div>
	)
}

const RecentlyReadBooks = ({
	books,
	recency,
	...actions
}: BookActions & { books: CloudBook[]; recency: Record<string, number> }) => {
	const recent = selectRecentBooks(books, recency, 8)
	const hasHistory = Object.keys(recency).length > 0
	return (
		<section className={styles.section} aria-labelledby="recently-read-heading">
			<div className={styles.sectionHead}>
				<h2 id="recently-read-heading">最近読んだ本</h2>
				<span>最大8冊</span>
			</div>
			{recent.length ? (
				<div className={styles.recent}>
					{recent.map((book) => (
						<BookshelfBook key={book.id} book={book} {...actions} />
					))}
				</div>
			) : (
				<p>
					{hasHistory
						? '条件に合う本はありません。'
						: 'まだ読んだ本がありません。'}
				</p>
			)}
		</section>
	)
}

const RecentBooks = ({
	books,
	...actions
}: BookActions & { books: CloudBook[] }) => {
	const recent = sortBooks(
		books.filter((book) => book.uploadedAt),
		'newest',
	).slice(0, 8)
	return (
		<section className={styles.section} aria-labelledby="recent-heading">
			<div className={styles.sectionHead}>
				<h2 id="recent-heading">最近アップロードされた本</h2>
				<span>最大8冊</span>
			</div>
			{recent.length ? (
				<div className={styles.recent}>
					{recent.map((book) => (
						<BookshelfBook key={book.id} book={book} {...actions} />
					))}
				</div>
			) : (
				<p>
					{books.length
						? 'アップロード日時が未登録の本は最近の本に表示されません。'
						: '最近アップロードされた本はありません。'}
				</p>
			)}
		</section>
	)
}

interface AllBooksProps extends BookActions {
	books: CloudBook[]
	filtered: CloudBook[]
	sort: BookSort
}

const AllBooksContent = ({
	books,
	filtered,
	sort,
	...actions
}: AllBooksProps) => {
	if (books.length === 0) return <p>クラウドに本はありません。</p>
	if (filtered.length === 0) return <p>条件に合う本はありません。</p>

	const ordered = sortBooks(filtered, sort)
	if (sort !== 'series') return <BookGrid books={ordered} {...actions} />

	return groupBooks(ordered).map((group) => (
		<section
			className={styles.group}
			key={group.series === undefined ? 'unassigned' : `series:${group.series}`}
		>
			<h3>
				{group.series ?? 'シリーズ未設定'}{' '}
				<small>{group.books.length} 冊</small>
			</h3>
			<BookGrid books={group.books} {...actions} />
		</section>
	))
}

const AllBooks = (props: AllBooksProps) => (
	<section className={styles.section} aria-labelledby="all-heading">
		<h2 id="all-heading">すべての本</h2>
		<AllBooksContent {...props} />
	</section>
)

interface BookshelfContentProps extends BookshelfProps {
	filtered: CloudBook[]
	recency: Record<string, number> | undefined
	query: string
	setQuery: (value: string) => void
	format: 'all' | 'epub' | 'zip'
	setFormat: (value: 'all' | 'epub' | 'zip') => void
	sort: BookSort
	setSort: (value: BookSort) => void
}

const LibraryStateMessage = ({
	loading,
	listError,
	retry,
}: Pick<BookshelfProps, 'loading' | 'listError' | 'retry'>) => {
	if (loading) return <p>クラウドの本を確認しています…</p>
	if (!listError) return null
	if (listError === 'auth')
		return (
			<p>
				クラウドの本を読むにはログインが必要です。{' '}
				<a href="https://reader.rrrr.dev/">ログイン</a>
			</p>
		)
	return (
		<div>
			<p>
				{listError === 'unavailable'
					? 'クラウドの本は現在利用できません。'
					: 'クラウドの本を確認できませんでした。'}
			</p>
			<button onClick={retry}>再試行</button>
		</div>
	)
}

const BookshelfResults = ({
	books,
	loading,
	listError,
	retry,
	busyId,
	openBook,
	downloadError,
	filtered,
	recency,
	sort,
}: BookshelfContentProps) => (
	<>
		<LibraryStateMessage
			loading={loading}
			listError={listError}
			retry={retry}
		/>
		{!loading && !listError && (
			<>
				<div className={styles.shelves}>
					{recency !== undefined && (
						<RecentlyReadBooks
							books={filtered}
							recency={recency}
							busyId={busyId}
							openBook={openBook}
						/>
					)}
					<AllBooks
						books={books}
						filtered={filtered}
						sort={sort}
						busyId={busyId}
						openBook={openBook}
					/>
					<RecentBooks books={filtered} busyId={busyId} openBook={openBook} />
				</div>
				{busyId && <output>本をダウンロードしています…</output>}
				{downloadError && <p role="alert">{downloadError}</p>}
			</>
		)}
	</>
)

const searchPanelId = 'bookshelf-search-panel'

interface BookshelfHeaderProps {
	ready: boolean
	query: string
	setQuery: (value: string) => void
}

const BookshelfHeader = ({ ready, query, setQuery }: BookshelfHeaderProps) => {
	const [open, setOpen] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)
	useEffect(() => {
		if (open) inputRef.current?.focus()
	}, [open])
	return (
		<>
			<header className={styles.header}>
				<a className={styles.brand} href="/">
					<strong className={styles.mark}>栞</strong>
					<span>BOOKSHELF</span>
				</a>
				<nav aria-label="メインナビゲーション">
					<a href="/">ファイルから読む</a>
					<Link to="/config" search={{ from: '/bookshelf' }}>
						設定
					</Link>
					{ready && (
						<button
							type="button"
							className={styles.searchButton}
							aria-expanded={open}
							aria-controls={searchPanelId}
							onClick={() => setOpen((value) => !value)}
						>
							<svg
								className={styles.searchIcon}
								aria-hidden="true"
								focusable="false"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.2"
								strokeLinecap="round"
							>
								<circle cx="11" cy="11" r="6.5" />
								<path d="m16 16 4.5 4.5" />
							</svg>
							検索
						</button>
					)}
				</nav>
			</header>
			<div
				id={searchPanelId}
				className={styles.searchPanel}
				hidden={!ready || !open}
			>
				<label>
					タイトル・シリーズで検索
					<input
						ref={inputRef}
						type="search"
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
					/>
				</label>
			</div>
		</>
	)
}

const BookshelfContent = (props: BookshelfContentProps) => {
	const { books, filtered, query, setQuery } = props
	const ready = !props.loading && !props.listError
	return (
		<div className={styles.layout}>
			<main className={styles.page}>
				<BookshelfHeader ready={ready} query={query} setQuery={setQuery} />
				<div className={styles.intro}>
					<p className={styles.eyebrow}>あなたの本を、あなたの端末で。</p>
					<h1>本棚</h1>
					<p>
						{books.length} 冊の本 · 条件に合う本 {filtered.length} 冊
					</p>
				</div>
				<BookshelfResults {...props} />
			</main>
			{ready && (
				<footer className={styles.footer} aria-label="本棚の絞り込みと表示設定">
					<FilterControls
						query={query}
						setQuery={setQuery}
						format={props.format}
						setFormat={props.setFormat}
						sort={props.sort}
						setSort={props.setSort}
					/>
				</footer>
			)}
		</div>
	)
}

export const Bookshelf = (props: BookshelfProps) => {
	const { books } = props
	const { file } = useReaderApp()
	const [recency, setRecency] = useState<Record<string, number>>()
	const previousFile = useRef(file)
	const requestId = useRef(0)
	const mounted = useRef(false)
	useEffect(() => {
		const firstRender = !mounted.current
		const returnedToShelf =
			previousFile.current !== undefined && file === undefined
		mounted.current = true
		previousFile.current = file
		if (!firstRender && !returnedToShelf) return
		requestId.current += 1
		const current = requestId.current
		setRecency(undefined)
		void fetchRecency().then((values) => {
			if (current !== requestId.current) return
			if (values !== undefined) setRecency(values)
		})
	}, [file])
	const [query, setQuery] = useState('')
	const [format, setFormat] = useState<'all' | 'epub' | 'zip'>('all')
	const [sort, setSort] = useState<BookSort>('series')
	const filtered = useMemo(
		() => filterBooks(books, { query, format }),
		[books, query, format],
	)
	return (
		<BookshelfContent
			{...props}
			recency={recency}
			filtered={filtered}
			query={query}
			setQuery={setQuery}
			format={format}
			setFormat={setFormat}
			sort={sort}
			setSort={setSort}
		/>
	)
}
