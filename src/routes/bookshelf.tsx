import { createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'

import { Library } from '#components/library/Library'

export const Route = createFileRoute('/bookshelf')({ component: BookshelfPage })

function BookshelfPage() {
	const cancelPending = useRef<(() => void) | null>(null)
	return <Library cancelPending={cancelPending} presentation="bookshelf" />
}
