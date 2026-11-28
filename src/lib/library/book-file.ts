import type { CloudBook } from '#lib/library/types'

const mimeType = (format: CloudBook['format']) =>
	format === 'epub' ? 'application/epub+zip' : 'application/zip'

export const downloadBookFile = async (
	book: { id: string; name: string; format: CloudBook['format'] },
	signal: AbortSignal,
): Promise<File> => {
	const response = await fetch(`/api/books/${encodeURIComponent(book.id)}`, {
		credentials: 'same-origin',
		signal,
	})
	const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
	if (!response.ok || !contentType.includes(mimeType(book.format))) {
		await response.body?.cancel()
		throw new Error('download')
	}
	const blob = await response.blob()
	return new File([blob], book.name, { type: mimeType(book.format) })
}
