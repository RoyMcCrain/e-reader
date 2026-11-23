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

export const selectRecentBooks = (
	books: CloudBook[],
	recency: Record<string, number>,
	limit: number,
) =>
	books
		.filter((book) => recency[book.id] > 0)
		.sort(
			(left, right) =>
				recency[right.id]! - recency[left.id]! ||
				left.id.localeCompare(right.id),
		)
		.slice(0, limit)

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
