import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { BookCover, SeriesBook } from '#components/library/Bookshelf'
import { booksFromResponse } from '#components/library/Library'
import { groupBooks, sortBooks } from '#lib/library/bookshelf'
import type { CloudBook } from '#lib/library/types'

import styles from '#routes/index.module.css'

type LoadError = 'auth' | 'offline' | 'unavailable' | ''

const loadErrorOf = (response: Response): LoadError => {
	if (response.status === 401 || response.status === 403) return 'auth'
	if (response.status === 503) return 'unavailable'
	return response.ok ? '' : 'offline'
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
	const seriesPreview = groupBooks(books).slice(0, 10)
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
				<p className={styles.eyebrow}>あなたの本を、あなたの端末で。</p>
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
				<p>クラウドの本を確認しています…</p>
			) : listError === 'auth' ? (
				<p>
					クラウドの本を読むにはログインが必要です。{' '}
					<a href="https://reader.rrrr.dev/">ログイン</a>
				</p>
			) : listError ? (
				<div>
					<p>
						{listError === 'unavailable'
							? 'クラウドの本は現在利用できません。'
							: 'クラウドの本を確認できませんでした。'}
					</p>
					<button onClick={() => setRetryKey((key) => key + 1)}>再試行</button>
				</div>
			) : books.length === 0 ? (
				<p>クラウドに本はありません。</p>
			) : (
				<>
					<section
						className={styles.preview}
						aria-labelledby="top-series-heading"
					>
						<div className={styles.previewHead}>
							<h2 id="top-series-heading">シリーズ</h2>
							<span>最大10</span>
							<Link
								className={styles.previewMore}
								to="/bookshelf"
								search={{ from: undefined }}
							>
								すべて見る
							</Link>
						</div>
						<div className={styles.previewGrid}>
							{seriesPreview.map((group) => {
								const representative = group.books[0]
								if (!representative) return null
								return (
									<Link
										key={
											group.series === undefined
												? 'unassigned'
												: `series:${group.series}`
										}
										className={styles.previewCard}
										to="/bookshelf/series"
										search={{ name: group.series }}
									>
										<BookCover book={representative} />
										<span className={styles.previewName}>
											{group.series ?? 'シリーズ未設定'}
										</span>
										<span className={styles.previewMeta}>
											{group.books.length} 冊
										</span>
									</Link>
								)
							})}
						</div>
					</section>
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
										<SeriesBook book={book} />
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
							search: { from: undefined, name: undefined },
						})
					}
				>
					設定
				</button>
				<br />
				クラウドの本は読書時に取得します。
				<br />
				<span>
					操作：画面の左右端をタップ · ← → · Space / PageUp / PageDown
				</span>
			</footer>
		</main>
	)
}

export const Route = createFileRoute('/')({ component: Home })
