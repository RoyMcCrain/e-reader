import { expect, test, type Locator } from '@playwright/test'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'

const rendererPage = (view: Locator) =>
  view.evaluate(
    (element) =>
      (element as HTMLElement & { renderer?: { page?: number } }).renderer
        ?.page,
  )

const expectTwoPageTurns = async (
  primary: Locator,
  next: Locator,
  sameSectionPeer: () => Promise<boolean>,
) => {
  let baseline = await rendererPage(primary)
  for (let turn = 0; turn < 2; turn++) {
    await next.click()
    await expect.poll(() => rendererPage(primary)).toBe((baseline ?? 0) + 2)
    await expect.poll(sameSectionPeer).toBe(true)
    baseline = await rendererPage(primary)
  }
}

const makeEpub = async (direction: 'ltr' | 'rtl') => {
  const writer = new ZipWriter(new BlobWriter())
  const text = Array.from(
    { length: 100 },
    (_, index) =>
      `<p>頁${index} ${'本文の縦書きとルビ <ruby>漢字<rt>かんじ</rt></ruby>。'.repeat(12)}</p>`,
  ).join('')
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" dir="${direction}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">spread-${direction}</dc:identifier><dc:title>Spread test</dc:title><dc:language>ja</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine page-progression-direction="${direction}"><itemref idref="chapter"/></spine></package>`,
    'chapter.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><style>.publisher { font-size: 9px; line-height: 1; font-family: monospace; }</style></head><body class="publisher" style="writing-mode:${direction === 'rtl' ? 'vertical-rl' : 'horizontal-tb'}">${text}</body></html>`,
  }
  for (const [name, content] of Object.entries(files))
    await writer.add(name, new TextReader(content))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

const makeShortEpub = async (direction: 'ltr' | 'rtl') => {
  const writer = new ZipWriter(new BlobWriter())
  const sections = ['A', 'B', 'skip', 'C', 'D', 'E']
  const manifest = sections
    .map(
      (name, index) =>
        `<item id="s${index}" href="${name}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join('')
  const spine = sections
    .map(
      (name, index) =>
        `<itemref idref="s${index}"${name === 'skip' ? ' linear="no"' : ''}/>`,
    )
    .join('')
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" dir="${direction}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">short-${direction}</dc:identifier><dc:title>Short</dc:title><dc:language>ja</dc:language></metadata><manifest>${manifest}</manifest><spine page-progression-direction="${direction}">${spine}</spine></package>`,
    ...Object.fromEntries(
      sections.map((name) => [
        `${name}.xhtml`,
        `<html xmlns="http://www.w3.org/1999/xhtml"><body>${name}</body></html>`,
      ]),
    ),
  }
  for (const [name, content] of Object.entries(files))
    await writer.add(name, new TextReader(content))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

const makeImageOnlyEpub = async () => {
  const writer = new ZipWriter(new BlobWriter())
  const sections = ['cover', 'frontispiece', 'chapter', 'chapter2']
  const manifest = sections
    .map(
      (name, index) =>
        `<item id="s${index}" href="${name}.xhtml" media-type="application/xhtml+xml"/><item id="a${index}" href="${name}.svg" media-type="image/svg+xml"/>`,
    )
    .join('')
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" dir="rtl"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">image-only</dc:identifier><dc:title>Image only</dc:title><dc:language>en</dc:language></metadata><manifest>${manifest}</manifest><spine page-progression-direction="rtl">${sections.map((_, index) => `<itemref idref="s${index}"/>`).join('')}</spine></package>`,
    ...Object.fromEntries(
      sections.map((name) => [
        `${name}.xhtml`,
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><style>html,body,div{width:100%;height:100%;margin:0}svg{display:block}</style></head><body><div class="main"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" viewBox="0 0 1443 2048" width="100%" height="100%"><image xlink:href="${name}.svg" width="1443" height="2048"/></svg></div></body></html>`,
      ]),
    ),
    ...Object.fromEntries(
      sections.map(
        (name, index) =>
          [
            `${name}.svg`,
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 1000"><rect width="700" height="1000" fill="${['#d21', '#26c', '#2a6', '#a26'][index]}"/></svg>`,
          ] as const,
      ),
    ),
  }
  for (const [name, content] of Object.entries(files))
    await writer.add(name, new TextReader(content))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

