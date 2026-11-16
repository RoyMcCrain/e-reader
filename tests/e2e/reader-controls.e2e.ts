import { expect, test } from '@playwright/test'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'

const makeEpub = async (direction: 'ltr' | 'rtl' = 'ltr') => {
  const writer = new ZipWriter(new BlobWriter())
  const chapters = ['Opening', 'Middle', 'Ending']
  const manifest = chapters
    .map(
      (_, index) =>
        `<item id="c${index}" href="c${index}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join('')
  const spine = chapters
    .map((_, index) => `<itemref idref="c${index}"/>`)
    .join('')
  const links = chapters
    .map(
      (chapter, index) =>
        `<li><a href="c${index}.xhtml">${chapter} chapter with a deliberately long table of contents label for narrow screens</a></li>`,
    )
    .join('')
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" dir="${direction}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">controls-test</dc:identifier><dc:title>Controls</dc:title><dc:language>en</dc:language></metadata><manifest>${manifest}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine page-progression-direction="${direction}">${spine}</spine></package>`,
    'nav.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${links}</ol></nav></body></html>`,
    ...Object.fromEntries(
      chapters.map((chapter, index) => [
        `c${index}.xhtml`,
        `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${chapter} content</p></body></html>`,
      ]),
    ),
  }
  for (const [name, content] of Object.entries(files))
    await writer.add(name, new TextReader(content))
  return Buffer.from(await (await writer.close()).arrayBuffer())
}

const openBook = async (
  page: import('@playwright/test').Page,
  direction: 'ltr' | 'rtl',
) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles({
    name: `${`${direction} synthetic `.repeat(5).trim()}.epub`,
    mimeType: 'application/epub+zip',
    buffer: await makeEpub(direction),
  })
  await expect(page.getByRole('status')).toBeHidden()
  await expect(page.getByRole('button', { name: '次へ' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '目次' })).toBeEnabled()
  await expect
    .poll(() =>
      page
        .locator('foliate-view')
        .first()
        .evaluate(
          (element) =>
            (
              element as HTMLElement & {
                renderer?: { getContents(): { doc: Document }[] }
              }
            ).renderer?.getContents()[0]?.doc.body.innerText,
        ),
    )
    .toContain('Opening content')
}
const content = (page: import('@playwright/test').Page) =>
  page
    .locator('foliate-view')
    .first()
    .evaluate(
      (element) =>
        (
          element as HTMLElement & {
            renderer?: { getContents(): { doc: Document }[] }
          }
        ).renderer?.getContents()[0]?.doc.body.innerText,
    )

