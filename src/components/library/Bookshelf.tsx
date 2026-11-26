import { Link } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

import { useReaderApp } from '#components/providers/ReaderProvider'
import { Icon } from '#components/reader/Icon'
import { filterBooks, groupBooks, sortBooks } from '#lib/library/bookshelf'
import type { BookSort } from '#lib/library/bookshelf'
import type { CloudBook } from '#lib/library/types'

import styles from '#components/library/Bookshelf.module.css'

export interface BookshelfProps {
	books: CloudBook[]
	loading: boolean
	listError: 'auth' | 'offline' | 'unavailable' | ''
	retry: () => void
	busyId: string
	openBook: (book: CloudBook) => void
	downloadError: string
	returnFromSeries?: boolean
}

// In-memory only: lost on reload, never written to storage or the URL.
let savedShelfScroll: number | undefined
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

export const BookCover = ({ book }: { book: CloudBook }) => {
	const [coverLoaded, setCoverLoaded] = useState(false)
	return (
		<>
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
		</>
	)
}

export const BookshelfBook = ({
	book,
	busyId,
	openBook,
}: BookActions & { book: CloudBook }) => (
	<button
		className={styles.book}
		aria-label={`${book.name}、${book.format.toUpperCase()}`}
		disabled={Boolean(busyId)}
		onClick={() => openBook(book)}
	>
		<BookCover book={book} />
	</button>
)

