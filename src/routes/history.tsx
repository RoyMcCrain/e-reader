import { createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'

import { Library } from '#components/library/Library'

export const Route = createFileRoute('/history')({ component: HistoryPage })

function HistoryPage() {
	const cancelPending = useRef<(() => void) | null>(null)
	return <Library cancelPending={cancelPending} presentation="history" />
}
