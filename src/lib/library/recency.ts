const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

export const parsePosition = (item: unknown) => {
	if (!isRecord(item)) return undefined
	const { bookId, updatedAt } = item
	if (
		typeof bookId !== 'string' ||
		typeof updatedAt !== 'number' ||
		!Number.isSafeInteger(updatedAt) ||
		updatedAt < 0
	)
		return undefined
	// The server stores and returns Unix seconds; the client works in milliseconds.
	const readAt = updatedAt * 1000
	if (!Number.isFinite(new Date(readAt).getTime())) return undefined
	return [bookId, readAt] as const
}

export const parseRecency = (data: unknown) => {
	if (!isRecord(data) || !Array.isArray(data.positions)) return undefined
	const values: Record<string, number> = {}
	for (const item of data.positions as unknown[]) {
		const position = parsePosition(item)
		if (position) values[position[0]] = position[1]
	}
	return values
}

export const fetchRecency = async (signal?: AbortSignal) => {
	try {
		const response = await fetch('/api/reading-positions', {
			credentials: 'same-origin',
			signal,
		})
		if (!response.ok) {
			// Unread bodies keep network requests in flight and block networkidle.
			await response.body?.cancel()
			return undefined
		}
		return parseRecency(await response.json())
	} catch {
		return undefined
	}
}
