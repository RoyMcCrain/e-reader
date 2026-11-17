import { expect, test } from '@playwright/test'

test('standalone SVG removes escaped CSS imports while preserving publisher styling', async ({
	page,
}) => {
	const requests: string[] = []
	let localOrigin = ''
	page.on('request', (request) => {
		if (request.url().includes('attacker.invalid')) requests.push(request.url())
	})
	await page.route('**/*', async (route) => {
		const url = route.request().url()
		let isLocal = false
		try {
			isLocal = new URL(url).origin === localOrigin
		} catch {}
		if (
			!localOrigin ||
			isLocal ||
			url.startsWith('blob:') ||
			url.startsWith('data:')
		)
			await route.continue()
		else await route.abort()
	})
	await page.goto('/')
	localOrigin = new URL(page.url()).origin
	const source =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><style>@\\69mport "https://attacker.invalid/standalone.css"; .publisher { fill: rgb(1, 2, 3) }</style><rect class="publisher" width="20" height="20"/></svg>'
	const sanitized = await page.evaluate(async (svg) => {
		const moduleUrl = '/src/lib/reader/security.ts'
		const { secureDocument } = (await import(
			moduleUrl
		)) as typeof import('#lib/reader/security')
		return secureDocument(svg, 'image/svg+xml')
	}, source)
	expect(sanitized).not.toContain('attacker.invalid')
	await page.evaluate((svg) => {
		const iframe = document.createElement('iframe')
		iframe.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
		document.body.append(iframe)
	}, sanitized)
	const frame = page.locator('iframe')
	await expect
		.poll(() =>
			frame.evaluate((element) => {
				const iframe = element as HTMLIFrameElement
				const svg = iframe.contentDocument?.querySelector('svg')
				if (!svg) return null
				const shape = svg.querySelector('rect')
				return {
					style: svg.querySelector('style')?.textContent,
					fill: shape && iframe.contentWindow?.getComputedStyle(shape).fill,
				}
			}),
		)
		.toEqual({
			style: '.publisher { fill: rgb(1, 2, 3); }',
			fill: 'rgb(1, 2, 3)',
		})
	await page.waitForLoadState('networkidle')
	expect(requests).toEqual([])
})
