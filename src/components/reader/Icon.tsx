import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
	close: (
		<>
			<path d="m6 6 12 12M18 6 6 18" />
		</>
	),
	toc: (
		<>
			<path d="M8 6h12M8 12h12M8 18h12" />
			<path d="M3 6h.01M3 12h.01M3 18h.01" />
		</>
	),
	settings: (
		<>
			<circle cx="12" cy="12" r="3" />
			<path
				d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4L7 15a8 8 0 0 1 0-2l-1.4-1.1L7 9.5l1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4L19.4 13a8 8 0 0 1 0 2Z"
				transform="translate(-1 -1)"
			/>
		</>
	),
}

interface IconProps {
	name: keyof typeof paths
}

export const Icon = ({ name }: IconProps) => (
	<svg
		viewBox="0 0 24 24"
		width="20"
		height="20"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		{paths[name]}
	</svg>
)
