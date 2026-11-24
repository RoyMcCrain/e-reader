import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
	useLocation,
	useNavigate,
} from '@tanstack/react-router'
import { useEffect, useState } from 'react'

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
		pathname === '/bookshelf' ||
		pathname === '/bookshelf/series' ||
		pathname === '/history'
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
									origin:
										from === '/bookshelf/series' &&
										(search.from === '/' ||
											search.from === '/bookshelf' ||
											search.from === '/history')
											? search.from
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

// Dev-only MSW mock toggle: `?mock=1` enables (persisted in localStorage),
// `?mock=0` disables. Env vars cannot reach import.meta.env in this stack.
const mockRequested = () => {
	const param = new URLSearchParams(window.location.search).get('mock')
	try {
		if (param === '1') window.localStorage.setItem('shiori-mock', '1')
		if (param === '0') window.localStorage.removeItem('shiori-mock')
		return window.localStorage.getItem('shiori-mock') === '1'
	} catch {
		// Blocked or full storage (SecurityError / QuotaExceededError): mock stays off.
		return false
	}
}

const RootDocument = () => {
	const [mockReady, setMockReady] = useState(!import.meta.env.DEV)

	useEffect(() => {
		if (import.meta.env.PROD && 'serviceWorker' in navigator) {
			void navigator.serviceWorker
				.register('/sw.js', { scope: '/', updateViaCache: 'none' })
				.catch((error: unknown) =>
					console.warn('Service Worker registration failed', error),
				)
		}
	}, [])

	useEffect(() => {
		if (!import.meta.env.DEV) return
		let active = true
		if (!mockRequested()) {
			void Promise.resolve().then(() => {
				if (active) setMockReady(true)
			})
			return () => {
				active = false
			}
		}
		void import('#mocks/browser')
			.then(({ startMockWorker }) => startMockWorker())
			.then(() => {
				if (active) setMockReady(true)
			})
			.catch((error: unknown) => {
				console.warn('MSW mock failed', error)
				if (active) setMockReady(true)
			})
		return () => {
			active = false
		}
	}, [])

	return (
		<html lang="ja">
			<head>
				<HeadContent />
			</head>
			<body>
				{mockReady ? (
					<ReaderProvider>
						<AppShell />
					</ReaderProvider>
				) : (
					<p>モックを準備しています…</p>
				)}
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
