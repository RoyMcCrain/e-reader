import { expect, test } from '@playwright/test'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'
import { collapse } from 'foliate-js/epubcfi.js'

interface PositionView extends HTMLElement {
  lastLocation?: { cfi?: string }
  renderer?: {
    getContents(): Array<{ doc: Document; index: number }>
  } | null
  resolveCFI(cfi: string): {
    index: number
    anchor(doc: Document): Range
  }
}

const makeEpub = async (direction: 'ltr' | 'rtl') => {
  const writer = new ZipWriter(new BlobWriter())
  const paragraphs = Array.from(
    { length: 180 },
    (_, index) =>
      `<p>Paragraph ${index} <span>${'Reading position with nested text and ruby '.repeat(12)}<ruby>漢字<rt>かんじ</rt></ruby></span></p>`,
  ).join('')
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" dir="${direction}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">position-${direction}</dc:identifier><dc:title>Position</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine page-progression-direction="${direction}"><itemref idref="chapter"/></spine></package>`,
    'chapter.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><style>body { font-family: monospace; font-size: 11px; line-height: 1.1; }</style></head><body style="writing-mode:${direction === 'rtl' ? 'vertical-rl' : 'horizontal-tb'}">${paragraphs}</body></html>`,
  }
  for (const [name, content] of Object.entries(files))
    await writer.add(name, new TextReader(content))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

for (const direction of ['ltr', 'rtl'] as const) {
  test(`EPUB ${direction} reflow retains a mid-chapter reading point`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.locator('input[type=file]').setInputFiles({
      name: `${direction}.epub`,
      mimeType: 'application/epub+zip',
      buffer: Buffer.from(await makeEpub(direction)),
    })
    const view = page.locator('[data-reader-page="primary"] foliate-view')
    await expect(
      page.getByText('本を開いています…', { exact: true }),
    ).toBeHidden()
    await expect
      .poll(() =>
        view.evaluate((el) => Boolean((el as PositionView).lastLocation?.cfi)),
      )
      .toBe(true)

    const flushLayout = () =>
      view.evaluate(async (el) => {
        const doc = (el as PositionView).renderer?.getContents()[0]?.doc
        if (!doc?.defaultView) return
        await new Promise<void>((resolve) =>
          doc.defaultView!.requestAnimationFrame(() =>
            doc.defaultView!.requestAnimationFrame(() => resolve()),
          ),
        )
      })
    const waitForLayout = async (fontSize: number, lineHeight: number) => {
      await expect
        .poll(() =>
          view.evaluate(
            (el, expected) => {
              const doc = (el as PositionView).renderer?.getContents()[0]?.doc
              if (!doc) return false
              const style = doc.defaultView?.getComputedStyle(doc.body)
              const font = Number.parseFloat(style?.fontSize ?? '')
              const line = Number.parseFloat(style?.lineHeight ?? '')
              return (
                Math.abs(font - expected.fontSize) < 0.1 &&
                Math.abs(line - expected.lineHeight) < 0.5
              )
            },
            { fontSize, lineHeight },
          ),
        )
        .toBe(true)
      await flushLayout()
    }
    const next = page.getByRole('button', { name: '次へ' })
    for (let index = 0; index < 6; index++) {
      const previous = await view.evaluate(
        (el) => (el as PositionView).lastLocation?.cfi,
      )
      await next.click()
      await expect
        .poll(() =>
          view.evaluate((el) => (el as PositionView).lastLocation?.cfi),
        )
        .not.toBe(previous)
    }

    const capturePoint = async () => {
      const cfi = await view.evaluate(
        (el) => (el as PositionView).lastLocation?.cfi,
      )
      if (!cfi) throw new Error('EPUB location is not ready')
      return collapse(cfi)
    }
    const preservesPoint = (savedCfi: string) =>
      view.evaluate((el, cfi) => {
        const epub = el as PositionView
        const location = epub.lastLocation
        const contents = epub.renderer?.getContents()
        const content = contents?.[0]
        if (!location?.cfi || !content) return false
        try {
          const saved = epub.resolveCFI(cfi)
          const current = epub.resolveCFI(location.cfi)
          const point = saved.anchor(content.doc)
          const child = point.startContainer.childNodes[point.startOffset]
          // A paragraph boundary and its first text offset denote the same reading point.
          if (child?.nodeType === Node.TEXT_NODE) point.setStart(child, 0)
          return (
            saved.index === content.index &&
            current.index === content.index &&
            current
              .anchor(content.doc)
              .comparePoint(point.startContainer, point.startOffset) === 0
          )
        } catch {
          return false
        }
      }, savedCfi)
    const apply = async (
      label: string,
      value: string,
      fontSize: number,
      lineHeight: number,
    ) => {
      const input = page.getByLabel(label)
      await input.fill(value)
      await input.press('Tab')
      await waitForLayout(fontSize, lineHeight)
    }

    await waitForLayout(18, 32.4)
    await page.getByRole('button', { name: '設定' }).click()
    let saved = await capturePoint()
    await apply('文字サイズの値', '24', 24, 43.2)
    await expect.poll(() => preservesPoint(saved)).toBe(true)
    await apply('行間の値', '2.1', 24, 50.4)
    await expect.poll(() => preservesPoint(saved)).toBe(true)
    await apply('左の値', '24', 24, 50.4)
    await expect.poll(() => preservesPoint(saved)).toBe(true)
    await page.getByRole('button', { name: '読書に戻る' }).click()
    await expect.poll(() => preservesPoint(saved)).toBe(true)

    const beforeSecondVisit = await view.evaluate(
      (el) => (el as PositionView).lastLocation?.cfi,
    )
    await next.click()
    await expect
      .poll(() => view.evaluate((el) => (el as PositionView).lastLocation?.cfi))
      .not.toBe(beforeSecondVisit)
    await page.getByRole('button', { name: '設定' }).click()
    saved = await capturePoint()
    await apply('文字サイズの値', '20', 20, 42)
    await expect.poll(() => preservesPoint(saved)).toBe(true)
    await page.getByRole('button', { name: '読書に戻る' }).click()
    await expect.poll(() => preservesPoint(saved)).toBe(true)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => preservesPoint(saved)).toBe(true)
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect.poll(() => preservesPoint(saved)).toBe(true)
  })
}