const makeFixedEpub = async () => {
  const writer = new ZipWriter(new BlobWriter())
  const pages = ['P1', 'P2', 'P3']
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="fixed">fixed</dc:identifier><dc:title>Fixed</dc:title><dc:language>ja</dc:language><meta property="rendition:layout">pre-paginated</meta></metadata><manifest>${pages.map((page, index) => `<item id="p${index}" href="${page}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${pages.map((page, index) => `<itemref idref="p${index}"/>`).join('')}</spine></package>`,
    ...Object.fromEntries(
      pages.map((page) => [
        `${page}.xhtml`,
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="viewport" content="width=600,height=800"/></head><body>${page}</body></html>`,
      ]),
    ),
  }
  for (const [name, content] of Object.entries(files))
    await writer.add(name, new TextReader(content))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

test('image-only RTL sections occupy distinct consecutive spread pages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1495, height: 1188 })
  await page.addInitScript(() =>
    localStorage.setItem(
      'shiori.reader.settings.v1',
      JSON.stringify({ spread: 'double' }),
    ),
  )
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles({
    name: 'image-only.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(await makeImageOnlyEpub()),
  })
  const visibleAsset = (name: string) =>
    page
      .locator(`[data-reader-page="${name}"] foliate-view`)
      .evaluate(async (element) => {
        const view = element as HTMLElement & {
          renderer?: {
            getContents(): { index: number; doc: Document }[]
          }
        }
        const content = view.renderer?.getContents()[0]
        return {
          index: content?.index,
          asset: content?.doc
            .querySelector('image')
            ?.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
        }
      })
  const expectedFirstSpread = [
    { index: 0, asset: expect.stringMatching(/^blob:/) },
    { index: 1, asset: expect.stringMatching(/^blob:/) },
  ]
  await expect.soft
    .poll(async () => [
      await visibleAsset('primary'),
      await visibleAsset('secondary'),
    ])
    .toMatchObject(expectedFirstSpread)
  const visiblePixel = async (name: string) => {
    const screenshot = await page
      .locator(`[data-reader-page="${name}"] foliate-view`)
      .screenshot()
    return page.evaluate(async (encoded) => {
      const image = new Image()
      image.src = `data:image/png;base64,${encoded}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 10
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0, 10, 10)
      return [...context.getImageData(5, 5, 1, 1).data].join(',')
    }, screenshot.toString('base64'))
  }
  await expect.soft
    .poll(async () => [
      await visiblePixel('primary'),
      await visiblePixel('secondary'),
    ])
    .toEqual(['221,34,17,255', '34,102,204,255'])
  const sectionIndices = () =>
    page.evaluate(() =>
      ['primary', 'secondary'].map((name) => {
        const view = document.querySelector(
          `[data-reader-page="${name}"] foliate-view`,
        ) as
          | (HTMLElement & {
              renderer?: { getContents(): { index: number }[] }
            })
          | null
        return view?.renderer?.getContents()[0]?.index
      }),
    )
  await page.getByRole('button', { name: '次へ' }).click()
  await expect.poll(sectionIndices).toEqual([2, 3])
  const primaryWidth = () =>
    page
      .locator('[data-reader-page="primary"] foliate-view')
      .evaluate((element) => element.getBoundingClientRect().width)
  const width = await primaryWidth()
  await page.setViewportSize({ width: 1496, height: 1188 })
  await expect.poll(primaryWidth).toBeGreaterThan(width)
  await expect.poll(sectionIndices).toEqual([2, 3])
  await page.setViewportSize({ width: 1495, height: 1188 })
  await expect.poll(primaryWidth).toBe(width)
  await expect.poll(sectionIndices).toEqual([2, 3])
})

test('fixed-layout EPUB navigates real pages and clamps the final spread', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'shiori.reader.settings.v1',
      JSON.stringify({ spread: 'double' }),
    ),
  )
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles({
    name: 'fixed.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(await makeFixedEpub()),
  })
  const text = (name: string) =>
    page
      .locator(`[data-reader-page="${name}"] foliate-view`)
      .evaluate((element) => {
        const view = element as HTMLElement & {
          renderer?: { getContents(): { doc: Document }[] }
        }
        return view.renderer?.getContents()[0]?.doc.body.innerText ?? ''
      })
  await expect
    .poll(async () => `${await text('primary')}|${await text('secondary')}`)
    .toContain('P1|P2')
  await page.getByRole('button', { name: '次へ' }).click()
  await expect.poll(() => text('primary')).toContain('P3')
  await expect(page.getByRole('button', { name: '次へ' })).toBeDisabled()
  await page.getByRole('button', { name: '前へ' }).click()
  await expect
    .poll(async () => `${await text('primary')}|${await text('secondary')}`)
    .toContain('P1|P2')
})

