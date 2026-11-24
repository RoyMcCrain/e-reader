import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
	up: (
		<>
			<path d="M12 19V5" />
			<path d="m5 12 7-7 7 7" />
		</>
	),
	close: (
		<>
			<path d="m6 6 12 12M18 6 6 18" />
		</>
	),
	check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
	clock: (
		<>
			<circle cx="12" cy="12" r="8" />
			<path d="M12 8v4l2.5 2.5" />
		</>
	),
	alert: (
		<>
			<path d="M12 4 3.5 19.5h17L12 4Z" />
			<path d="M12 10v4" />
			<path d="M12 17h.01" />
		</>
	),
	login: (
		<>
			<path d="M14 4H6v16h8" />
			<path d="M10 12h10" />
			<path d="m17 9 3 3-3 3" />
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
			<path d="M10 3h4v2.5l1.4.6 1.8-1.8 2.5 2.5-1.8 1.8.6 1.4H21v4h-2.5l-.6 1.4 1.8 1.8-2.5 2.5-1.8-1.8-1.4.6V21h-4v-2.5l-1.4-.6-1.8 1.8-2.5-2.5 1.8-1.8L5.5 14H3v-4h2.5l.6-1.4-1.8-1.8 2.5-2.5 1.8 1.8L10 5.5Z" />
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
