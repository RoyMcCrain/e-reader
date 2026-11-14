declare module 'foliate-js/epub.js' {
  export interface TocItem {
    label: string
    href: string
    subitems?: TocItem[]
  }
  export interface EpubBook {
    dir?: string
    toc?: TocItem[]
    transformTarget: EventTarget
    init(): Promise<void>
    destroy(): void
  }
  export class EPUB {
    constructor(options: {
      loadText(path: string): Promise<string | null>
      loadBlob(path: string): Promise<Blob | null>
      getSize(path: string): number
    })
    init(): Promise<void>
    dir?: string
    toc?: TocItem[]
    transformTarget: EventTarget
    destroy(): void
  }
}
declare module 'foliate-js/view.js' {
  import type { EpubBook } from 'foliate-js/epub.js'
  export interface FoliateLocation {
    fraction?: number
    cfi?: string
  }
  export interface FoliateContent {
    doc: Document
    index: number
  }
  export interface FoliateViewElement extends HTMLElement {
    open(book: EpubBook): Promise<void>
    init(options: { showTextStart?: boolean }): Promise<void>
    next(): Promise<void>
    prev(): Promise<void>
    goTo(href: string): Promise<void>
    close(): void
    lastLocation?: FoliateLocation
    renderer?: HTMLElement & { getContents(): FoliateContent[] }
    dir?: string
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
