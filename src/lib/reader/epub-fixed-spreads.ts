import type { EpubSection } from 'foliate-js/epub.js'

export type FixedSlot = 'pair' | 'leading' | 'trailing' | 'center'
export type FixedGroup = { first: number; second?: number; slot: FixedSlot }
type Role = 'leading' | 'trailing' | 'center' | undefined

const roleOf = (section: EpubSection, rtl: boolean): Role => {
	if (section.pageSpread === 'center') return 'center'
	if (!section.pageSpread) return undefined
	// Physical left is the leading page in LTR and the trailing page in RTL.
	return (section.pageSpread === 'left') === rtl ? 'trailing' : 'leading'
}
// An unmarked page can pair with a following unmarked or trailing page.
const pairsWith = (role: Role) => role === undefined || role === 'trailing'
const groupAt = (
	sections: EpubSection[],
	linear: number[],
	position: number,
	rtl: boolean,
	firstPageSingle: boolean,
): FixedGroup => {
	const first = linear[position]
	const role = roleOf(sections[first], rtl)
	if (role === 'center') return { first, slot: 'center' }
	if (role === 'trailing') return { first, slot: 'trailing' }
	if (role === undefined && position === 0 && firstPageSingle)
		return { first, slot: 'center' }
	const next = linear[position + 1]
	if (next !== undefined && pairsWith(roleOf(sections[next], rtl)))
		return { first, second: next, slot: 'pair' }
	return { first, slot: 'leading' }
}

// Groups cover the linear spine from its beginning; non-linear sections are never grouped.
export const fixedSpreadGroups = (
	sections: EpubSection[],
	rtl: boolean,
	firstPageSingle: boolean,
): FixedGroup[] => {
	const linear = sections.flatMap((section, index) =>
		section.linear === 'no' ? [] : [index],
	)
	const groups: FixedGroup[] = []
	let position = 0
	while (position < linear.length) {
		const group = groupAt(sections, linear, position, rtl, firstPageSingle)
		groups.push(group)
		position += group.second === undefined ? 1 : 2
	}
	return groups
}

export const fixedGroupIndex = (groups: FixedGroup[], index: number) =>
	groups.findIndex((group) => group.first === index || group.second === index)

// Returns the neighbouring group index, or -1 when there is none.
export const adjacentFixedGroup = (
	groups: FixedGroup[],
	index: number,
	forward: boolean,
) => {
	const at = fixedGroupIndex(groups, index)
	if (at !== -1) {
		const target = at + (forward ? 1 : -1)
		return groups[target] ? target : -1
	}
	if (forward)
		return groups.findIndex((group) => (group.second ?? group.first) > index)
	let previous = -1
	groups.forEach((group, i) => {
		if (group.first < index) previous = i
	})
	return previous
}
