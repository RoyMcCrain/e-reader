import { useEffect, useRef, useState } from 'react'

import { booksFromResponse } from '#components/library/Library'
import type { CloudBook } from '#lib/library/types'
import { readLastSession, type LastSession } from '#lib/reader/last-session'
import { hashBook } from '#lib/reader/positions'

import styles from '#components/library/Library.module.css'

interface LastSessionResumeProps {
	onOpen: (file: File) => void
}

interface Resume {
	session: LastSession
	cloud: CloudBook | undefined
}

const mimeFor = (format: LastSession['format']) =>
	format === 'epub' ? 'application/epub+zip' : 'application/zip'

const findCloudBook = async (
	bookId: string,
	signal: AbortSignal,
): Promise<CloudBook | undefined> => {
	try {
		const response = await fetch('/api/books', {
			credentials: 'same-origin',
			signal,
		})
		if (!response.ok) {
			await response.body?.cancel()
			return undefined
		}
		const books = booksFromResponse(await response.json())
		return books.find((book) => book.id === bookId)
	} catch {
		return undefined
	}
}

const downloadBook = async (book: CloudBook, format: LastSession['format']) => {
	const response = await fetch(`/api/books/${encodeURIComponent(book.id)}`, {
		credentials: 'same-origin',
	})
	const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
	const type = mimeFor(format)
	if (!response.ok || !contentType.includes(type)) {
		await response.body?.cancel()
		throw new Error('download')
	}
	return new File([await response.blob()], book.name, { type })
}

const CloudResume = ({
	session,
	cloud,
	onOpen,
}: {
	session: LastSession
	cloud: CloudBook
	onOpen: (file: File) => void
}) => {
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const open = async () => {
		setBusy(true)
		setError('')
		try {
			onOpen(await downloadBook(cloud, session.format))
		} catch {
			setError(
				'本をダウンロードできませんでした。通信状況を確認して、もう一度お試しください。',
			)
			setBusy(false)
		}
	}
	return (
		<section className={styles.library} aria-label="前回の続き">
			<p>前回の続き:{session.name}</p>
			<button
				className={styles.resume}
				disabled={busy}
				onClick={() => void open()}
			>
				続きを読む
			</button>
			{error && (
				<p role="alert" className={styles.error}>
					{error}
				</p>
			)}
		</section>
	)
}

const LocalResume = ({
	session,
	onOpen,
}: {
	session: LastSession
	onOpen: (file: File) => void
}) => {
	const input = useRef<HTMLInputElement>(null)
	const [error, setError] = useState('')
	const choose = async (file: File) => {
		if (!/\.(epub|zip)$/i.test(file.name)) {
			setError('EPUBまたは画像ZIPを選んでください。')
			return
		}
		let bookId: string
		try {
			bookId = await hashBook(file)
		} catch {
			setError('選択したファイルを確認できませんでした。')
			return
		}
		if (bookId !== session.bookId) {
			setError('選択したファイルは前回の本と異なります。')
			return
		}
		setError('')
		onOpen(file)
	}
	return (
		<section className={styles.library} aria-label="前回の続き">
			<p>前回の続き:{session.name}</p>
			<button type="button" onClick={() => input.current?.click()}>
				ファイルを選んで再開
			</button>
			<input
				ref={input}
				type="file"
				accept=".epub,.zip,application/epub+zip,application/zip"
				hidden
				onChange={(event) => {
					const selected = event.currentTarget.files?.[0]
					event.currentTarget.value = ''
					if (selected) void choose(selected)
				}}
			/>
			{error && (
				<p role="alert" className={styles.error}>
					{error}
				</p>
			)}
		</section>
	)
}

// Read after mount so server-rendered HTML matches the first client render.
export const LastSessionResume = ({ onOpen }: LastSessionResumeProps) => {
	const [resume, setResume] = useState<Resume>()
	useEffect(() => {
		const session = readLastSession()
		if (!session) return
		const controller = new AbortController()
		// oxlint-disable-next-line react/set-state-in-effect -- local resume needs no network, so it must render before the cloud lookup.
		setResume({ session, cloud: undefined })
		void findCloudBook(session.bookId, controller.signal).then((cloud) => {
			if (cloud && !controller.signal.aborted) setResume({ session, cloud })
		})
		return () => controller.abort()
	}, [])
	if (!resume) return null
	return resume.cloud ? (
		<CloudResume
			session={resume.session}
			cloud={resume.cloud}
			onOpen={onOpen}
		/>
	) : (
		<LocalResume session={resume.session} onOpen={onOpen} />
	)
}
