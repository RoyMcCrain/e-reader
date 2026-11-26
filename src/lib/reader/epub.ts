import {
	BlobReader,
	BlobWriter,
	TextWriter,
	ZipReader,
	type FileEntry,
} from '@zip.js/zip.js'
import type { EpubBook, TocItem } from 'foliate-js/epub.js'
import { collapse } from 'foliate-js/epubcfi.js'
import type { FoliateViewElement, FoliateRenderer } from 'foliate-js/view.js'

import {
	adjacentFixedGroup,
	fixedGroupIndex,
	fixedSpreadGroups,
	type FixedSlot,
} from '#lib/reader/epub-fixed-spreads'
import {
	awaitContentLayout,
	awaitOwned,
	awaitWithAbort,
} from '#lib/reader/epub-layout'
import type {
	EpubOptions,
	EpubSession,
	ReaderLocation,
} from '#lib/reader/epub-types'
import { bindEpubInput, bindHostInput } from '#lib/reader/input'
import type { ReaderSettings } from '#lib/reader/preferences'
import { secureDocument } from '#lib/reader/security'
import { collectZipEntries } from '#lib/reader/zip-entries'

type Book = EpubBook
type Pane = {
	view: FoliateViewElement
	wrapper: HTMLElement
	removeInput: () => void
}
const cancelled = (options: EpubOptions, closed: () => boolean) => {
	if (options.signal.aborted || closed())
		throw new DOMException('Opening cancelled', 'AbortError')
}
const stylesFor = (settings: ReaderSettings) =>
	`html, body { font-size: ${settings.fontSize}px !important; line-height: ${settings.lineHeight} !important; ${settings.fontFamily === 'publisher' ? '' : `font-family: ${settings.fontFamily} !important; `} }`
const sanitizeHooks = (book: EpubBook, signal: AbortSignal) => {
	const data = (event: Event) => {
		const detail = (
			event as CustomEvent<{
				data: Blob | string | Promise<Blob | string>
				type: string
			}>
		).detail
		if (
			!['application/xhtml+xml', 'text/html', 'image/svg+xml'].includes(
				detail.type,
			)
		)
			return
		detail.data = Promise.resolve(detail.data).then(async (source) => {
			if (signal.aborted)
				throw new DOMException('Opening cancelled', 'AbortError')
			const text = secureDocument(
				typeof source === 'string' ? source : await source.text(),
				detail.type,
			)
			if (signal.aborted)
				throw new DOMException('Opening cancelled', 'AbortError')
			return new Blob([text], { type: detail.type })
		})
	}
	const load = (event: Event) => {
		const detail = (
			event as CustomEvent<{ isScript?: boolean; allow?: boolean }>
		).detail
		if (detail.isScript) detail.allow = false
	}
	book.transformTarget.addEventListener('data', data)
	book.transformTarget.addEventListener('load', load)
	return () => {
		book.transformTarget.removeEventListener('data', data)
		book.transformTarget.removeEventListener('load', load)
	}
}
const makePane = (
	surface: HTMLElement,
	name: 'primary' | 'secondary',
): Pane => {
	const wrapper = document.createElement('div')
	wrapper.dataset.readerPage = name
	wrapper.style.cssText =
		'min-width:0;min-height:0;width:100%;height:100%;overflow:hidden;'
	// Keep peer initialization from creating an extra row or painting a duplicate.
	wrapper.style.gridRow = '1'
	wrapper.style.gridColumn = name === 'primary' ? '1' : '2'
	if (name === 'secondary') wrapper.style.visibility = 'hidden'
	const view = document.createElement('foliate-view') as FoliateViewElement
	view.style.cssText = 'display:block;width:100%;height:100%;'
	wrapper.append(view)
	view.addEventListener('external-link', (event) => event.preventDefault())
	surface.append(wrapper)
	return { view, wrapper, removeInput: () => {} }
}
const rendererOf = (pane: Pane) =>
	pane.view.renderer as unknown as FoliateRenderer