test('resize rebuilds the EPUB spread layout and peer pane', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'shiori.reader.settings.v1',
      JSON.stringify({ spread: 'auto' }),
    ),
  )
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles({
    name: 'resize.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(await makeEpub('ltr')),
  })
  const primary = page.locator('[data-reader-page="primary"] foliate-view')
  await page
    .getByText('本を開いています…', { exact: true })
    .waitFor({ state: 'hidden' })
  await expect(primary).toBeVisible()
  await page.setViewportSize({ width: 700, height: 720 })
  await expect(page.locator('[data-reader-page="secondary"]')).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(page.locator('[data-reader-page="secondary"]')).toBeVisible()
  const peer = page.locator('[data-reader-page="secondary"] foliate-view')
  await expect
    .poll(() =>
      peer.evaluate((element) =>
        Boolean(
          (element as HTMLElement & { lastLocation?: { cfi?: string } })
            .lastLocation?.cfi,
        ),
      ),
    )
    .toBe(true)
})

test('EPUB typography settings override publisher metrics in the rendered layout', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles({
    name: 'styled.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(await makeEpub('ltr')),
  })
  const primary = page.locator('[data-reader-page="primary"] foliate-view')
  const reading = () =>
    primary.evaluate((element) => {
      const view = element as HTMLElement & {
        lastLocation?: { cfi?: string }
        renderer?: { getContents(): { doc: Document }[] }
      }
      const body = view.renderer?.getContents()[0]?.doc.body
      return {
        cfi: view.lastLocation?.cfi,
        font: body ? getComputedStyle(body).fontSize : '',
      }
    })
  await expect.poll(async () => (await reading()).font).toBe('18px')
  const before = await reading()
  await page.getByRole('button', { name: '設定' }).click()
  await page.keyboard.press('ArrowRight')
  expect((await reading()).cfi).toBe(before.cfi)
  const fontSize = page.getByLabel('文字サイズの値')
  await fontSize.fill('26')
  await fontSize.press('Tab')
  await page.getByRole('button', { name: '読書に戻る' }).click()
  await expect.poll(async () => (await reading()).font).toBe('26px')
})

test('internal links from either spread page navigate from the primary pane', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'shiori.reader.settings.v1',
      JSON.stringify({ spread: 'double' }),
    ),
  )
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles({
    name: 'linked.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(await makeShortEpub('ltr')),
  })
  const link = (name: string, href: string) =>
    page
      .locator(`[data-reader-page="${name}"] foliate-view`)
      .evaluate((element, target) => {
        const event = new CustomEvent('link', {
          detail: { href: target },
          cancelable: true,
        })
        element.dispatchEvent(event)
        return event.defaultPrevented
      }, href)
  const text = (name: string) =>
    page
      .locator(`[data-reader-page="${name}"] foliate-view`)
      .evaluate((element) => {
        const view = element as HTMLElement & {
          renderer?: { getContents(): { doc: Document }[] }
        }
        return view.renderer?.getContents()[0]?.doc.body.innerText ?? ''
      })
  expect(await link('secondary', 'C.xhtml')).toBe(true)
  await expect
    .poll(async () => `${await text('primary')}|${await text('secondary')}`)
    .toContain('C|D')
  expect(await link('primary', 'E.xhtml')).toBe(true)
  await expect.poll(() => text('primary')).toContain('E')
})

