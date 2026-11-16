export const columnsForWidth = (
	spread: 'auto' | 'single' | 'double',
	contentWidth: number,
): 1 | 2 => {
	if (spread === 'single') return 1
	if (spread === 'double') return 2
	return contentWidth >= 720 ? 2 : 1
}

export const visibleIndices = (lead: number, count: number, columns: 1 | 2) =>
	Array.from(
		{ length: Math.min(columns, Math.max(0, count - lead)) },
		(_, index) => lead + index,
	)

export const nextLead = (lead: number, count: number, columns: 1 | 2) => {
	if (lead + columns >= count) return lead
	return Math.max(0, lead + columns)
}