const awaitPaneLayout = async (pane: Pane, signal: AbortSignal) => {
	const doc = rendererOf(pane).getContents()[0]?.doc
	if (doc) await awaitContentLayout(doc, signal)
}
const setPaneStyles = (pane: Pane, settings: ReaderSettings) => {
	const renderer = rendererOf(pane)
	renderer.setAttribute('max-column-count', '1')
	renderer.setAttribute('flow', 'paginated')
	renderer.setAttribute('margin', '0')
	renderer.setAttribute('gap', '0%')
	renderer.setAttribute('max-inline-size', '10000px')
	renderer.setAttribute('max-block-size', '10000px')
	renderer.style.cssText =
		'width:100%;height:100%;max-width:none;max-height:none;'
	renderer.setStyles?.(stylesFor(settings))
}
const placeFixedPane = (pane: Pane, slot: FixedSlot) => {
	const centered = slot === 'center'
	const column = slot === 'trailing' ? '2' : '1'
	pane.wrapper.style.gridRow = '1'
	pane.wrapper.style.gridColumn = centered ? '1 / -1' : column
	pane.wrapper.style.justifySelf = centered ? 'center' : ''
}
const sectionLinear = (book: EpubBook, index: number) =>
	book.sections[index]?.linear !== 'no'
const nextSection = (book: EpubBook, index: number, direction: 1 | -1) => {
	let next = index + direction
	while (next >= 0 && next < book.sections.length && !sectionLinear(book, next))
		next += direction
	return next >= 0 && next < book.sections.length ? next : undefined
}
const sectionIndex = (book: EpubBook, pane: Pane) => {
	const index = rendererOf(pane).getContents()[0]?.index
	if (Number.isInteger(index)) return index as number
	const cfi = pane.view.lastLocation?.cfi?.split('!')[0]
	return book.sections.findIndex((section) => section.cfi === cfi)
}
const isFirstPage = (book: EpubBook, pane: Pane) =>
	book.rendition.layout === 'pre-paginated'
		? sectionIndex(book, pane) === nextSection(book, -1, 1)
		: Boolean(rendererOf(pane).atStart)
const validCfi = (view: FoliateViewElement, book: EpubBook, cfi: string) => {
	if (!/^epubcfi\(.+\)$/u.test(cfi)) return false
	try {
		const target = view.resolveCFI(cfi)
		return (
			Number.isInteger(target.index) &&
			target.index >= 0 &&
			target.index < book.sections.length
		)
	} catch {
		return false
	}
}
const restoreInitialLocation = async (
	session: EpubSession,
	options: EpubOptions,
	closed: () => boolean,
) => {
	if (!options.initialCFI) return false
	const restored = await session.restore(options.initialCFI)
	cancelled(options, closed)
	return !restored
}
const createBookLoader = async (
	reader: ZipReader<BlobReader>,
	options: EpubOptions,
	isClosed: () => boolean,
) => {
	const entries = await awaitWithAbort(
		collectZipEntries(
			reader.getEntriesGenerator(),
			'EPUBの展開サイズが上限を超えています。',
		),
		options.signal,
	)
	cancelled(options, isClosed)
	const map = new Map(entries.map((entry) => [entry.filename, entry]))
	const get = (path: string) => map.get(path)
	const loadEntry = async <T>(
		entry: FileEntry | undefined,
		read: (entry: FileEntry) => Promise<T>,
	) => {
		cancelled(options, isClosed)
		if (!entry || entry.directory) return null
		const data = await read(entry)
		cancelled(options, isClosed)
		return data
	}
	return {
		loadText: (path: string) =>
			loadEntry(get(path) as FileEntry | undefined, (entry) =>
				entry.getData(new TextWriter()),
			),
		loadBlob: (path: string) =>
			loadEntry(get(path) as FileEntry | undefined, (entry) =>
				entry.getData(new BlobWriter()),
			),
		getSize: (path: string) => get(path)?.uncompressedSize ?? 0,
	}
}

