import { createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'

import { Library } from '#components/library/Library'
import { parseSeriesName } from '#lib/library/metadata'

export const Route = createFileRoute('/bookshelf_/series')({
	validateSearch: (search: Record<string, unknown>) => ({
		name: parseSeriesName(search.name),
	}),
	component: SeriesPage,
})

function SeriesPage() {
	const cancelPending = useRef<(() => void) | null>(null)
	const { name } = Route.useSearch()
	return (
		<Library
			cancelPending={cancelPending}
			presentation="series"
			seriesName={name}
		/>
	)
}
