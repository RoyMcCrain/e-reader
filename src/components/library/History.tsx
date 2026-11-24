import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import {
	BookshelfBook,
	BookCover,
	LibraryStateMessage,
	LocalFileButton,
} from '#components/library/Bookshelf'
import type { BookshelfProps } from '#components/library/Bookshelf'
import { useReaderApp } from '#components/providers/ReaderProvider'
import { formatReadAt, selectHistoryEntries } from '#lib/library/bookshelf'
import type { HistoryEntry } from '#lib/library/bookshelf'
import { fetchRecency } from '#lib/library/recency'
import type { CloudBook } from '#lib/library/types'

import styles from '#components/library/Bookshelf.module.css'

const HistoryTime = ({ readAt }: { readAt: number }) => (
	<time dateTime={new Date(readAt).toISOString()}>{formatReadAt(readAt)}</time>
)

const SeriesEntry = ({
	entry,
}: {
	entry: Extract<HistoryEntry, { kind: 'series' }>
}) => (
	<li>
		<Link
			className={styles.book}
			to="/bookshelf/series"
			search={{ name: entry.series, from: '/history' }}
			aria-label={`${entry.series}、${entry.books.length}冊、最後に読んだ ${formatReadAt(entry.readAt)}`}
		>
			<BookCover book={entry.representative} />
		</Link>
		<p className={styles.cardTitle}>
			<Link
				to="/bookshelf/series"
				search={{ name: entry.series, from: '/history' }}
			>
				{entry.series}
			</Link>
		</p>
		<p>
			{entry.books.length} 冊 · <HistoryTime readAt={entry.readAt} />
		</p>
	</li>
)

const BookEntry = ({
	entry,
	busyId,
	openBook,
}: {
	entry: Extract<HistoryEntry, { kind: 'book' }>
	busyId: string
	openBook: (book: CloudBook) => void
}) => (
	<li>
		<BookshelfBook book={entry.book} busyId={busyId} openBook={openBook} />
		<p>
			<HistoryTime readAt={entry.readAt} />
		</p>
	</li>
)

export const History = ({
	books,
	loading,
	listError,
	retry,
	busyId,
	openBook,
	downloadError,
}: BookshelfProps) => {
	const { file } = useReaderApp()
	const [recency, setRecency] = useState<Record<string, number>>()
	const [recencyError, setRecencyError] = useState(false)
	const previousFile = useRef(file)
	const requestId = useRef(0)
	const mounted = useRef(false)
	useEffect(() => {
		const firstRender = !mounted.current
		const returnedToHistory =
			previousFile.current !== undefined && file === undefined
		mounted.current = true
		previousFile.current = file
		if (!firstRender && !returnedToHistory) return
		requestId.current += 1
		const current = requestId.current
		setRecency(undefined)
		setRecencyError(false)
		void fetchRecency().then((values) => {
			if (current !== requestId.current) return
			if (values === undefined) setRecencyError(true)
			else setRecency(values)
		})
	}, [file])
	const entries = recency ? selectHistoryEntries(books, recency) : []
	const hasHistory = recency !== undefined && Object.keys(recency).length > 0
	const ready = !loading && !listError
	return (
		<div className={styles.layout}>
			<main className={styles.page}>
				<header className={styles.header}>
					<a className={styles.brand} href="/">
						<strong className={styles.mark}>栞</strong>
						<span>BOOKSHELF</span>
					</a>
					<nav aria-label="メインナビゲーション">
						<Link to="/bookshelf" search={{ from: undefined }}>
							本棚
						</Link>
						<LocalFileButton />
						<Link
							to="/config"
							search={{ from: '/history', name: undefined, origin: undefined }}
						>
							設定
						</Link>
					</nav>
				</header>
				<div className={styles.intro}>
					<p className={styles.eyebrow}>あなたの本を、あなたの端末で。</p>
					<h1>最近読んだ本</h1>
					<p>
						{entries.length} 件 ·
						シリーズと書籍を合わせて、最後に読んだ順に表示します
					</p>
				</div>
				<LibraryStateMessage
					loading={loading}
					listError={listError}
					retry={retry}
				/>
				{ready &&
					(recency === undefined ? (
						recencyError ? (
							<div>
								<p>読書履歴を取得できませんでした。</p>
								<button
									onClick={() => {
										requestId.current += 1
										const current = requestId.current
										setRecencyError(false)
										void fetchRecency().then((values) => {
											if (current !== requestId.current) return
											if (values === undefined) setRecencyError(true)
											else setRecency(values)
										})
									}}
								>
									再試行
								</button>
							</div>
						) : (
							<p>読書履歴を確認しています…</p>
						)
					) : (
						<section
							className={styles.section}
							aria-labelledby="history-heading"
						>
							<div className={styles.sectionHead}>
								<h2 id="history-heading">読書履歴</h2>
								<span>{entries.length} 件</span>
							</div>
							{entries.length ? (
								<ul className={styles.grid}>
									{entries.map((entry) =>
										entry.kind === 'series' ? (
											<SeriesEntry
												key={`series:${entry.series}`}
												entry={entry}
											/>
										) : (
											<BookEntry
												key={entry.book.id}
												entry={entry}
												busyId={busyId}
												openBook={openBook}
											/>
										),
									)}
								</ul>
							) : (
								<p>
									{hasHistory
										? '読んだ本は見つかりません。'
										: 'まだ読んだ本がありません。'}
								</p>
							)}
						</section>
					))}
				{ready && recency !== undefined && (
					<>
						{busyId && <output>本をダウンロードしています…</output>}
						{downloadError && <p role="alert">{downloadError}</p>}
					</>
				)}
			</main>
		</div>
	)
}
