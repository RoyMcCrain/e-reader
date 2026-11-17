import { expect, test } from '@playwright/test'

test('production PWA metadata and service worker work without caching or reloading', async ({
	page,
}) => {
	const navigations: string[] = []
	page.on('request', (request) => {
		if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
			navigations.push(request.url())
		}
	})
	await page.goto('/')

	const manifestLink = page.locator('link[rel="manifest"]')
	await expect(manifestLink).toHaveAttribute('crossorigin', 'use-credentials')
	const manifestUrl = await manifestLink.getAttribute('href')
	expect(manifestUrl).toBe('/manifest.webmanifest')
	const manifestResponse = await page.request.get('/manifest.webmanifest')
	expect(manifestResponse.status()).toBe(200)
	expect(manifestResponse.headers()['content-type']).toContain(
		'application/manifest+json',
	)
	const manifest: unknown = await manifestResponse.json()
	expect(manifest).toMatchObject({
		id: '/',
		start_url: '/',
		scope: '/',
		name: '栞 — ブラウザー読書室',
		short_name: '栞',
		lang: 'ja',
		display: 'standalone',
		theme_color: '#586d57',
		background_color: '#f4f0e7',
		icons: [
			{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
			{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
		],
	})
	const devtools = await page.context().newCDPSession(page)
	const appManifest: unknown = await devtools.send('Page.getAppManifest')
	expect(appManifest).toMatchObject({
		url: `${new URL('/', page.url()).origin}/manifest.webmanifest`,
		errors: [],
	})

	for (const [path, dimension] of [
		['/icons/icon-192.png', 192],
		['/icons/icon-512.png', 512],
		['/icons/apple-touch-icon.png', 180],
	] as const) {
		const image = await page.evaluate(async (url) => {
			const image = new Image()
			image.src = url
			await image.decode()
			return [image.naturalWidth, image.naturalHeight]
		}, path)
		expect(image).toEqual([dimension, dimension])
	}

	await expect
		.poll(() =>
			page.evaluate(async () => {
				const registration = await navigator.serviceWorker.getRegistration('/')
				return Boolean(
					registration?.active &&
					navigator.serviceWorker.controller &&
					registration.scope === `${location.origin}/`,
				)
			}),
		)
		.toBe(true)
	const workerState = await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.getRegistration('/')
		return {
			scriptURL: registration?.active?.scriptURL,
			controllerURL: navigator.serviceWorker.controller?.scriptURL,
			updateViaCache: registration?.updateViaCache,
		}
	})
	expect(workerState).toEqual({
		scriptURL: `${new URL('/', page.url()).origin}/sw.js`,
		controllerURL: `${new URL('/', page.url()).origin}/sw.js`,
		updateViaCache: 'none',
	})

	await page.context().route('**/api/books**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books: [] }),
		}),
	)
	const positionUrl = `/api/reading-positions/${'a'.repeat(64)}`
	await page.context().route('**/api/reading-positions/**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ position: null }),
		}),
	)
	const apiResponses = await page.evaluate(async (positionPath) => {
		const booksResponse = await fetch('/api/books')
		const books: unknown = await booksResponse.json()
		const positionResponse = await fetch(positionPath)
		const position: unknown = await positionResponse.json()
		return {
			booksStatus: booksResponse.status,
			books,
			positionStatus: positionResponse.status,
			position,
		}
	}, positionUrl)
	expect(apiResponses).toEqual({
		booksStatus: 200,
		books: { books: [] },
		positionStatus: 200,
		position: { position: null },
	})
	const cachedRequests = await page.evaluate(async () => {
		const keys = await caches.keys()
		const entries = await Promise.all(keys.map((key) => caches.open(key)))
		return (await Promise.all(entries.map((cache) => cache.keys()))).flat()
	})
	expect(cachedRequests).toEqual([])

	await page.evaluate(async () => {
		document.documentElement.dataset.pwaSentinel = 'preserved'
		await navigator.serviceWorker.register('/sw.js?update=probe', {
			scope: '/',
			updateViaCache: 'none',
		})
	})
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const registration = await navigator.serviceWorker.getRegistration('/')
				return registration?.waiting?.scriptURL
			}),
		)
		.toBe(`${new URL('/', page.url()).origin}/sw.js?update=probe`)
	const updateState = await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.getRegistration('/')
		return {
			activeURL: registration?.active?.scriptURL,
			controllerURL: navigator.serviceWorker.controller?.scriptURL,
			sentinel: document.documentElement.dataset.pwaSentinel,
		}
	})
	expect(updateState).toEqual({
		activeURL: `${new URL('/', page.url()).origin}/sw.js`,
		controllerURL: `${new URL('/', page.url()).origin}/sw.js`,
		sentinel: 'preserved',
	})
	expect(navigations).toHaveLength(1)
})
