import { expect, test, type Page } from '@playwright/test'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'

type Direction = 'ltr' | 'rtl'

const makeEpub = async (direction: Direction) => {
  const writer = new ZipWriter(new BlobWriter())
  const paragraphs = Array.from(
    { length: 120 },
    (_, index) =>
      `<p>Gesture fixture paragraph ${index + 1}. ${'Reading follows the moving page. '.repeat(8)}</p>`,
  ).join('')
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" dir="${direction}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">swipe-${direction}</dc:identifier><dc:title>Swipe fixture</dc:title><dc:language>ja</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine page-progression-direction="${direction}"><itemref idref="chapter"/></spine></package>`,
    'chapter.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Swipe fixture</title></head><body style="writing-mode: ${direction === 'rtl' ? 'vertical-rl' : 'horizontal-tb'}">${paragraphs}</body></html>`,
  }
  for (const [name, content] of Object.entries(files))
    await writer.add(name, new TextReader(content))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

const epubState = (page: Page) =>
  page.locator('foliate-view').evaluate((element) => {
    const view = element as HTMLElement & {
      renderer: HTMLElement & {
        atStart?: boolean
        atEnd?: boolean
        getContents(): Array<{ doc: Document }>
      }
      lastLocation?: { cfi?: string }
    }
    const renderer = view.renderer
    const computed = getComputedStyle(view)
    return {
      cfi: view.lastLocation?.cfi,
      transform: computed.transform,
      x: view.getBoundingClientRect().x,
      width: view.getBoundingClientRect().width,
      animations: view.getAnimations().length,
      atStart: renderer.atStart,
      atEnd: renderer.atEnd,
    }
  })

const touch = async (
  page: Page,
  x: number,
  y: number,
  dx: number,
  end: 'touchEnd' | 'touchCancel' = 'touchEnd',
) => {
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + dx, y }],
  })
  await session.send('Input.dispatchTouchEvent', { type: end, touchPoints: [] })
  await session.detach()
}

for (const direction of ['ltr', 'rtl'] as const) {
  test(`EPUB ${direction} swipe follows the page and settles cleanly`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.locator('input[type=file]').setInputFiles({
      name: `swipe-${direction}.epub`,
      mimeType: 'application/epub+zip',
      buffer: Buffer.from(await makeEpub(direction)),
    })
    const foliate = page.locator('foliate-view')
    await expect(foliate).toHaveCount(1)
    await page
      .getByText('本を開いています…', { exact: true })
      .waitFor({ state: 'hidden' })
    await expect.poll(async () => (await epubState(page)).cfi).toBeTruthy()

    const first = await epubState(page)
    await foliate.evaluate((element) =>
      (element as HTMLElement & { next(): Promise<void> }).next(),
    )
    await expect
      .poll(async () => (await epubState(page)).cfi)
      .not.toBe(first.cfi)
    const calibratedNext = (await epubState(page)).cfi
    await foliate.evaluate((element) =>
      (element as HTMLElement & { prev(): Promise<void> }).prev(),
    )
    await expect.poll(async () => (await epubState(page)).cfi).toBe(first.cfi)

    const bounds = await page.getByLabel('読書ページ').boundingBox()
    if (!bounds) throw new Error('Reader page has no bounds')
    const x = bounds.x + bounds.width * 0.65
    const y = bounds.y + bounds.height * 0.5
    await touch(page, x, y, direction === 'rtl' ? -70 : 70)
    await expect.poll(async () => (await epubState(page)).animations).toBe(0)
    expect((await epubState(page)).cfi).toBe(first.cfi)
    const dx = direction === 'rtl' ? 70 : -70
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    })
    for (const distance of [dx / 2, dx]) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + distance, y }],
      })
      await page.evaluate(() => new Promise(requestAnimationFrame))
      const held = await epubState(page)
      expect(held.cfi).toBe(first.cfi)
      expect(held.x).toBeCloseTo(first.x + distance, 0)
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await expect
      .poll(async () => (await epubState(page)).cfi)
      .toBe(calibratedNext)
    await expect
      .poll(async () => (await epubState(page)).transform)
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/)
    await expect.poll(async () => (await epubState(page)).animations).toBe(0)

    const settled = await epubState(page)
    const returnDx = direction === 'rtl' ? -20 : 20
    await touch(page, x, y, returnDx)
    expect((await epubState(page)).cfi).toBe(settled.cfi)

    const rapidStart = settled.cfi
    await touch(page, x, y, dx)
    await touch(page, x, y, dx)
    await expect
      .poll(async () => (await epubState(page)).cfi)
      .not.toBe(rapidStart)
    await page.waitForTimeout(350)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reducedBefore = (await epubState(page)).cfi
    const reducedTarget = direction === 'rtl' ? -70 : 70
    await touch(page, x, y, reducedTarget)
    await expect
      .poll(async () => (await epubState(page)).cfi)
      .not.toBe(reducedBefore)
    await expect.poll(async () => (await epubState(page)).animations).toBe(0)
    await page.emulateMedia({ reducedMotion: 'no-preference' })

    const atStart = await epubState(page)
    await touch(page, x, y, direction === 'rtl' ? 70 : -70, 'touchCancel')
    await expect
      .poll(async () => (await epubState(page)).transform)
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/)
    expect((await epubState(page)).cfi).toBe(atStart.cfi)
    await page.getByRole('button', { name: '本を閉じる' }).click()
    await expect(foliate).toHaveCount(0)
  })
}
