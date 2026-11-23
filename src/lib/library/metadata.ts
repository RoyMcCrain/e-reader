const singleLinePattern = /^[^\p{Cc}]{1,240}$/u
const timestampPattern =
	/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/

const validSingleLine = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.trim() !== '' &&
	value.trim().length <= 240 &&
	singleLinePattern.test(value)

export const parseSeriesName = (value: unknown) =>
	validSingleLine(value) ? value : undefined

export const parseAuthorName = (value: unknown) =>
	validSingleLine(value) ? value.trim() : undefined

const validUploadedAt = (value: unknown) => {
	if (typeof value !== 'string') return false
	const match = timestampPattern.exec(value)
	if (!match) return false
	const milliseconds = (match[2] ?? '').padEnd(3, '0')
	const date = new Date(value)
	return (
		Number.isFinite(date.getTime()) &&
		date.toISOString() === `${match[1]}.${milliseconds}Z`
	)
}

export const validBookMetadata = (book: Record<string, unknown>) =>
	(book.series === undefined || validSingleLine(book.series)) &&
	(book.uploadedAt === undefined || validUploadedAt(book.uploadedAt)) &&
	(book.hasCover === undefined || typeof book.hasCover === 'boolean')
