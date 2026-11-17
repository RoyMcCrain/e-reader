type Renderer = { getContents?: () => { doc: Document }[] }
type Bounds = {
	left: number
	top: number
	right: number
	bottom: number
	width: number
	height: number
}

const supportedEffects = (style: CSSStyleDeclaration) =>
	style.filter === 'none' &&
	style.opacity === '1' &&
	style.transform === 'none' &&
	style.visibility === 'visible'

const transparentPageBackground = (doc: Document) => {
	const view = doc.defaultView
	if (!view) return false
	const body = view.getComputedStyle(doc.body!)
	const root = view.getComputedStyle(doc.documentElement)
	return (
		body.backgroundColor === 'rgba(0, 0, 0, 0)' &&
		root.backgroundColor === 'rgba(0, 0, 0, 0)' &&
		body.backgroundImage === 'none' &&
		root.backgroundImage === 'none' &&
		supportedEffects(body) &&
		supportedEffects(root)
	)
}

const imageOnlyDocument = (doc: Document) => {
	if (!doc.body || doc.body.textContent?.trim()) return false
	const children = [...doc.body.children]
	return Boolean(
		children.length &&
		children.every((child) => child.localName === 'img') &&
		transparentPageBackground(doc),
	)
}

const unsupportedImageBox = (style: CSSStyleDeclaration) =>
	[
		style.paddingTop,
		style.paddingRight,
		style.paddingBottom,
		style.paddingLeft,
		style.borderTopWidth,
		style.borderRightWidth,
		style.borderBottomWidth,
		style.borderLeftWidth,
	].some((value) => value !== '0px')

const supportedImageStyle = (style: CSSStyleDeclaration) =>
	style.objectPosition === '50% 50%' &&
	['fill', 'contain'].includes(style.objectFit) &&
	style.backgroundImage === 'none' &&
	style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
	!unsupportedImageBox(style) &&
	supportedEffects(style)

const drawImage = (
	context: CanvasRenderingContext2D,
	image: HTMLImageElement,
	frame: HTMLElement,
	bounds: Bounds,
) => {
	if (!image.complete || !image.naturalWidth) return false
	const frameRect = frame.getBoundingClientRect()
	if (!frame.clientWidth || !frame.clientHeight) return false
	const scaleX = frameRect.width / frame.clientWidth
	const scaleY = frameRect.height / frame.clientHeight
	const rect = image.getBoundingClientRect()
	const style = image.ownerDocument.defaultView!.getComputedStyle(image)
	if (!supportedImageStyle(style)) return false
	let width = rect.width
	let height = rect.height
	let x = rect.left
	let y = rect.top
	if (style.objectFit === 'contain') {
		const fit = Math.min(
			width / image.naturalWidth,
			height / image.naturalHeight,
		)
		width = image.naturalWidth * fit
		height = image.naturalHeight * fit
		x += (rect.width - width) / 2
		y += (rect.height - height) / 2
	}
	try {
		context.drawImage(
			image,
			frameRect.left + x * scaleX - bounds.left,
			frameRect.top + y * scaleY - bounds.top,
			width * scaleX,
			height * scaleY,
		)
	} catch {
		return false
	}
	return true
}

const drawDocument = (
	context: CanvasRenderingContext2D,
	doc: Document,
	pane: HTMLElement,
	bounds: Bounds,
) => {
	if (!imageOnlyDocument(doc)) return -1
	const frame = doc.defaultView?.frameElement as HTMLElement | null
	if (!frame) return -1
	const frameRect = frame.getBoundingClientRect()
	const paneRect = pane.getBoundingClientRect()
	const clip = {
		left: Math.max(bounds.left, paneRect.left, frameRect.left),
		top: Math.max(bounds.top, paneRect.top, frameRect.top),
		right: Math.min(bounds.right, paneRect.right, frameRect.right),
		bottom: Math.min(bounds.bottom, paneRect.bottom, frameRect.bottom),
	}
	if (clip.right <= clip.left || clip.bottom <= clip.top) return 0
	context.save()
	context.beginPath()
	context.rect(
		clip.left - bounds.left,
		clip.top - bounds.top,
		clip.right - clip.left,
		clip.bottom - clip.top,
	)
	context.clip()
	let count = 0
	for (const image of doc.querySelectorAll('img')) {
		if (!drawImage(context, image, frame, bounds)) {
			context.restore()
			return -1
		}
		count += 1
	}
	context.restore()
	return count
}

const visiblePanes = (surface: HTMLElement) =>
	[...surface.querySelectorAll<HTMLElement>('[data-reader-page]')].filter(
		(pane) => getComputedStyle(pane).visibility !== 'hidden',
	)

const createCanvas = (surface: HTMLElement, bounds: Bounds) => {
	const canvas = surface.ownerDocument.createElement('canvas')
	const ratio = Math.min(
		window.devicePixelRatio || 1,
		2,
		Math.sqrt(16_000_000 / (bounds.width * bounds.height)),
	)
	canvas.width = Math.ceil(bounds.width * ratio)
	canvas.height = Math.ceil(bounds.height * ratio)
	const context = canvas.getContext('2d')
	if (!context) return undefined
	context.scale(ratio, ratio)
	return { canvas, context }
}

const renderPane = (
	pane: HTMLElement,
	context: CanvasRenderingContext2D,
	bounds: Bounds,
) => {
	const renderer = (
		pane.querySelector('foliate-view') as
			| (HTMLElement & {
					renderer?: Renderer
			  })
			| null
	)?.renderer
	const contents = renderer?.getContents?.() ?? []
	if (!contents.length) return -1
	let count = 0
	for (const { doc } of contents) {
		const drawn = drawDocument(context, doc, pane, bounds)
		if (drawn < 0) return -1
		count += drawn
	}
	return count
}

const renderPanes = (
	panes: HTMLElement[],
	context: CanvasRenderingContext2D,
	bounds: Bounds,
) => {
	let count = 0
	for (const pane of panes) {
		const drawn = renderPane(pane, context, bounds)
		if (drawn < 0) return -1
		count += drawn
	}
	return count
}

const holdSnapshot = (
	surface: HTMLElement,
	canvas: HTMLCanvasElement,
	panes: HTMLElement[],
) => {
	const originalOpacity = panes.map(
		(pane) => [pane, pane.style.opacity] as const,
	)
	const originalPosition = surface.style.position
	if (getComputedStyle(surface).position === 'static')
		surface.style.position = 'relative'
	Object.assign(canvas.style, {
		position: 'absolute',
		inset: '0',
		width: '100%',
		height: '100%',
		pointerEvents: 'none',
		zIndex: '1',
	})
	canvas.setAttribute('aria-hidden', 'true')
	surface.append(canvas)
	panes.forEach((pane) => (pane.style.opacity = '0'))
	return () => {
		canvas.remove()
		originalOpacity.forEach(([pane, opacity]) => (pane.style.opacity = opacity))
		surface.style.position = originalPosition
	}
}

export const captureEpubImages = (surface: HTMLElement) => {
	const bounds = surface.getBoundingClientRect()
	if (!bounds.width || !bounds.height) return undefined
	const panes = visiblePanes(surface)
	if (!panes.length) return undefined
	const created = createCanvas(surface, bounds)
	if (!created) return undefined
	const count = renderPanes(panes, created.context, bounds)
	if (count <= 0) return undefined
	return holdSnapshot(surface, created.canvas, panes)
}
