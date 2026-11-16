import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
	useLocation,
	useNavigate,
} from '@tanstack/react-router'

import {
	ReaderProvider,
	useReaderApp,
} from '#components/providers/ReaderProvider'
import { Reader } from '#components/reader/Reader'

import shellStyles from '#routes/__root.module.css'
import '#routes/styles.css'

const AppShell = () => {
	const { file, setFile, settings } = useReaderApp()
	const navigate = useNavigate()
	const location = useLocation()
	const active = location.pathname !== '/config'
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
							if (location.pathname !== '/') void navigate({ to: '/' })
						}}
						onSettings={() => void navigate({ to: '/config' })}
					/>
				</div>
			)}
			<Outlet />
		</>
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
		],
	}),
	component: () => (
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
	),
})
