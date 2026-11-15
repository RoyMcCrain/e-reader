import { expect, test, type Browser } from '@playwright/test'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'

type Direction = 'ltr' | 'rtl'

const makeEpub = async (direction: Direction) => {
  const writer = new ZipWriter(new BlobWriter())
  const paragraphs = Array.from(
    { length: 180 },
    (_, index) =>
      `<p>Gesture spread fixture ${index + 1}. ${'A generated sentence for pagination. '.repeat(9)}</p>`,
  ).join('')
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" dir="${direction}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">gesture-${direction}</dc:identifier><dc:title>Gesture fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine page-progression-direction="${direction}"><itemref idref="chapter"/></spine></package>`,
    'chapter.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Gesture fixture</title></head><body style="writing-mode:${direction === 'rtl' ? 'vertical-rl' : 'horizontal-tb'}">${paragraphs}</body></html>`,
  }
  for (const [name, content] of Object.entries(files))
    await writer.add(name, new TextReader(content))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

const state = (page: import('@playwright/test').Page) =>
  page.locator('foliate-view').evaluateAll((views) =>
    views.map((element) => {
      const view = element as HTMLElement & {
        lastLocation?: { cfi?: string }
        renderer?: { atEnd?: boolean }
      }
      const bounds = view.getBoundingClientRect()
      return {
        cfi: view.lastLocation?.cfi,
        x: bounds.x,
        transform: getComputedStyle(
          element.closest('[data-reader-spread]') as Element,
        ).transform,
        animations: element.closest('[data-reader-spread]')?.getAnimations()
          .length,
        atEnd:
          element
            .closest('[data-reader-spread]')
            ?.getAttribute('data-at-end') === 'true',
      }
    }),
  )

const openBook = async (browser: Browser, direction: Direction) => {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    hasTouch: true,
  })
  const page = await context.newPage()
  await page.addInitScript(() => {
    localStorage.setItem(
      'shiori.reader.settings.v1',
      JSON.stringify({ spread: 'double' }),
    )
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles({
    name: `gesture-${direction}.epub`,
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(await makeEpub(direction)),
  })
  await expect(page.locator('foliate-view')).toHaveCount(2)
  await page
    .getByText('本を開いています…', { exact: true })
    .waitFor({ state: 'hidden' })
  await expect.poll(async () => (await state(page))[1]?.cfi).toBeTruthy()
  return { context, page }
}

const dispatchSwipe = async (
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  dx: number,
) => {
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  })
  for (const distance of [dx / 3, (dx * 2) / 3, dx]) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + distance, y }],
    })
    await page.evaluate(() => new Promise(requestAnimationFrame))
  }
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await session.detach()
}

