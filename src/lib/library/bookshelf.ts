import type { CloudBook } from './types'

export type BookSort = 'series' | 'newest' | 'title'
export interface BookFilters {
	query: string
	format: 'all' | 'epub' | 'zip'
}

const titleCollator = new Intl.Collator('ja', {
	numeric: true,
	sensitivity: 'base',
})
const normalize = (value: string) =>
	value.normalize('NFKC').toLocaleLowerCase('ja')
const compareTitle = (left: CloudBook, right: CloudBook) =>
	titleCollator.compare(left.name, right.name) ||
	left.id.localeCompare(right.id)
const compareSeries = (left: string, right: string) =>
	titleCollator.compare(left, right)
const compareNewest = (left: CloudBook, right: CloudBook) => {
	if (!left.uploadedAt && !right.uploadedAt) return compareTitle(left, right)
	if (!left.uploadedAt) return 1
	if (!right.uploadedAt) return -1

	const dateOrder = Date.parse(right.uploadedAt) - Date.parse(left.uploadedAt)
	if (dateOrder) return dateOrder
	return compareTitle(left, right)
}
const compareSeriesBooks = (left: CloudBook, right: CloudBook) => {
	if (left.series === undefined && right.series !== undefined) return 1
	if (right.series === undefined && left.series !== undefined) return -1
	if (left.series !== undefined && right.series !== undefined) {
		const seriesOrder = compareSeries(left.series, right.series)
		if (seriesOrder) return seriesOrder
	}
	return compareTitle(left, right)
}

const comparators = {
	title: compareTitle,
	newest: compareNewest,
	series: compareSeriesBooks,
} satisfies Record<BookSort, typeof compareTitle>

export const filterBooks = (books: CloudBook[], filters: BookFilters) => {
	const terms = normalize(filters.query).trim().split(/\s+/u).filter(Boolean)
	return books.filter((book) => {
		if (filters.format !== 'all' && book.format !== filters.format) return false
		const title = normalize(book.name)
		const series = normalize(book.series ?? '')
		return terms.every((term) => title.includes(term) || series.includes(term))
	})
}

export const sortBooks = (books: CloudBook[], sort: BookSort) =>
	[...books].sort(comparators[sort])

export interface HistorySeriesEntry {
	kind: 'series'
	series: string
	books: CloudBook[]
	readAt: number
	representative: CloudBook
}

export interface HistoryBookEntry {
	kind: 'book'
	book: CloudBook
	readAt: number
}

export type HistoryEntry = HistorySeriesEntry | HistoryBookEntry

const entryName = (entry: HistoryEntry) =>
	entry.kind === 'series' ? entry.series : entry.book.name

const entryId = (entry: HistoryEntry) =>
	entry.kind === 'series' ? entry.representative.id : entry.book.id

const readAtOf = (book: CloudBook, recency: Record<string, number>) => {
	const readAt = recency[book.id]
	return typeof readAt === 'number' && readAt > 0 ? readAt : undefined
}

export const latestReadBook = (
	books: CloudBook[],
	recency: Record<string, number>,
) => {
	let latest: CloudBook | undefined
	let readAt = 0
	for (const book of books) {
		const at = readAtOf(book, recency)
		if (at === undefined) continue
		// readAtOf only returns positive values, so the first hit beats readAt 0.
		if (at > readAt || (at === readAt && book.id < latest!.id)) {
			latest = book
			readAt = at
		}
	}
	return latest === undefined ? undefined : { book: latest, readAt }
}

export const selectHistoryEntries = (
	books: CloudBook[],
	recency: Record<string, number>,
): HistoryEntry[] => {
	const entries: HistoryEntry[] = []
	for (const group of groupBooks(books)) {
		if (group.series === undefined) {
			for (const book of group.books) {
				const readAt = readAtOf(book, recency)
				if (readAt !== undefined) entries.push({ kind: 'book', book, readAt })
			}
			continue
		}
		let latest: CloudBook | undefined
		let readAt = 0
		for (const book of group.books) {
			const at = readAtOf(book, recency)
			if (at === undefined) continue
			if (at > readAt || (at === readAt && book.id < latest!.id)) {
				readAt = at
				latest = book
			}
		}
		if (latest !== undefined)
			entries.push({
				kind: 'series',
				series: group.series,
				books: group.books,
				readAt,
				representative: latest,
			})
	}
	return entries.sort(
		(left, right) =>
			right.readAt - left.readAt ||
			titleCollator.compare(entryName(left), entryName(right)) ||
			entryId(left).localeCompare(entryId(right)),
	)
}

const readAtFormatter = new Intl.DateTimeFormat('ja-JP', {
	dateStyle: 'medium',
	timeStyle: 'short',
})

export const formatReadAt = (readAt: number) => {
	if (!Number.isSafeInteger(readAt) || readAt <= 0) return ''
	const date = new Date(readAt)
	if (!Number.isFinite(date.getTime())) return ''
	return readAtFormatter.format(date)
}

export const groupBooks = (books: CloudBook[]) => {
	const groups = new Map<string | undefined, CloudBook[]>()
	for (const book of sortBooks(books, 'series')) {
		const group = groups.get(book.series)
		if (group) group.push(book)
		else groups.set(book.series, [book])
	}
	return [...groups].map(([series, groupBooks]) => ({
		series,
		books: groupBooks,
	}))
}
