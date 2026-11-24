import { createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'

import { Library } from '#components/library/Library'
import { parseSeriesName } from '#lib/library/metadata'

const isSeriesFrom = (
	value: unknown,
): value is '/' | '/bookshelf' | '/history' =>
	value === '/' || value === '/bookshelf' || value === '/history'

export const Route = createFileRoute('/bookshelf_/series')({
	validateSearch: (search: Record<string, unknown>) => ({
		name: parseSeriesName(search.name),
		from: isSeriesFrom(search.from) ? search.from : undefined,
	}),
	component: SeriesPage,
})

function SeriesPage() {
	const cancelPending = useRef<(() => void) | null>(null)
	const { name, from } = Route.useSearch()
	return (
		<Library
			cancelPending={cancelPending}
			presentation="series"
			seriesName={name}
			seriesFrom={from}
		/>
	)
}
