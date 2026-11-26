import type { TocItem } from 'foliate-js/epub.js'

import type { ReaderSettings } from '#lib/reader/preferences'

export interface ReaderLocation {
	progress: number
	atStart: boolean
	atEnd: boolean
}

export interface EpubOptions {
	file: File
	host: HTMLElement
	settings: ReaderSettings
	columns: 1 | 2
	active: boolean
	signal: AbortSignal
	onLocation: (location: ReaderLocation) => void
	initialCFI?: string
	onConfirmedPosition?: (cfi: string, atEnd: boolean) => void
	onError: (error: Error) => void
}

export interface EpubCheckpoint {
	cfi: string | undefined
	epoch: number
}

export interface EpubSession {
	dir: 'ltr' | 'rtl'
	toc: TocItem[]
	next: () => Promise<void>
	prev: () => Promise<void>
	goTo: (href: string) => Promise<void>
	checkpoint: () => EpubCheckpoint
	markTouched: () => void
	restore: (
		cfi: string,
		onlyIfUntouched?: boolean,
		expectedEpoch?: number,
	) => Promise<boolean>
	untouched: () => boolean
	initialRestoreFailed?: boolean
	configure: (settings: ReaderSettings, columns: 1 | 2) => Promise<void>
	setActive: (active: boolean) => void
	close: () => Promise<void>
}
