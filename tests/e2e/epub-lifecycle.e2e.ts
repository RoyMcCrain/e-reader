import { expect, test } from '@playwright/test'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'

const makeEpub = async () => {
	const writer = new ZipWriter(new BlobWriter())
	const files = {
		mimetype: 'application/epub+zip',
		'META-INF/container.xml':
			'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
		'book.opf':
			'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="life">life</dc:identifier><dc:title>Lifecycle</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
		'chapter.xhtml':
			'<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Generated lifecycle fixture</p></body></html>',
	}
	for (const [name, content] of Object.entries(files))
		await writer.add(name, new TextReader(content))
	return Buffer.from(await (await writer.close()).arrayBuffer())
}

test('aborting during primary open closes a renderer allocated by late completion', async ({
	page,
}) => {
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	const fixture = [...(await makeEpub())]
	await page.evaluate(async (bytes) => {
		const readerModule = '/src/lib/reader/epub.ts'

		const { openEpub } = (await import(
			readerModule
		)) as typeof import('#lib/reader/epub')
		const host = document.createElement('div')
		host.style.cssText = 'position:fixed;width:800px;height:600px;'
		document.body.append(host)
		const settings = {
			fontFamily: 'publisher' as const,
			fontSize: 18,
			lineHeight: 1.8,
			marginTop: 8,
			marginRight: 8,
			marginBottom: 8,
			marginLeft: 8,
			spread: 'single' as const,
			firstPageSingle: false,
			gutter: 16,
		}
		let restoreView = () => {}
		const originalDefine = customElements.define.bind(customElements)
		let start!: () => void
		let release!: () => void
		const started = new Promise<void>((resolve) => (start = resolve))
		const gate = new Promise<void>((resolve) => (release = resolve))
		let primary: HTMLElement | undefined
		let initCalls = 0
		let rendererDestroyCalls = 0
		customElements.define = ((name, constructor, options) => {
			originalDefine(name, constructor, options)
			if (name !== 'foliate-view') return
			const prototype = constructor.prototype as unknown as {
				open: (this: HTMLElement, book: unknown) => Promise<void>
				init: (
					this: HTMLElement,
					options: { showTextStart: boolean },
				) => Promise<void>
			}
			const originalOpen = prototype.open
			const originalInit = prototype.init
			prototype.open = async function (book) {
				if (this.parentElement?.dataset.readerPage === 'primary') {
					primary = this as unknown as HTMLElement
					start()
					await gate
				}
				await originalOpen.call(this, book)
				if (this.parentElement?.dataset.readerPage === 'primary') {
					const renderer = (
						this as unknown as {
							renderer: HTMLElement & { destroy: () => void }
						}
					).renderer
					const destroy = renderer.destroy.bind(renderer)
					renderer.destroy = () => {
						rendererDestroyCalls++
						destroy()
					}
				}
			}
			prototype.init = async function (options) {
				if (this.parentElement?.dataset.readerPage === 'primary') initCalls++
				await originalInit.call(this, options)
			}
			restoreView = () => {
				prototype.open = originalOpen
				prototype.init = originalInit
			}
		}) as typeof customElements.define
		const controller = new AbortController()
		const opening = openEpub({
			file: new File([new Uint8Array(bytes)], 'generated.epub'),
			host,
			settings,
			columns: 1,
			active: false,
			signal: controller.signal,
			onLocation: () => {},
			onError: () => {},
		})
		const outcome = opening.then(
			() => 'resolved',
			(error: unknown) => (error as Error).name,
		)
		Object.assign(window, {
			lifecycleRace: {
				started,
				release,
				controller,
				outcome,
				host,
				get primary() {
					return primary
				},
				get initCalls() {
					return initCalls
				},
				get rendererDestroyCalls() {
					return rendererDestroyCalls
				},
				restore: () => {
					restoreView()
					customElements.define = originalDefine
				},
			},
		})
	}, fixture)
	try {
		await page.evaluate(async () => {
			await (window as unknown as { lifecycleRace: { started: Promise<void> } })
				.lifecycleRace.started
		})
		await page.evaluate(() => {
			;(
				window as unknown as { lifecycleRace: { controller: AbortController } }
			).lifecycleRace.controller.abort()
		})
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { lifecycleRace: { outcome: Promise<string> } })
						.lifecycleRace.outcome,
			),
		).toBe('AbortError')
		await page.evaluate(() => {
			;(
				window as unknown as { lifecycleRace: { release: () => void } }
			).lifecycleRace.release()
		})
		await expect
			.poll(() =>
				page.evaluate(() => {
					const race = (
						window as unknown as {
							lifecycleRace: {
								primary: HTMLElement
								initCalls: number
								rendererDestroyCalls: number
							}
						}
					).lifecycleRace
					return {
						rendererDestroyCalls: race.rendererDestroyCalls,
						initCalls: race.initCalls,
					}
				}),
			)
			.toEqual({ rendererDestroyCalls: 1, initCalls: 0 })
	} finally {
		await page.evaluate(() => {
			const race = (
				window as unknown as {
					lifecycleRace: {
						release: () => void
						restore: () => void
						host: HTMLElement
					}
				}
			).lifecycleRace
			race.release()
			race.restore()
			race.host.remove()
		})
	}
})

