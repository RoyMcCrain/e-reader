declare module 'foliate-js/epub.js' {
	export interface TocItem {
		label: string
		href: string
		subitems?: TocItem[]
	}
	export interface EpubSection {
		linear?: string
		href: string
		cfi?: string
		pageSpread?: 'left' | 'right' | 'center'
	}
	export interface EpubBook {
		dir: string
		toc?: TocItem[]
		sections: EpubSection[]
		rendition: { layout?: string; spread?: string }
		resolveCFI(cfi: string): { index: number; anchor(doc: Document): Range }
		transformTarget: EventTarget
		init(): Promise<void>
		destroy(): void
	}
	export class EPUB {
		constructor(options: {
			loadText(path: string): Promise<string | null> | null
			loadBlob(path: string): Promise<Blob | null> | null
			getSize(path: string): number
		})
		init(): Promise<void>
		dir: string
		toc?: TocItem[]
		transformTarget: EventTarget
		destroy(): void
		sections: EpubSection[]
		rendition: { layout?: string; spread?: string }
		resolveCFI(cfi: string): { index: number; anchor(doc: Document): Range }
	}
}
declare module 'foliate-js/epubcfi.js' {
	export function collapse(cfi: string, toEnd?: boolean): string
}
declare module 'foliate-js/view.js' {
	import type { EpubBook } from 'foliate-js/epub.js'
	export interface FoliateLocation {
		fraction?: number
		cfi?: string
	}
	export interface FoliateContent {
		doc: Document
		index?: number
	}
	export interface FoliateRenderer extends HTMLElement {
		page?: number
		pages?: number
		atStart?: boolean
		atEnd?: boolean
		setStyles?(styles: string | [string, string]): void
		scrollToAnchor?(anchor: number | Range): Promise<void>
		goTo?(target: { index: number; anchor?: number }): Promise<void>
		getContents(): FoliateContent[]
	}
	export interface FoliateViewElement extends HTMLElement {
		open(book: EpubBook): Promise<void>
		init(options: {
			showTextStart?: boolean
			lastLocation?: string
		}): Promise<void>
		next(): Promise<void>
		prev(): Promise<void>
		goTo(href: string): Promise<{ index: number } | null | undefined>
		close(): void
		lastLocation?: FoliateLocation
		renderer?: FoliateRenderer | null
		resolveCFI(cfi: string): { index: number; anchor(doc: Document): Range }
		book: EpubBook | null
	}
	export interface FoliateLoadDetail {
		doc: Document
		index: number
		isScript?: boolean
		allow?: boolean
	}
	export interface FoliateRelocateDetail {
		fraction?: number
		location?: FoliateLocation
	}
	export interface FoliateTransformDetail {
		data: Blob | string | Promise<Blob | string>
		type: string
		name?: string
	}
}
