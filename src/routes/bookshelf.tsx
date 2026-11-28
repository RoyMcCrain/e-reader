import { createFileRoute, useLocation, useRouter } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { Library } from '#components/library/Library'
import { parseSeriesName } from '#lib/library/metadata'

// Series last opened from each shelf history entry, keyed by router __TSR_key.
// Bounded so old entries cannot grow the map without limit.
const maxRememberedEntries = 40
const seriesOpenedFrom = new Map<string, string>()

const rememberSeriesOpened = (key: string, name: string) => {
	seriesOpenedFrom.delete(key)
	seriesOpenedFrom.set(key, name)
	const oldest = seriesOpenedFrom.keys().next().value
	if (seriesOpenedFrom.size > maxRememberedEntries && oldest !== undefined)
		seriesOpenedFrom.delete(oldest)
}

export const Route = createFileRoute('/bookshelf')({
	validateSearch: (
		search: Record<string, unknown>,
	): { from?: 'series'; name?: string } => ({
		from: search.from === 'series' ? 'series' : undefined,
		name: parseSeriesName(search.name),
	}),
	component: BookshelfPage,
})

function BookshelfPage() {
	const cancelPending = useRef<(() => void) | null>(null)
	const router = useRouter()
	const { from, name } = Route.useSearch()
	const historyKey = useLocation({
		select: (location) => location.state.__TSR_key,
	})
	useEffect(
		() =>
			router.subscribe('onBeforeLoad', ({ fromLocation, toLocation }) => {
				const search: Record<string, unknown> = toLocation.search
				if (
					fromLocation?.pathname !== '/bookshelf' ||
					toLocation.pathname !== '/bookshelf/series' ||
					search.from !== '/bookshelf'
				)
					return
				const key = fromLocation.state.__TSR_key
				if (key !== undefined)
					rememberSeriesOpened(key, parseSeriesName(search.name) ?? '')
			}),
		[router],
	)
	const remembered =
		historyKey === undefined ? undefined : seriesOpenedFrom.get(historyKey)
	const seriesTarget =
		remembered ?? (from === 'series' ? (name ?? '') : undefined)
	return (
		<Library
			cancelPending={cancelPending}
			presentation="bookshelf"
			seriesTarget={seriesTarget}
		/>
	)
}
