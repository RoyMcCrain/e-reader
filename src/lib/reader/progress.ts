export const progressValue = (progress: number, atEnd: boolean) => {
	if (atEnd) return 100
	if (!Number.isFinite(progress)) return 0
	return Math.min(99, Math.max(0, Math.round(progress)))
}

export const progressLocation = (
	count: number,
	currentIndex: number,
	indices: number[],
) => {
	const last = indices.at(-1)
	const range = last !== undefined && indices.length > 1 ? `–${last + 1}` : ''
	return count ? `${currentIndex + 1}${range}/${count}` : '本全体の目安'
}

export const progressRemaining = (
	count: number,
	currentIndex: number,
	indices: number[],
) => {
	if (!count) return ''
	const last = indices.at(-1) ?? currentIndex
	return `あと${Math.max(0, count - last - 1)}ページ`
}
