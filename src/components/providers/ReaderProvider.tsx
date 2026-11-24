import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { flushPendingPositions } from '#lib/reader/positions'
import {
	DEFAULT_SETTINGS,
	normalizeSettings,
	readSettings,
	writeSettings,
	type ReaderSettings,
} from '#lib/reader/preferences'

interface ReaderApp {
	file: File | undefined
	setFile: (file: File | undefined) => void
	settings: ReaderSettings
	updateSettings: (patch: Partial<ReaderSettings>) => void
	resetSettings: () => void
}

interface ReaderProviderProps {
	children: ReactNode
}

const ReaderContext = createContext<ReaderApp | undefined>(undefined)

export const ReaderProvider = ({ children }: ReaderProviderProps) => {
	const [file, setFile] = useState<File | undefined>()
	const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS)
	const [hydrated, setHydrated] = useState(false)

	useEffect(() => {
		// Read browser storage after SSR hydration so the initial renders agree.
		// oxlint-disable-next-line react/set-state-in-effect
		setSettings(readSettings())
		setHydrated(true)
	}, [])

	useEffect(() => {
		if (hydrated) writeSettings(settings)
	}, [hydrated, settings])

	useEffect(() => {
		const retry = () => {
			if (document.visibilityState === 'hidden') return
			void flushPendingPositions().catch(() => {})
		}
		retry()
		window.addEventListener('online', retry)
		window.addEventListener('pagehide', retry)
		document.addEventListener('visibilitychange', retry)
		return () => {
			window.removeEventListener('online', retry)
			window.removeEventListener('pagehide', retry)
			document.removeEventListener('visibilitychange', retry)
		}
	}, [])

	const value = useMemo<ReaderApp>(
		() => ({
			file,
			setFile,
			settings,
			updateSettings: (patch) =>
				setSettings((current) => normalizeSettings({ ...current, ...patch })),
			resetSettings: () => setSettings(DEFAULT_SETTINGS),
		}),
		[file, settings],
	)
	return (
		<ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>
	)
}

export const useReaderApp = () => {
	const value = useContext(ReaderContext)
	if (!value) throw new Error('useReaderApp must be used inside ReaderProvider')
	return value
}