test('closing during secondary open closes the renderer allocated by late completion', async ({
	page,
}) => {
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	const fixture = [...(await makeEpub())]
	await page.evaluate(async (bytes) => {
		const readerModule = '/src/lib/reader/epub.ts'

		const { openEpub } = (await import(
			readerModule
		)) as typeof import('#lib/reader/epub')
		const host = document.createElement('div')
		host.style.cssText = 'position:fixed;width:800px;height:600px;'
		document.body.append(host)
		const settings = {
			fontFamily: 'publisher' as const,
			fontSize: 18,
			lineHeight: 1.8,
			marginTop: 8,
			marginRight: 8,
			marginBottom: 8,
			marginLeft: 8,
			spread: 'single' as const,
			firstPageSingle: false,
			gutter: 16,
		}
		let restoreView = () => {}
		const originalDefine = customElements.define.bind(customElements)
		let start!: () => void
		let release!: () => void
		const started = new Promise<void>((resolve) => (start = resolve))
		const gate = new Promise<void>((resolve) => (release = resolve))
		let secondary: HTMLElement | undefined
		let rendererDestroyCalls = 0
		customElements.define = ((name, constructor, options) => {
			originalDefine(name, constructor, options)
			if (name !== 'foliate-view') return
			const prototype = constructor.prototype as unknown as {
				open: (this: HTMLElement, book: unknown) => Promise<void>
			}
			const originalOpen = prototype.open
			prototype.open = async function (book) {
				if (this.parentElement?.dataset.readerPage === 'secondary') {
					secondary = this as unknown as HTMLElement
					start()
					await gate
				}
				await originalOpen.call(this, book)
				if (this.parentElement?.dataset.readerPage === 'secondary') {
					const renderer = (
						this as unknown as {
							renderer: HTMLElement & { destroy: () => void }
						}
					).renderer
					const destroy = renderer.destroy.bind(renderer)
					renderer.destroy = () => {
						rendererDestroyCalls++
						destroy()
					}
				}
			}
			restoreView = () => (prototype.open = originalOpen)
		}) as typeof customElements.define
		const session = await openEpub({
			file: new File([new Uint8Array(bytes)], 'generated.epub'),
			host,
			settings,
			columns: 1,
			active: false,
			signal: new AbortController().signal,
			onLocation: () => {},
			onError: () => {},
		})
		Object.assign(window, {
			lifecycleRace: {
				started,
				release,
				host,
				session,
				configure: session.configure(settings, 2),
				get secondary() {
					return secondary
				},
				get rendererDestroyCalls() {
					return rendererDestroyCalls
				},
				restore: () => {
					restoreView()
					customElements.define = originalDefine
				},
			},
		})
	}, fixture)
	try {
		await page.evaluate(async () => {
			await (window as unknown as { lifecycleRace: { started: Promise<void> } })
				.lifecycleRace.started
		})
		await page.evaluate(async () => {
			const race = (
				window as unknown as {
					lifecycleRace: { session: { close: () => Promise<void> } }
				}
			).lifecycleRace
			await race.session.close()
		})
		await page.evaluate(() => {
			;(
				window as unknown as { lifecycleRace: { release: () => void } }
			).lifecycleRace.release()
		})
		await page.evaluate(async () => {
			await (
				window as unknown as { lifecycleRace: { configure: Promise<void> } }
			).lifecycleRace.configure
		})
		await expect
			.poll(() =>
				page.evaluate(() => {
					const race = (
						window as unknown as {
							lifecycleRace: {
								secondary: HTMLElement
								host: HTMLElement
								rendererDestroyCalls: number
							}
						}
					).lifecycleRace
					return {
						rendererDestroyCalls: race.rendererDestroyCalls,
						hostChildren: race.host.childElementCount,
					}
				}),
			)
			.toEqual({ rendererDestroyCalls: 1, hostChildren: 0 })
	} finally {
		await page.evaluate(() => {
			const race = (
				window as unknown as {
					lifecycleRace: {
						release: () => void
						restore: () => void
						host: HTMLElement
					}
				}
			).lifecycleRace
			race.release()
			race.restore()
			race.host.remove()
		})
	}
})

test('initial spread layout rejects a secondary renderer failure', async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'shiori.reader.settings.v1',
			JSON.stringify({ spread: 'double', firstPageSingle: false }),
		),
	)
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	const fixture = await makeEpub()
	await page.locator('input[type=file]').setInputFiles({
		name: 'generated-lifecycle.epub',
		mimeType: 'application/epub+zip',
		buffer: fixture,
	})
	await expect(
		page.getByText('本を開いています…', { exact: true }),
	).toBeHidden()
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await page.evaluate(() => {
		const prototype = customElements.get('foliate-view')!
			.prototype as unknown as {
			open: (this: HTMLElement, book: unknown) => Promise<void>
		}
		const original = prototype.open
		prototype.open = function (book) {
			if (this.parentElement?.dataset.readerPage === 'secondary')
				return Promise.reject(new Error('secondary failed'))
			return original.call(this, book)
		}
	})
	await page.locator('input[type=file]').setInputFiles({
		name: 'generated-lifecycle.epub',
		mimeType: 'application/epub+zip',
		buffer: fixture,
	})
	await expect(page.getByRole('alert')).toContainText('secondary failed')
	await expect(page.locator('[data-reader-spread]')).toHaveCount(0)
})
