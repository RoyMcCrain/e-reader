const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

export const parsePosition = (item: unknown) => {
	if (!isRecord(item)) return undefined
	const { bookId, updatedAt } = item
	if (
		typeof bookId !== 'string' ||
		typeof updatedAt !== 'number' ||
		!Number.isSafeInteger(updatedAt) ||
		updatedAt < 0 ||
		!Number.isFinite(new Date(updatedAt).getTime())
	)
		return undefined
	return [bookId, updatedAt] as const
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
