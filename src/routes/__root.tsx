import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
	useLocation,
	useNavigate,
} from '@tanstack/react-router'
import { useEffect } from 'react'

import {
	ReaderProvider,
	useReaderApp,
} from '#components/providers/ReaderProvider'
import { Reader } from '#components/reader/Reader'
import { parseSeriesName } from '#lib/library/metadata'

import shellStyles from '#routes/__root.module.css'
import '#routes/styles.css'

const AppShell = () => {
	const { file, setFile, settings } = useReaderApp()
	const navigate = useNavigate()
	const { pathname, search } = useLocation()
	const active = pathname !== '/config'
	const from =
		pathname === '/bookshelf' || pathname === '/bookshelf/series'
			? pathname
			: undefined
	return (
		<>
			{file && (
				<div
					className={shellStyles.readerShell}
					inert={!active}
					aria-hidden={!active}
				>
					<Reader
						file={file}
						settings={settings}
						active={active}
						onClose={() => {
							setFile(undefined)
							if (pathname !== '/' && !from) void navigate({ to: '/' })
						}}
						onSettings={() =>
							void navigate({
								to: '/config',
								search: {
									from,
									name:
										from === '/bookshelf/series'
											? parseSeriesName(search.name)
											: undefined,
								},
							})
						}
					/>
				</div>
			)}
			<div hidden={Boolean(file && from)}>
				<Outlet />
			</div>
		</>
	)
}

const RootDocument = () => {
	useEffect(() => {
		if (import.meta.env.PROD && 'serviceWorker' in navigator) {
			void navigator.serviceWorker
				.register('/sw.js', { scope: '/', updateViaCache: 'none' })
				.catch((error: unknown) =>
					console.warn('Service Worker registration failed', error),
				)
		}
	}, [])

	return (
		<html lang="ja">
			<head>
				<HeadContent />
			</head>
			<body>
				<ReaderProvider>
					<AppShell />
				</ReaderProvider>
				<Scripts />
			</body>
		</html>
	)
}

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{
				name: 'viewport',
				content: 'width=device-width, initial-scale=1, viewport-fit=cover',
			},
			{ title: '栞 — ブラウザー読書室' },
			{ name: 'theme-color', content: '#586d57' },
		],
		links: [
			{
				rel: 'manifest',
				href: '/manifest.webmanifest',
				crossOrigin: 'use-credentials',
			},
			{ rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
			{ rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
		],
	}),
	component: RootDocument,
})
