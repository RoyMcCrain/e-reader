import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { BookCover, SeriesBook } from '#components/library/Bookshelf'
import { booksFromResponse } from '#components/library/Library'
import {
	formatReadAt,
	selectHistoryEntries,
	sortBooks,
} from '#lib/library/bookshelf'
import type { HistoryEntry } from '#lib/library/bookshelf'
import { fetchRecency } from '#lib/library/recency'
import type { CloudBook } from '#lib/library/types'

import styles from '#routes/index.module.css'

type LoadError = 'auth' | 'offline' | 'unavailable' | ''

const loadErrorOf = (response: Response): LoadError => {
	if (response.status === 401 || response.status === 403) return 'auth'
	if (response.status === 503) return 'unavailable'
	return response.ok ? '' : 'offline'
}

const RecentCarousel = ({ entries }: { entries: HistoryEntry[] }) => {
	const track = useRef<HTMLUListElement>(null)
	const [scrollState, setScrollState] = useState<
		'none' | 'start' | 'middle' | 'end'
	>('none')
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
	}, [entries])
	const scroll = (direction: number) =>
		track.current?.scrollBy({
			left: direction * track.current.clientWidth * 0.8,
		})
	return (
		<div className={styles.recentCarousel}>
			{scrollState !== 'none' && (
				<button
					aria-label="最近読んだ本を前へ"
					disabled={scrollState === 'start'}
					onClick={() => scroll(-1)}
				>
					‹
				</button>
			)}
			<ul
				ref={track}
				className={styles.recentTrack}
				aria-label="最近読んだ本のリスト"
			>
				{entries.map((entry) =>
					entry.kind === 'series' ? (
						<li key={`series:${entry.series}`}>
							<Link
								className={styles.previewCard}
								to="/bookshelf/series"
								search={{ name: entry.series, from: '/' }}
							>
								<BookCover book={entry.representative} />
								<span className={styles.previewName}>{entry.series}</span>
								<span className={styles.previewMeta}>
									{entry.books.length} 冊 · {formatReadAt(entry.readAt)}
								</span>
							</Link>
						</li>
					) : (
						<li key={entry.book.id}>
							<SeriesBook book={entry.book} from="/" />
							<time
								className={styles.previewMeta}
								dateTime={new Date(entry.readAt).toISOString()}
							>
								{formatReadAt(entry.readAt)}
							</time>
						</li>
					),
				)}
			</ul>
			{scrollState !== 'none' && (
				<button
					aria-label="最近読んだ本を次へ"
					disabled={scrollState === 'end'}
					onClick={() => scroll(1)}
				>
					›
				</button>
			)}
		</div>
	)
}

const RecentBooksPreview = ({ books }: { books: CloudBook[] }) => {
	const [recency, setRecency] = useState<Record<string, number>>()
	useEffect(() => {
		const controller = new AbortController()
		void fetchRecency(controller.signal).then((values) => {
			if (!controller.signal.aborted) setRecency(values)
		})
		return () => controller.abort()
	}, [])
	const entries = recency
		? selectHistoryEntries(books, recency).slice(0, 10)
		: []
	if (entries.length === 0) return null
	return (
		<section className={styles.preview} aria-labelledby="top-recent-heading">
			<div className={styles.previewHead}>
				<h2 id="top-recent-heading">最近読んだ本</h2>
				<span>最大10</span>
				<Link className={styles.previewMore} to="/history">
					すべて見る
				</Link>
			</div>
			<RecentCarousel entries={entries} />
		</section>
	)
}

function Home() {
	const navigate = useNavigate()
	const [books, setBooks] = useState<CloudBook[]>([])
	const [loading, setLoading] = useState(true)
	const [listError, setListError] = useState<LoadError>('')
	const [retryKey, setRetryKey] = useState(0)
	useEffect(() => {
		const controller = new AbortController()
		void (async () => {
			setLoading(true)
			setListError('')
			try {
				const response = await fetch('/api/books', {
					credentials: 'same-origin',
					signal: controller.signal,
				})
				const error = loadErrorOf(response)
				if (error) {
					await response.body?.cancel()
					if (!controller.signal.aborted) {
						setListError(error)
						setLoading(false)
					}
					return
				}
				const result: unknown = await response.json()
				if (!controller.signal.aborted) {
					setBooks(booksFromResponse(result))
					setLoading(false)
				}
			} catch {
				if (!controller.signal.aborted) {
					setListError('offline')
					setLoading(false)
				}
			}
		})()
		return () => controller.abort()
	}, [retryKey])
	const newBooks = sortBooks(
		books.filter((book) => book.uploadedAt),
		'newest',
	).slice(0, 10)
	return (
		<main className={styles.home}>
			<div className={styles.brand}>
				<span>栞</span>
				<small>SHIORI · BROWSER READER</small>
			</div>
			<section className={styles.intro}>
				<h1>
					ページをひらいて、
					<br />
					物語の中へ。
				</h1>
				<p>
					<Link
						className={styles.bookshelfLink}
						to="/bookshelf"
						search={{ from: undefined }}
					>
						本棚を開く
					</Link>{' '}
					·{' '}
					<Link className={styles.bookshelfLink} to="/history">
						最近読んだ本
					</Link>
				</p>
			</section>
			{loading ? (
				<p>本を確認しています…</p>
			) : listError === 'auth' ? (
				<p>
					本を読むにはログインが必要です。{' '}
					<a href="https://reader.rrrr.dev/">ログイン</a>
				</p>
			) : listError ? (
				<div>
					<p>
						{listError === 'unavailable'
							? '本は現在利用できません。'
							: '本を確認できませんでした。'}
					</p>
					<button onClick={() => setRetryKey((key) => key + 1)}>再試行</button>
				</div>
			) : books.length === 0 ? (
				<p>本はありません。</p>
			) : (
				<>
					<RecentBooksPreview books={books} />
					{newBooks.length > 0 && (
						<section
							className={styles.preview}
							aria-labelledby="top-new-heading"
						>
							<div className={styles.previewHead}>
								<h2 id="top-new-heading">新しい本</h2>
								<span>最大10</span>
								<Link
									className={styles.previewMore}
									to="/bookshelf"
									search={{ from: undefined }}
								>
									すべて見る
								</Link>
							</div>
							<ul className={styles.previewGrid}>
								{newBooks.map((book) => (
									<li key={book.id}>
										<SeriesBook book={book} from="/" />
									</li>
								))}
							</ul>
						</section>
					)}
				</>
			)}
			<footer className={styles.foot}>
				<button
					className={styles.settingsLink}
					onClick={() =>
						void navigate({
							to: '/config',
							search: { from: undefined, name: undefined, origin: undefined },
						})
					}
				>
					設定
				</button>
				<br />
				本は読書時に取得します。
				<br />
				<span>
					操作：画面の左右端をタップ · ← → · Space / PageUp / PageDown
				</span>
			</footer>
		</main>
	)
}

export const Route = createFileRoute('/')({ component: Home })