export const SeriesBook = ({
	book,
	from = '/bookshelf',
}: {
	book: CloudBook
	from?: '/' | '/bookshelf'
}) => (
	<Link
		className={styles.book}
		to="/bookshelf/series"
		search={{ name: book.series, from }}
		aria-label={`${book.name}、${book.format.toUpperCase()}`}
	>
		<BookCover book={book} />
	</Link>
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

export const LocalFileButton = () => {
	const { setFile } = useReaderApp()
	const input = useRef<HTMLInputElement>(null)
	const [message, setMessage] = useState('')
	return (
		<>
			<button type="button" onClick={() => input.current?.click()}>
				ファイルを開く
			</button>
			<input
				ref={input}
				type="file"
				accept=".epub,.zip,application/epub+zip,application/zip"
				hidden
				onChange={(event) => {
					const selected = event.currentTarget.files?.[0]
					event.currentTarget.value = ''
					if (!selected) return
					if (!/\.(epub|zip)$/i.test(selected.name)) {
						setMessage('EPUBまたは画像ZIPを選んでください。')
						return
					}
					setMessage('')
					setFile(selected)
				}}
			/>
			{message && <span role="alert">{message}</span>}
		</>
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
				<Carousel
					listLabel="最近アップロードされた本の一覧"
					prevLabel="最近アップロードされた本を前へ"
					nextLabel="最近アップロードされた本を次へ"
					itemCount={recent.length}
				>
					{recent.map((book) => (
						<li key={book.id}>
							<BookshelfBook book={book} {...actions} />
						</li>
					))}
				</Carousel>
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

interface AllBooksProps {
	books: CloudBook[]
	filtered: CloudBook[]
	sort: BookSort
}

interface CarouselProps {
	listLabel: string
	prevLabel: string
	nextLabel: string
	itemCount: number
	children: ReactNode
}

const Carousel = ({
	listLabel,
	prevLabel,
	nextLabel,
	itemCount,
	children,
}: CarouselProps) => {
	const track = useRef<HTMLUListElement>(null)
	const [scrollState, setScrollState] = useState('none')
	useEffect(() => {
		const element = track.current
		const carousel = element?.parentElement
		if (!element || !carousel) return
		const update = () => {
			if (element.scrollWidth <= carousel.clientWidth)
				return setScrollState('none')
			if (element.scrollLeft <= 1) return setScrollState('start')
			if (element.scrollLeft >= element.scrollWidth - element.clientWidth - 1)
				return setScrollState('end')
			setScrollState('middle')
		}
		update()
		element.addEventListener('scroll', update)
		let frame = 0
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(update)
		})
		observer.observe(element)
		return () => {
			element.removeEventListener('scroll', update)
			observer.disconnect()
			cancelAnimationFrame(frame)
		}
	}, [itemCount])
	const scroll = (direction: number) =>
		track.current?.scrollBy({
			left: direction * track.current.clientWidth * 0.8,
		})
	return (
		<div className={styles.carousel}>
			<button
				aria-label={prevLabel}
				disabled={scrollState === 'start' || scrollState === 'none'}
				onClick={() => scroll(-1)}
			>
				‹
			</button>
			<ul ref={track} aria-label={listLabel}>
				{children}
			</ul>
			<button
				aria-label={nextLabel}
				disabled={scrollState === 'end' || scrollState === 'none'}
				onClick={() => scroll(1)}
			>
				›
			</button>
		</div>
	)
}

const SeriesCarousel = ({
	name,
	books,
}: {
	name: string
	books: CloudBook[]
}) => (
	<Carousel
		listLabel={`${name}の本`}
		prevLabel={`${name}を前へ`}
		nextLabel={`${name}を次へ`}
		itemCount={books.length}
	>
		{books.map((book) => (
			<li key={book.id}>
				<SeriesBook book={book} />
			</li>
		))}
	</Carousel>
)

const AllBooksContent = ({ books, filtered, sort }: AllBooksProps) => {
	if (books.length === 0) return <p>本はありません。</p>
	if (filtered.length === 0) return <p>条件に合う本はありません。</p>

	if (sort !== 'series') {
		const sorted = sortBooks(filtered, sort)
		return (
			<Carousel
				listLabel="すべての本の一覧"
				prevLabel="すべての本を前へ"
				nextLabel="すべての本を次へ"
				itemCount={sorted.length}
			>
				{sorted.map((book) => (
					<li key={book.id}>
						<SeriesBook book={book} />
					</li>
				))}
			</Carousel>
		)
	}

	return groupBooks(filtered).map((group) => (
		<section
			className={styles.group}
			key={group.series === undefined ? 'unassigned' : `series:${group.series}`}
		>
			<h3>
				<Link
					to="/bookshelf/series"
					search={{ name: group.series, from: '/bookshelf' }}
				>
					{group.series ?? 'シリーズ未設定'}
				</Link>{' '}
				<small>{group.books.length} 冊</small>
			</h3>
			<SeriesCarousel
				name={group.series ?? 'シリーズ未設定'}
				books={group.books}
			/>
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
	query: string
	setQuery: (value: string) => void
	format: 'all' | 'epub' | 'zip'
	setFormat: (value: 'all' | 'epub' | 'zip') => void
	sort: BookSort
	setSort: (value: BookSort) => void
}

export const LibraryStateMessage = ({
	loading,
	listError,
	retry,
}: Pick<BookshelfProps, 'loading' | 'listError' | 'retry'>) => {
	if (loading) return <p>本を確認しています…</p>
	if (!listError) return null
	if (listError === 'auth')
		return (
			<p>
				本を読むにはログインが必要です。{' '}
				<a href="https://reader.rrrr.dev/">ログイン</a>
			</p>
		)
	return (
		<div>
			<p>
				{listError === 'unavailable'
					? '本は現在利用できません。'
					: '本を確認できませんでした。'}
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
					<AllBooks books={books} filtered={filtered} sort={sort} />
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
					<Link to="/history">履歴</Link>
					<LocalFileButton />
					<Link
						to="/config"
						search={{ from: '/bookshelf', name: undefined, origin: undefined }}
					>
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
	const { books, filtered, query, setQuery, returnFromSeries } = props
	const ready = !props.loading && !props.listError
	const scroller = useRef<HTMLElement>(null)
	const [showBackToTop, setShowBackToTop] = useState(false)
	const backToTop = () => {
		const element = scroller.current
		if (!element) return
		// Focus the scroll start first so keyboard focus survives the button hiding.
		element.focus({ preventScroll: true })
		const reduceMotion = window.matchMedia(
			'(prefers-reduced-motion: reduce)',
		).matches
		element.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
	}
	useLayoutEffect(() => {
		// Any other entry to the shelf drops a stale offset.
		if (!returnFromSeries) {
			savedShelfScroll = undefined
			return
		}
		if (!ready || savedShelfScroll === undefined || !scroller.current) return
		scroller.current.scrollTop = savedShelfScroll
		savedShelfScroll = undefined
	}, [returnFromSeries, ready])
	// Captures the position before the series link's navigation starts.
	// Plain left clicks only: modified clicks and new tabs stay on the shelf.
	const rememberSeriesOpen = (event: MouseEvent<HTMLElement>) => {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return
		const target = event.target
		const anchor = target instanceof Element ? target.closest('a') : null
		if (anchor?.pathname === '/bookshelf/series' && !anchor.target)
			savedShelfScroll = event.currentTarget.scrollTop
	}
	return (
		<div className={styles.layout}>
			<main
				ref={scroller}
				className={styles.page}
				tabIndex={-1}
				onClickCapture={rememberSeriesOpen}
				onScroll={(event) =>
					setShowBackToTop(event.currentTarget.scrollTop > 320)
				}
			>
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
					{showBackToTop && (
						<button
							type="button"
							className={styles.backToTop}
							aria-label="先頭へ戻る"
							onClick={backToTop}
						>
							<Icon name="up" />
						</button>
					)}
				</footer>
			)}
		</div>
	)
}

export const Bookshelf = (props: BookshelfProps) => {
	const { books } = props
	const [query, setQuery] = useState('')
	const [format, setFormat] = useState<'all' | 'epub' | 'zip'>('all')
	const [sort, setSort] = useState<BookSort>('series')
	const filtered = useMemo(
		() => filterBooks(books, { query, format }),
		[books, query, format],
	)
	// A new filter, sort or search means the saved position no longer applies.
	const changeQuery = (value: string) => {
		savedShelfScroll = undefined
		setQuery(value)
	}
	const changeFormat = (value: 'all' | 'epub' | 'zip') => {
		savedShelfScroll = undefined
		setFormat(value)
	}
	const changeSort = (value: BookSort) => {
		savedShelfScroll = undefined
		setSort(value)
	}
	return (
		<BookshelfContent
			{...props}
			filtered={filtered}
			query={query}
			setQuery={changeQuery}
			format={format}
			setFormat={changeFormat}
			sort={sort}
			setSort={changeSort}
		/>
	)
}