test('LTR and RTL navigation layout, footer geometry, and successful turns', async ({
  page,
}) => {
  for (const direction of ['ltr', 'rtl'] as const) {
    await page.setViewportSize({ width: 320, height: 720 })
    await openBook(page, direction)
    const previous = page.getByRole('button', { name: '前へ' })
    const next = page.getByRole('button', { name: '次へ' })
    const prevBox = await previous.boundingBox()
    const nextBox = await next.boundingBox()
    if (direction === 'rtl') expect(nextBox!.x).toBeLessThan(prevBox!.x)
    else expect(prevBox!.x).toBeLessThan(nextBox!.x)
    const header = page.locator('header')
    const stage = page.getByRole('main', { name: '読書ページ' })
    const footer = page.locator('footer')
    await expect(header).toBeVisible()
    const headerBox = await header.boundingBox()
    const stageBox = await stage.boundingBox()
    const footerBox = await footer.boundingBox()
    expect(footerBox!.height).toBeLessThanOrEqual(56)
    expect(stageBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height)
    expect(footerBox!.y).toBeGreaterThanOrEqual(stageBox!.y + stageBox!.height)
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(720)
    for (const button of [previous, next]) {
      const box = await button.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    await expect(page.getByRole('button', { name: '本を閉じる' })).toHaveCSS(
      'direction',
      'ltr',
    )
    await expect(page.getByRole('button', { name: '設定' })).toHaveCSS(
      'direction',
      'ltr',
    )
    const progressbar = page.getByRole('progressbar', { name: '読書の進捗' })
    await expect(progressbar).toBeVisible()
    await expect(progressbar).toHaveAttribute('aria-valuetext', /本全体の目安/)
    await expect(page.getByTitle(/本全体の目安/)).toBeVisible()
    await expect(page.locator('footer').getByText(/^\d+%$/)).toHaveAttribute(
      'dir',
      'ltr',
    )
    await expect(footer).not.toContainText(
      /前へ|次へ|本全体の目安|あと\d+ページ|最終ページ/,
    )
    await expect(previous).toHaveText('')
    await expect(next).toHaveText('')
    await next.click()
    await expect.poll(() => content(page)).toContain('Middle content')
    await next.click()
    await expect.poll(() => content(page)).toContain('Ending content')
    await expect(progressbar).toHaveAttribute(
      'aria-valuetext',
      /100%、最終ページ/,
    )
    await expect(footer).toHaveText('100%')
    const geometry = await page.evaluate(() => {
      const footer = document.querySelector('footer')!
      const progress = footer.querySelector('[role="progressbar"]')!
      const buttons = [...footer.querySelectorAll('button')]
      const bounds = (element: Element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right }
      }
      return {
        progress: bounds(progress),
        buttons: buttons.map((button) => ({
          ...bounds(button),
          label: button.innerText,
          wraps: button.scrollHeight > button.clientHeight,
        })),
      }
    })
    for (const button of geometry.buttons) {
      expect(button.wraps).toBe(false)
      expect(
        button.left >= geometry.progress.right ||
          button.right <= geometry.progress.left,
      ).toBe(true)
    }
    await previous.click()
    await expect.poll(() => content(page)).toContain('Middle content')
    await expect(progressbar).not.toHaveAttribute('aria-valuetext', /100%/)
    const closeBox = await header
      .getByRole('button', { name: '本を閉じる' })
      .boundingBox()
    const tocBox = await header
      .getByRole('button', { name: '目次', exact: true })
      .boundingBox()
    const settingsBox = await header
      .getByRole('button', { name: '設定' })
      .boundingBox()
    expect(closeBox!.x).toBeLessThan(tocBox!.x)
    expect(tocBox!.x).toBeLessThan(settingsBox!.x)
    const title = header.locator('span[title]')
    await expect(title).toHaveAttribute(
      'title',
      `${`${direction} synthetic `.repeat(5).trim()}`,
    )
    expect(
      await title.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true)
    const fill = progressbar.locator('span')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(fill).toHaveCSS('transition-duration', '0s')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 1280)
    await page.goto('/')
  }
})

test('TOC modal semantics, keyboard isolation, dismissal, and route lifecycle', async ({
  page,
}) => {
  await openBook(page, 'ltr')
  const trigger = page
    .locator('header')
    .getByRole('button', { name: '目次', exact: true })
  const dialog = page.getByRole('dialog', { name: '目次', exact: true })
  const initial = await content(page)
  await trigger.click()
  await expect(dialog).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await dialog.evaluate((element) => element.focus())
  const keyEvents = await page.evaluateHandle(() => {
    const keys: string[] = []
    const listener = (event: KeyboardEvent) => keys.push(event.key)
    document.addEventListener('keydown', listener)
    return {
      keys,
      dispose: () => document.removeEventListener('keydown', listener),
    }
  })
  try {
    await page.keyboard.press('PageDown')
    await page.keyboard.press('ArrowRight')
    expect(await keyEvents.evaluate(({ keys }) => keys)).toEqual([])
    await expect.poll(() => content(page)).toBe(initial)
  } finally {
    await keyEvents.evaluate(({ dispose }) => dispose())
    await keyEvents.dispose()
  }
  const dialogBox = await dialog.boundingBox()
  await dialog.click({
    position: { x: dialogBox!.width - 8, y: dialogBox!.height - 8 },
  })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()

  await trigger.click()
  await dialog
    .getByRole('navigation', { name: '目次' })
    .getByRole('button', { name: /Middle chapter/ })
    .click()
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await expect.poll(() => content(page)).toContain('Middle content')

  await trigger.click()
  await page.mouse.click(2, 2)
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()

  await page.getByRole('button', { name: '設定' }).click()
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
  await page.getByRole('button', { name: '読書に戻る' }).click()
  await expect(trigger).toBeVisible()
  await trigger.click()
  await expect(dialog).toBeVisible()
  await page.goBack()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByLabel('文字サイズの値')).toBeVisible()
  await page.getByRole('button', { name: '読書に戻る' }).click()
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog).not.toBeVisible()
})
