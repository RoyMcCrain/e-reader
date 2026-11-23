import { createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'

import { Library } from '#components/library/Library'

export const Route = createFileRoute('/bookshelf')({
	validateSearch: (search: Record<string, unknown>) => ({
		from: search.from === 'series' ? 'series' : undefined,
	}),
	component: BookshelfPage,
})

function BookshelfPage() {
	const cancelPending = useRef<(() => void) | null>(null)
	const { from } = Route.useSearch()
	return (
		<Library
			cancelPending={cancelPending}
			presentation="bookshelf"
			returnFromSeries={from === 'series'}
		/>
	)
}