export const openEpub = async (options: EpubOptions): Promise<EpubSession> => {
	let reader: ZipReader<BlobReader> | undefined
	let book: Book | undefined
	let panes: Pane[] = []
	let removeHooks: () => void = () => {}
	let closed = false
	const opening = new AbortController()
	let active = options.active
	let activeGeneration = 0
	let navigationEpoch = 0
	let queued = Promise.resolve()
	let settings = options.settings
	let columns = options.columns
	let readingAnchor: string | undefined
	let resizePending = false
	let resizeDirty = false
	let resize: ResizeObserver | undefined
	let surface: HTMLElement | undefined
	let removeHostInput = () => {}
	const alive = () => !closed && !options.signal.aborted
	const notify = () => {
		if (!alive() || !panes[0]?.view.lastLocation) return
		const primary = panes[0].view.lastLocation
		const renderer = rendererOf(panes[0])
		const peerRenderer = panes.length > 1 ? panes[1].view.renderer : undefined
		const fixed = book?.rendition.layout === 'pre-paginated'
		const currentIndex = sectionIndex(book!, panes[0])
		const peerIndex = peerRenderer ? sectionIndex(book!, panes[1]) : -1
		const peerAtEnd =
			panes.length > 1 &&
			panes[1].wrapper.style.visibility !== 'hidden' &&
			(fixed
				? nextSection(book!, peerIndex, 1) === undefined
				: Boolean((peerRenderer as FoliateRenderer | undefined)?.atEnd))
		const atStart = fixed
			? nextSection(book!, currentIndex, -1) === undefined
			: Boolean(renderer.atStart)
		const atEnd = fixed
			? nextSection(book!, currentIndex, 1) === undefined
			: Boolean(renderer.atEnd)
		const loc: ReaderLocation = {
			progress: Math.max(
				0,
				Math.min(100, Math.round((primary.fraction ?? 0) * 100)),
			),
			atStart,
			atEnd: fixed
				? atEnd || peerAtEnd
				: peerAtEnd ||
					(panes.length === 1 && atEnd) ||
					(panes.length > 1 &&
						panes[1].wrapper.style.visibility === 'hidden' &&
						atEnd),
		}
		const spreadSurface = surface
		if (spreadSurface) {
			spreadSurface.dataset.atStart = String(loc.atStart)
			spreadSurface.dataset.atEnd = String(loc.atEnd)
		}
		options.onLocation(loc)
	}
	const enqueue = (operation: () => Promise<void>, propagate = false) => {
		const task = queued.then(async () => {
			if (alive()) await operation()
		})
		queued = task.catch((error: unknown) => {
			if (alive())
				options.onError(
					error instanceof Error
						? error
						: new Error('ページ移動に失敗しました。'),
				)
		})
		return propagate ? task : queued
	}
	const rememberAnchor = (cfi = panes[0]?.view.lastLocation?.cfi) => {
		if (cfi) readingAnchor = collapse(cfi)
	}
	const confirmAnchor = () => {
		if (readingAnchor) options.onConfirmedPosition?.(readingAnchor)
	}
	const layout = async (preserve = true) => {
		if (!book || !panes.length || !alive()) return
		const primary = panes[0].view
		const width = options.host.clientWidth
		const physicalDouble = columns === 2 && width > 0
		if (!surface) {
			surface = document.createElement('div')
			surface.dataset.readerSpread = 'true'
			surface.style.cssText =
				'display:grid;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;'
			options.host.append(surface)
		}
		// Foliate rounds scroll extents, so fractional page widths can repeat a page.
		const pageWidth = Math.max(
			0,
			Math.floor((surface.getBoundingClientRect().width - settings.gutter) / 2),
		)
		surface.style.gridTemplateColumns = physicalDouble
			? `repeat(2,${pageWidth}px)`
			: 'minmax(0,1fr)'
		surface.style.justifyContent = physicalDouble ? 'center' : ''
		const fixed = book.rendition.layout === 'pre-paginated'
		const cover =
			settings.firstPageSingle && physicalDouble && isFirstPage(book, panes[0])
		panes[0].wrapper.style.width = physicalDouble ? `${pageWidth}px` : '100%'
		// Fixed spread slots are set by syncFixedPeer, not by the viewport.
		if (!fixed || !physicalDouble)
			placeFixedPane(panes[0], cover ? 'center' : 'leading')
		surface.style.gap = `${settings.gutter}px`
		surface.style.direction = book.dir === 'rtl' ? 'rtl' : 'ltr'
		if (physicalDouble && panes.length === 1) {
			const pane = makePane(surface, 'secondary')
			panes.push(pane)
			await awaitOwned(pane.view.open(book), opening.signal, () =>
				pane.view.close(),
			)
			cancelled(options, () => closed)
			setPaneStyles(pane, settings)
			if (active) bindPane(pane)
			bindLinks(pane)
			await awaitOwned(
				pane.view.init({ showTextStart: false }),
				opening.signal,
				() => pane.view.close(),
			)
			cancelled(options, () => closed)
			await awaitPaneLayout(pane, opening.signal)
			cancelled(options, () => closed)
		}
		if (!physicalDouble && panes.length > 1) {
			const peer = panes.pop()!
			peer.removeInput()
			peer.view.close()
			peer.wrapper.remove()
		}
		if (preserve && readingAnchor) {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			)
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			)
			cancelled(options, () => closed)
			await primary.goTo(readingAnchor)
			await awaitPaneLayout(panes[0], opening.signal)
			cancelled(options, () => closed)
			// Foliate's native resize can settle after the first navigation.
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			)
			cancelled(options, () => closed)
			await primary.goTo(readingAnchor)
			cancelled(options, () => closed)
		}
		if (physicalDouble && panes.length > 1) {
			await syncPeer()
			cancelled(options, () => closed)
		}
		notify()
	}
	const jump = async (pane: Pane, target: number) => {
		const renderer = rendererOf(pane)
		const count = Math.max(1, (renderer.pages ?? 2) - 2)
		await renderer.scrollToAnchor?.(
			Math.max(0, Math.min(1, (target - 1) / Math.max(1, count - 1))),
		)
	}
	const stepOne = async (pane: Pane, forward: boolean) => {
		const renderer = rendererOf(pane)
		if (book?.rendition.layout === 'pre-paginated') {
			const current = sectionIndex(book!, pane)
			const next = nextSection(book!, current, forward ? 1 : -1)
			if (next === undefined) return false
			await renderer.goTo?.({ index: next })
			return true
		}
		const count = Math.max(1, (renderer.pages ?? 2) - 2)
		const target = (renderer.page ?? 1) + (forward ? 1 : -1)
		if (target >= 1 && target <= count) {
			await jump(pane, target)
			return true
		}
		const current = sectionIndex(book!, pane)
		const index = nextSection(book!, current, forward ? 1 : -1)
		if (index === undefined) return false
		await renderer.goTo?.({ index, anchor: forward ? 0 : 1 })
		await awaitPaneLayout(pane, opening.signal)
		cancelled(options, () => closed)
		return true
	}
	const fixedGroups = () =>
		fixedSpreadGroups(
			book!.sections,
			book!.dir === 'rtl',
			settings.firstPageSingle,
		)
	const loadFixedPeer = async (peer: Pane, index: number) => {
		if (sectionIndex(book!, peer) === index) return
		// Hide only while the peer is being moved to its group partner.
		peer.wrapper.style.visibility = 'hidden'
		await rendererOf(peer).goTo?.({ index })
		await awaitPaneLayout(peer, opening.signal)
		cancelled(options, () => closed)
	}
	const syncFixedPeer = async () => {
		const [primary, peer] = panes
		const groups = fixedGroups()
		const group = groups[fixedGroupIndex(groups, sectionIndex(book!, primary))]
		if (!group || group.second === undefined) {
			peer.wrapper.style.visibility = 'hidden'
			placeFixedPane(primary, group?.slot ?? 'leading')
			return
		}
		await loadFixedPeer(peer, group.second)
		// Moving the primary to the lead leaves readingAnchor untouched.
		if (sectionIndex(book!, primary) !== group.first)
			await rendererOf(primary).goTo?.({ index: group.first })
		placeFixedPane(primary, 'leading')
		placeFixedPane(peer, 'trailing')
		peer.wrapper.style.visibility = ''
	}
	const turnFixed = async (forward: boolean) => {
		const groups = fixedGroups()
		const target = adjacentFixedGroup(
			groups,
			sectionIndex(book!, panes[0]),
			forward,
		)
		if (target === -1) return false
		await rendererOf(panes[0]).goTo?.({ index: groups[target].first })
		await syncPeer()
		return true
	}
	const syncPeer = async () => {
		if (panes.length < 2 || !book) return
		if (book.rendition.layout === 'pre-paginated') return syncFixedPeer()
		const cover =
			settings.firstPageSingle && columns === 2 && isFirstPage(book!, panes[0])
		panes[0].wrapper.style.gridRow = '1'
		panes[0].wrapper.style.gridColumn = cover ? '1 / -1' : '1'
		panes[0].wrapper.style.justifySelf = cover ? 'center' : ''
		panes[1].wrapper.style.gridRow = '1'
		panes[1].wrapper.style.gridColumn = '2'
		panes[1].wrapper.style.visibility = cover ? 'hidden' : ''
		if (cover) return
		if (rendererOf(panes[0]).atEnd) {
			panes[1].wrapper.style.visibility = 'hidden'
			return
		}
		panes[1].wrapper.style.visibility = 'hidden'
		const primaryIndex = sectionIndex(book!, panes[0])
		if (primaryIndex !== sectionIndex(book!, panes[1])) {
			await rendererOf(panes[1]).goTo?.({ index: primaryIndex, anchor: 0 })
			await awaitPaneLayout(panes[1], opening.signal)
			cancelled(options, () => closed)
		}
		if (primaryIndex !== sectionIndex(book!, panes[1])) {
			panes[1].wrapper.style.visibility = ''
			return
		}
		const peerRenderer = rendererOf(panes[1])
		const target = (rendererOf(panes[0]).page ?? 1) + 1
		const count = Math.max(1, (peerRenderer.pages ?? 2) - 2)
		if (target <= count) {
			await jump(panes[1], target)
		} else {
			const next = nextSection(book!, primaryIndex, 1)
			if (next === undefined) return
			await peerRenderer.goTo?.({ index: next, anchor: 0 })
			await awaitPaneLayout(panes[1], opening.signal)
			cancelled(options, () => closed)
		}
		panes[1].wrapper.style.visibility = ''
	}
	const reflowBackwardSteps = async (current: number, page: number) => {
		const firstSection = nextSection(book!, -1, 1)
		if (current === firstSection && page === 3) return 1
		const previous = nextSection(book!, current, -1)
		if (firstSection === undefined || previous !== firstSection || page !== 2)
			return 2
		const peer = panes[1]
		if (!peer) return 2
		peer.wrapper.style.visibility = 'hidden'
		await rendererOf(peer).goTo?.({ index: firstSection, anchor: 0 })
		await awaitPaneLayout(peer, opening.signal)
		cancelled(options, () => closed)
		return Math.max(1, (rendererOf(peer).pages ?? 2) - 2) === 1 ? 1 : 2
	}
	const turn = (forward: boolean) => {
		navigationEpoch += 1
		const generation = activeGeneration
		return enqueue(async () => {
			if (!active || generation !== activeGeneration) return
			if (
				columns === 2 &&
				panes.length > 1 &&
				book?.rendition.layout === 'pre-paginated'
			) {
				if (!(await turnFixed(forward))) return
			} else if (columns === 2 && panes.length > 1) {
				const cover = settings.firstPageSingle && isFirstPage(book!, panes[0])
				if (cover) {
					if (!forward || !(await stepOne(panes[0], true))) return
				} else {
					const peerAtEnd =
						panes[1].wrapper.style.visibility !== 'hidden' &&
						rendererOf(panes[1]).atEnd
					if (forward && peerAtEnd) return
					const steps =
						!forward && settings.firstPageSingle
							? await reflowBackwardSteps(
									sectionIndex(book!, panes[0]),
									rendererOf(panes[0]).page ?? 1,
								)
							: 2
					let moved = false
					for (let i = 0; i < steps; i++) {
						if (!(await stepOne(panes[0], forward))) break
						moved = true
					}
					if (!moved) return
				}
				await syncPeer()
			} else if (!(await stepOne(panes[0], forward))) return
			rememberAnchor()
			confirmAnchor()
			notify()
		})
	}
	const loadLocation = async (href: string) => {
		const primary = panes[0]
		const previous = primary.view.lastLocation?.cfi
		const target = await primary.view.goTo(href)
		await awaitPaneLayout(primary, opening.signal)
		cancelled(options, () => closed)
		// A failed fixed jump can leave lastLocation pointing at the visual lead.
		if (
			book!.rendition.layout === 'pre-paginated' &&
			target?.index !== sectionIndex(book!, primary)
		)
			return { previous }
		return { previous, cfi: primary.view.lastLocation?.cfi }
	}
	const goToLocation = (href: string) =>
		enqueue(async () => {
			const { previous, cfi } = await loadLocation(href)
			if (!cfi) return
			const fixed = book!.rendition.layout === 'pre-paginated'
			const changed = fixed ? collapse(cfi) !== readingAnchor : cfi !== previous
			if (!fixed && !changed) return
			if (changed) rememberAnchor(cfi)
			// goTo can move the visual lead even when the fixed reading anchor matches.
			if (columns === 2) await syncPeer()
			if (changed) confirmAnchor()
			notify()
		})
	const bindLinks = (pane: Pane) => {
		pane.view.addEventListener('link', (event) => {
			const href = (event as CustomEvent<{ href?: string }>).detail?.href
			if (!href) return
			event.preventDefault()
			navigationEpoch += 1
			void goToLocation(href)
		})
	}
	const bindPane = (pane: Pane) => {
		pane.removeInput = bindEpubInput(
			pane.view,
			options.host,
			book?.dir === 'rtl' ? 'rtl' : 'ltr',
			(next) => {
				if (!active) return
				return next ? session.next() : session.prev()
			},
		)
	}
	const session: EpubSession = {
		dir: 'ltr',
		toc: [],
		next: () => turn(true),
		prev: () => turn(false),
		goTo: (href) => {
			navigationEpoch += 1
			return goToLocation(href)
		},
		untouched: () => navigationEpoch === 0,
		checkpoint: () => ({
			cfi: readingAnchor ?? panes[0]?.view.lastLocation?.cfi,
			epoch: navigationEpoch,
		}),
		markTouched: () => {
			navigationEpoch += 1
		},
		restore: (cfi, onlyIfUntouched = false, expectedEpoch) => {
			const epoch = expectedEpoch ?? navigationEpoch
			let restored = false
			return enqueue(async () => {
				if (epoch !== navigationEpoch || (onlyIfUntouched && epoch !== 0))
					return
				if (!book || !validCfi(panes[0].view, book, cfi)) return
				const target = panes[0].view.resolveCFI(cfi)
				const priorAnchor = readingAnchor ?? panes[0].view.lastLocation?.cfi
				const restorePrior = async () => {
					if (!priorAnchor) return
					readingAnchor = priorAnchor
					await panes[0].view.goTo(priorAnchor)
					await awaitPaneLayout(panes[0], opening.signal)
					cancelled(options, () => closed)
					if (columns === 2) await syncPeer()
				}
				try {
					await panes[0].view.goTo(cfi)
					await awaitPaneLayout(panes[0], opening.signal)
				} catch {
					cancelled(options, () => closed)
					await restorePrior()
					return
				}
				cancelled(options, () => closed)
				if (epoch !== navigationEpoch) {
					await restorePrior()
					return
				}
				const actual = panes[0].view.lastLocation?.cfi
				const content = panes[0].view.renderer?.getContents()[0]
				const fixed = book.rendition.layout === 'pre-paginated'
				if (
					!actual ||
					panes[0].view.resolveCFI(actual).index !== target.index ||
					(!fixed && (!content || content.index !== target.index))
				) {
					await restorePrior()
					return
				}
				try {
					if (content) {
						const point = target.anchor(content.doc)
						if (!content.doc.body.contains(point.startContainer)) {
							await restorePrior()
							return
						}
					} else if (!fixed) {
						await restorePrior()
						return
					}
				} catch {
					if (!fixed) {
						await restorePrior()
						return
					}
				}
				readingAnchor = collapse(cfi)
				if (columns === 2) await syncPeer()
				if (epoch !== navigationEpoch) {
					await restorePrior()
					return
				}
				notify()
				restored = true
			}).then(() => restored)
		},
		configure: (nextSettings, nextColumns) => {
			if (
				JSON.stringify(settings) === JSON.stringify(nextSettings) &&
				columns === nextColumns
			)
				return Promise.resolve()
			settings = nextSettings
			columns = nextColumns
			return enqueue(async () => {
				// Foliate's deferred style callbacks must not target a discarded peer.
				panes.slice(0, columns).forEach((pane) => setPaneStyles(pane, settings))
				await layout(true)
			})
		},
		setActive: (value) => {
			if (active === value || closed) return
			active = value
			activeGeneration += 1
			if (!active) {
				removeHostInput()
				removeHostInput = () => {}
				panes.forEach((pane) => {
					pane.removeInput()
					pane.removeInput = () => {}
				})
				return
			}
			removeHostInput = bindHostInput(
				options.host,
				book?.dir === 'rtl' ? 'rtl' : 'ltr',
				(next) => {
					if (!active) return
					return next ? session.next() : session.prev()
				},
			)
			panes.forEach(bindPane)
		},
		close: async () => {
			if (closed) return
			closed = true
			opening.abort()
			resize?.disconnect()
			options.signal.removeEventListener('abort', abort)
			removeHostInput()
			panes.forEach((pane) => {
				pane.removeInput()
				pane.view.close()
				pane.wrapper.remove()
			})
			panes = []
			surface?.remove()
			surface = undefined
			removeHooks()
			book?.destroy()
			await reader?.close()
		},
	}
	const abort = () => {
		void session.close()
	}
	options.signal.addEventListener('abort', abort, { once: true })
	try {
		cancelled(options, () => closed)
		await Promise.all([
			import('foliate-js/epub.js'),
			import('foliate-js/view.js'),
		])
		cancelled(options, () => closed)
		reader = new ZipReader(new BlobReader(options.file))
		const loader = await createBookLoader(reader, options, () => closed)
		const { EPUB } = await import('foliate-js/epub.js')
		const created = new EPUB(loader)
		book = created
		await awaitOwned(created.init(), opening.signal, () => created.destroy())
		cancelled(options, () => closed)
		removeHooks = sanitizeHooks(book, opening.signal)
		if (book.rendition.layout === 'pre-paginated')
			book.rendition.spread = 'none'
		surface = document.createElement('div')
		surface.dataset.readerSpread = 'true'
		surface.style.cssText =
			'display:grid;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;'
		options.host.append(surface)
		const primaryPane = makePane(surface, 'primary')
		panes = [primaryPane]
		await awaitOwned(primaryPane.view.open(book), opening.signal, () =>
			primaryPane.view.close(),
		)
		cancelled(options, () => closed)
		bindLinks(primaryPane)
		setPaneStyles(primaryPane, settings)
		if (active) bindPane(primaryPane)
		await awaitOwned(
			primaryPane.view.init({ showTextStart: false }),
			opening.signal,
			() => primaryPane.view.close(),
		)
		cancelled(options, () => closed)
		await awaitPaneLayout(primaryPane, opening.signal)
		cancelled(options, () => closed)
		rememberAnchor()
		session.initialRestoreFailed = await restoreInitialLocation(
			session,
			options,
			() => closed,
		)
		cancelled(options, () => closed)
		panes[0].view.addEventListener('relocate', notify)
		if (active)
			removeHostInput = bindHostInput(
				options.host,
				book.dir === 'rtl' ? 'rtl' : 'ltr',
				(next) => {
					if (!active) return
					return next ? session.next() : session.prev()
				},
			)
		session.dir = book.dir === 'rtl' ? 'rtl' : 'ltr'
		session.toc = (book.toc ?? []) as TocItem[]
		resize = new ResizeObserver(() => {
			resizeDirty = true
			if (resizePending) return
			resizePending = true
			void enqueue(async () => {
				try {
					while (resizeDirty && alive()) {
						resizeDirty = false
						await layout(true)
					}
				} finally {
					resizePending = false
				}
			})
		})
		resize.observe(options.host)
		await enqueue(() => layout(Boolean(readingAnchor)), true)
		cancelled(options, () => closed)
		notify()
		return session
	} catch (error) {
		await session.close()
		throw error
	}
}
