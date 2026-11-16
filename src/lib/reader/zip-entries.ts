import type { Entry } from '@zip.js/zip.js'

export const collectZipEntries = async (
	entries: AsyncGenerator<Entry>,
	message = 'ZIPの項目数または展開サイズが上限を超えています。',
) => {
	const result: Entry[] = []
	let total = 0
	for await (const entry of entries) {
		result.push(entry)
		total += entry.uncompressedSize
		if (result.length > 5000 || total > 1_000_000_000) throw new Error(message)
	}
	return result
}