for (const direction of ['ltr', 'rtl'] as const) {
  test(`EPUB ${direction} skips nonlinear short sections and clamps the final spread`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'shiori.reader.settings.v1',
        JSON.stringify({ spread: 'double' }),
      ),
    )
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.locator('input[type=file]').setInputFiles({
      name: 'short.epub',
      mimeType: 'application/epub+zip',
      buffer: Buffer.from(await makeShortEpub(direction)),
    })
    const bodyText = async (name: string) =>
      page
        .locator(`[data-reader-page="${name}"] foliate-view`)
        .evaluate((element) => {
          const view = element as HTMLElement & {
            renderer?: { getContents(): { doc: Document }[] }
          }
          return view.renderer?.getContents()[0]?.doc.body.innerText ?? ''
        })
    await expect
      .poll(
        async () =>
          `${await bodyText('primary')}|${await bodyText('secondary')}`,
      )
      .toContain('A|B')
    const next = page.getByRole('button', { name: '次へ' })
    const prev = page.getByRole('button', { name: '前へ' })
    await next.click()
    await expect
      .poll(
        async () =>
          `${await bodyText('primary')}|${await bodyText('secondary')}`,
      )
      .toContain('C|D')
    await next.click()
    await expect.poll(() => bodyText('primary')).toContain('E')
    await expect(page.locator('[data-reader-spread]')).toHaveAttribute(
      'data-at-end',
      'true',
    )
    const final = await bodyText('primary')
    await expect(next).toBeDisabled()
    await expect(bodyText('primary')).resolves.toBe(final)
    await prev.click()
    await expect
      .poll(
        async () =>
          `${await bodyText('primary')}|${await bodyText('secondary')}`,
      )
      .toContain('C|D')
    await prev.click()
    await expect
      .poll(
        async () =>
          `${await bodyText('primary')}|${await bodyText('secondary')}`,
      )
      .toContain('A|B')
  })

  test(`EPUB ${direction} presents consecutive synchronized pages as a real spread`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'shiori.reader.settings.v1',
        JSON.stringify({ spread: 'double' }),
      ),
    )
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.locator('input[type=file]').setInputFiles({
      name: `spread-${direction}.epub`,
      mimeType: 'application/epub+zip',
      buffer: Buffer.from(await makeEpub(direction)),
    })
    const primary = page.locator('[data-reader-page="primary"] foliate-view')
    const secondary = page.locator(
      '[data-reader-page="secondary"] foliate-view',
    )
    await expect(primary).toBeVisible()
    await expect(secondary).toBeVisible()
    await expect
      .poll(() =>
        primary.evaluate(
          (element) =>
            (element as HTMLElement & { lastLocation?: { cfi?: string } })
              .lastLocation?.cfi,
        ),
      )
      .toBeTruthy()
    const first = await primary.evaluate(
      (element) =>
        (element as HTMLElement & { lastLocation?: { cfi?: string } })
          .lastLocation?.cfi,
    )
    const firstPage = await primary.evaluate(
      (element) =>
        (element as HTMLElement & { renderer?: { page?: number } }).renderer
          ?.page,
    )
    const sameSectionPeer = async () => {
      const [primaryCfi, secondaryCfi] = await Promise.all([
        primary.evaluate(
          (element) =>
            (element as HTMLElement & { lastLocation?: { cfi?: string } })
              .lastLocation?.cfi,
        ),
        secondary.evaluate(
          (element) =>
            (element as HTMLElement & { lastLocation?: { cfi?: string } })
              .lastLocation?.cfi,
        ),
      ])
      return Boolean(
        primaryCfi &&
        secondaryCfi &&
        primaryCfi.split('!')[0] === secondaryCfi.split('!')[0] &&
        primaryCfi !== secondaryCfi,
      )
    }
    await expect.poll(sameSectionPeer).toBe(true)
    await page.keyboard.press(direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight')
    await expect
      .poll(() =>
        primary.evaluate(
          (element) =>
            (element as HTMLElement & { lastLocation?: { cfi?: string } })
              .lastLocation?.cfi,
        ),
      )
      .not.toBe(first)
    await expect
      .poll(() =>
        primary.evaluate(
          (element) =>
            (element as HTMLElement & { renderer?: { page?: number } }).renderer
              ?.page,
        ),
      )
      .toBe((firstPage ?? 0) + 2)
    await expect.poll(sameSectionPeer).toBe(true)
    const positions = await Promise.all([
      primary.boundingBox(),
      secondary.boundingBox(),
    ])
    expect(positions[0]?.y).toBe(positions[1]?.y)
    if (direction === 'rtl')
      expect(positions[0]!.x).toBeGreaterThan(positions[1]!.x)
    else expect(positions[0]!.x).toBeLessThan(positions[1]!.x)
    const beforeButtonTurn = await primary.evaluate(
      (element) =>
        (element as HTMLElement & { renderer?: { page?: number } }).renderer
          ?.page,
    )
    await page.getByRole('button', { name: '次へ' }).click()
    await expect
      .poll(() =>
        primary.evaluate(
          (element) =>
            (element as HTMLElement & { renderer?: { page?: number } }).renderer
              ?.page,
        ),
      )
      .toBe((beforeButtonTurn ?? 0) + 2)
    await expect.poll(sameSectionPeer).toBe(true)
    await expectTwoPageTurns(
      primary,
      page.getByRole('button', { name: '次へ' }),
      sameSectionPeer,
    )
  })
}
