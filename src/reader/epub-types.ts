import type { TocItem } from 'foliate-js/epub.js'
import type { ReaderSettings } from './preferences'

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
  onError: (error: Error) => void
}

export interface EpubSession {
  dir: 'ltr' | 'rtl'
  toc: TocItem[]
  next: () => Promise<void>
  prev: () => Promise<void>
  goTo: (href: string) => Promise<void>
  configure: (settings: ReaderSettings, columns: 1 | 2) => Promise<void>
  setActive: (active: boolean) => void
  close: () => Promise<void>
}