for (const direction of ['ltr', 'rtl'] as const) {
  test(`EPUB ${direction} spread tracks one multi-step touch as a unit`, async ({
    browser,
  }) => {
    const { context, page } = await openBook(browser, direction)
    const before = await state(page)
    const bounds = await page
      .locator('[data-reader-page="secondary"] foliate-view')
      .boundingBox()
    if (!bounds) throw new Error('Secondary EPUB page has no bounds')
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    const dx = direction === 'ltr' ? -120 : 120
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    })
    for (const distance of [dx / 3, (dx * 2) / 3, dx]) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + distance, y }],
      })
      await page.evaluate(() => new Promise(requestAnimationFrame))
      const moving = await state(page)
      expect(moving.map((pane, index) => pane.x - before[index].x)).toEqual([
        expect.closeTo(distance, 0),
        expect.closeTo(distance, 0),
      ])
      expect(moving.map((pane) => pane.cfi)).toEqual(
        before.map((pane) => pane.cfi),
      )
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await session.detach()
    await expect
      .poll(async () => (await state(page)).map((pane) => pane.cfi))
      .not.toEqual(before.map((pane) => pane.cfi))
    await expect
      .poll(async () => (await state(page)).map((pane) => pane.transform))
      .toEqual(['none', 'none'])
    const settled = await state(page)
    const next = page.getByRole('button', { name: '次へ' })
    const previous = page.getByRole('button', { name: '前へ' })
    let reference = settled.map((pane) => pane.cfi)
    for (let turn = 0; turn < 2; turn++) {
      await next.click()
      await expect
        .poll(async () => (await state(page)).map((pane) => pane.cfi))
        .not.toEqual(reference)
      reference = (await state(page)).map((pane) => pane.cfi)
    }
    const twoSpreadsAhead = reference
    for (let turn = 0; turn < 2; turn++) {
      await previous.click()
      await expect
        .poll(async () => (await state(page)).map((pane) => pane.cfi))
        .not.toEqual(reference)
      reference = (await state(page)).map((pane) => pane.cfi)
    }
    await expect
      .poll(async () => (await state(page)).map((pane) => pane.cfi))
      .toEqual(settled.map((pane) => pane.cfi))
    await dispatchSwipe(page, x, y, dx)
    await dispatchSwipe(page, x, y, dx)
    await expect
      .poll(async () => (await state(page)).map((pane) => pane.cfi))
      .toEqual(twoSpreadsAhead)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reducedBefore = await state(page)
    await dispatchSwipe(page, x, y, dx)
    await expect
      .poll(async () => (await state(page)).map((pane) => pane.cfi))
      .not.toEqual(reducedBefore.map((pane) => pane.cfi))
    expect((await state(page)).map((pane) => pane.x)).toEqual(
      reducedBefore.map((pane) => pane.x),
    )
    expect((await state(page)).map((pane) => pane.animations)).toEqual([0, 0])
    await context.close()
    expect(settled[0].cfi).not.toBe(before[0].cfi)
  })

  test(`EPUB ${direction} iframe controls do not claim swipes or stale clicks`, async ({
    browser,
  }) => {
    const { context, page } = await openBook(browser, direction)
    const bounds = await page.getByLabel('読書ページ').boundingBox()
    if (!bounds) throw new Error('Reader page has no bounds')
    await dispatchSwipe(
      page,
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
      direction === 'ltr' ? -100 : 100,
    )
    const freshTap = await page
      .locator('foliate-view')
      .first()
      .evaluate((element) => {
        const view = element as HTMLElement & {
          renderer?: { getContents(): Array<{ doc: Document }> }
        }
        const doc = view.renderer?.getContents()[0]?.doc
        if (!doc) throw new Error('EPUB iframe document is unavailable')
        const anchor = doc.createElement('a')
        anchor.href = '#gesture-destination'
        doc.body.append(anchor)
        let reached = false
        anchor.addEventListener('click', () => {
          reached = true
        })
        const touch = new Touch({
          identifier: 1,
          target: anchor,
          clientX: 30,
          clientY: 30,
        })
        anchor.dispatchEvent(
          new TouchEvent('touchstart', {
            bubbles: true,
            touches: [touch],
            targetTouches: [touch],
            changedTouches: [touch],
          }),
        )
        anchor.dispatchEvent(
          new TouchEvent('touchend', {
            bubbles: true,
            changedTouches: [touch],
          }),
        )
        const click = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        })
        anchor.dispatchEvent(click)
        return reached
      })
    expect(freshTap).toBe(true)
    await context.close()
  })

  test(`EPUB ${direction} input detaches in settings and rebinds once on return`, async ({
    browser,
  }) => {
    const { context, page } = await openBook(browser, direction)
    const beforeState = await state(page)
    const before = beforeState.map((pane) => pane.cfi)
    const key = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    await page.getByRole('button', { name: '設定' }).click()
    await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
    await page.keyboard.press(key)
    await page
      .locator('foliate-view')
      .first()
      .evaluate((element, pressedKey) => {
        const view = element as HTMLElement & {
          renderer?: { getContents(): Array<{ doc: Document }> }
        }
        view.renderer
          ?.getContents()[0]
          ?.doc.dispatchEvent(
            new KeyboardEvent('keydown', { key: pressedKey, bubbles: true }),
          )
      }, key)
    expect((await state(page)).map((pane) => pane.cfi)).toEqual(before)
    expect((await state(page)).map((pane) => pane.transform)).toEqual(
      beforeState.map((pane) => pane.transform),
    )
    await page.getByRole('button', { name: '読書に戻る' }).click()
    const next = page.getByRole('button', { name: '次へ' })
    const previous = page.getByRole('button', { name: '前へ' })
    await next.click()
    const expectedOneTurn = (await state(page)).map((pane) => pane.cfi)
    await previous.click()
    await expect
      .poll(async () => (await state(page)).map((pane) => pane.cfi))
      .toEqual(before)
    await page.evaluate((pressedKey) => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: pressedKey, bubbles: true }),
      )
    }, key)
    await expect
      .poll(async () => (await state(page)).map((pane) => pane.cfi))
      .toEqual(expectedOneTurn)
    await context.close()
  })

  test(`EPUB ${direction} snaps back on short and cancelled touches and clamps at the final spread`, async ({
    browser,
  }) => {
    const { context, page } = await openBook(browser, direction)
    const before = await state(page)
    const bounds = (await page.getByLabel('読書ページ').boundingBox())!
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await dispatchSwipe(page, x, y, direction === 'ltr' ? -20 : 20)
    expect((await state(page)).map((pane) => pane.cfi)).toEqual(
      before.map((pane) => pane.cfi),
    )
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    })
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (direction === 'ltr' ? -90 : 90), y }],
    })
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    })
    await session.detach()
    await expect
      .poll(async () => (await state(page)).map((pane) => pane.transform))
      .toEqual(['none', 'none'])
    expect((await state(page)).map((pane) => pane.cfi)).toEqual(
      before.map((pane) => pane.cfi),
    )
    const paneBounds = await page.locator('foliate-view').evaluateAll((views) =>
      views.map((view) => {
        const rect = view.getBoundingClientRect()
        return {
          left: rect.left,
          right: rect.right,
          y: rect.top + rect.height / 2,
        }
      }),
    )
    const gutterX = (paneBounds[0].right + paneBounds[1].left) / 2
    const hostTouch = await page.context().newCDPSession(page)
    await hostTouch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: gutterX, y: paneBounds[0].y }],
    })
    await hostTouch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: gutterX + (direction === 'ltr' ? -80 : 80), y: paneBounds[0].y },
      ],
    })
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const dragged = await state(page)
    expect(
      dragged.map((pane, index) => pane.x - paneBounds[index].left),
    ).toEqual([
      expect.closeTo(direction === 'ltr' ? -80 : 80, 0),
      expect.closeTo(direction === 'ltr' ? -80 : 80, 0),
    ])
    await hostTouch.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    })
    await hostTouch.detach()
    await expect
      .poll(async () => (await state(page)).map((pane) => pane.transform))
      .toEqual(['none', 'none'])
    expect((await state(page)).map((pane) => pane.cfi)).toEqual(
      before.map((pane) => pane.cfi),
    )

    const next = page.getByRole('button', { name: '次へ' })
    while (!(await state(page))[0].atEnd) await next.click()
    const final = await state(page)
    const dx = direction === 'ltr' ? -90 : 90
    await dispatchSwipe(page, x, y, dx)
    await expect
      .poll(async () => (await state(page)).map((pane) => pane.transform))
      .toEqual(['none', 'none'])
    expect((await state(page)).map((pane) => pane.cfi)).toEqual(
      final.map((pane) => pane.cfi),
    )
    await context.close()
  })
}
