import type { FoliateViewElement } from 'foliate-js/view.js'

import { captureEpubImages } from '#lib/reader/epub-snapshot'

type Direction = 'rtl' | 'ltr'
type Turn = (next: boolean) => void | Promise<void>
type Point = { x: number; y: number }
type Renderer = HTMLElement & { atStart?: boolean; atEnd?: boolean }
type Controller = ReturnType<typeof createSwipe>

const reducedMotion = () =>
	window.matchMedia('(prefers-reduced-motion: reduce)').matches

const controllers = new WeakMap<
	HTMLElement,
	{ controller: Controller; refs: number }
>()

const interactiveTarget = (target: EventTarget | null) =>
	Boolean(
		target &&
		'nodeType' in target &&
		(target as Node).nodeType === 1 &&
		(target as Element).closest(
			'a, button, input, select, textarea, [contenteditable]:not([contenteditable="false"])',
		),
	)

const createSwipe = (
	view: FoliateViewElement,
	host: HTMLElement,
	surface: HTMLElement,
	direction: Direction,
	turn: Turn,
) => {
	let start: Point | null = null
	let startDocument: Document | null = null
	let animation: Animation | null = null
	let clickTimer = 0
	let suppressClick = false
	let gesture = 0
	let turning = false
	let releasePresentation: (() => void) | undefined

	const clearPresentation = () => {
		releasePresentation?.()
		releasePresentation = undefined
	}

	const reset = () => {
		animation?.cancel()
		animation = null
		surface.style.transform = ''
		surface.style.transition = ''
	}
	const point = (touch: Touch): Point => ({
		x: touch.screenX,
		y: touch.screenY,
	})
	const available = (next: boolean) => {
		const boundary = next ? surface.dataset.atEnd : surface.dataset.atStart
		if (boundary !== undefined) return boundary !== 'true'
		const renderer = view.renderer as Renderer | null
		return next ? !renderer?.atEnd : !renderer?.atStart
	}
	const onStart = (event: TouchEvent) => {
		const target = event.target
		const current = event.currentTarget as Node
		const doc =
			current.nodeType === 9
				? (current as Document)
				: (current.ownerDocument ?? host.ownerDocument)
		if (interactiveTarget(target) || Boolean(doc.getSelection()?.toString())) {
			if (!turning) {
				start = null
				startDocument = null
				gesture += 1
				reset()
				suppressClick = false
				window.clearTimeout(clickTimer)
			}
			return
		}
		if (turning) {
			event.stopImmediatePropagation()
			return
		}
		suppressClick = false
		window.clearTimeout(clickTimer)
		if (event.touches.length !== 1) {
			start = null
			startDocument = null
			reset()
			return
		}
		event.stopImmediatePropagation()
		reset()
		gesture += 1
		start = point(event.touches[0])
		startDocument = doc === host.ownerDocument ? null : doc
	}
	const onMove = (event: TouchEvent) => {
		if (!start) return
		event.stopImmediatePropagation()
		if (event.touches.length !== 1) {
			start = null
			startDocument = null
			reset()
			return
		}
		const current = point(event.touches[0])
		const dx = current.x - start.x
		const dy = current.y - start.y
		if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy) * 1.25) return
		if (!reducedMotion()) surface.style.transform = `translateX(${dx}px)`
		if (Math.abs(dx) >= 45) event.preventDefault()
	}
	const finishAnimation = (token: number) => {
		if (gesture !== token) return
		reset()
	}
	const settle = (from: number) => {
		const ownGesture = gesture
		if (reducedMotion()) {
			reset()
			return
		}
		animation = surface.animate(
			[
				{ transform: `translateX(${from}px)` },
				{ transform: 'translateX(0px)' },
			],
			{ duration: 110, easing: 'ease-out' },
		)
		const active = animation
		void active.finished
			.then(() => {
				if (animation !== active || gesture !== ownGesture) return
				finishAnimation(ownGesture)
			})
			.catch(() => undefined)
	}
	const onEnd = (event: TouchEvent) => {
		if (!start) return
		event.stopImmediatePropagation()
		const end = event.changedTouches[0]
		const dx = end ? point(end).x - start.x : 0
		const dy = end ? point(end).y - start.y : 0
		start = null
		startDocument = null
		const moved = Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.25
		const next = direction === 'rtl' ? dx > 0 : dx < 0
		if (!moved || !available(next)) {
			settle(dx)
			return
		}
		event.preventDefault()
		suppressClick = true
		window.clearTimeout(clickTimer)
		clickTimer = window.setTimeout(() => {
			suppressClick = false
		}, 500)
		const ownGesture = gesture
		turning = true
		releasePresentation = captureEpubImages(surface)
		animation?.cancel()
		animation = null
		surface.style.transform = reducedMotion() ? '' : `translateX(${dx}px)`
		void Promise.resolve()
			.then(() => turn(next))
			.catch(() => undefined)
			.finally(() => {
				clearPresentation()
				if (gesture !== ownGesture) return
				turning = false
				finishAnimation(ownGesture)
			})
	}
	const onCancel = (event: Event) => {
		if (!start) return
		event.stopImmediatePropagation()
		const matrix = new DOMMatrixReadOnly(getComputedStyle(surface).transform)
		start = null
		startDocument = null
		settle(matrix.m41)
	}
	const onRelocate = () => {
		if (turning) return
		gesture += 1
		start = null
		startDocument = null
		reset()
	}
	const onClick = (event: MouseEvent) => {
		if (!suppressClick) return
		suppressClick = false
		window.clearTimeout(clickTimer)
		event.preventDefault()
		event.stopImmediatePropagation()
	}
	const attach = (doc: Document) => {
		doc.addEventListener('click', onClick, true)
		doc.addEventListener('touchstart', onStart, {
			capture: true,
			passive: true,
		})
		doc.addEventListener('touchmove', onMove, { capture: true, passive: false })
		doc.addEventListener('touchend', onEnd, { capture: true, passive: false })
		doc.addEventListener('touchcancel', onCancel, true)
		return () => {
			doc.removeEventListener('click', onClick, true)
			doc.removeEventListener('touchstart', onStart, true)
			doc.removeEventListener('touchmove', onMove, true)
			doc.removeEventListener('touchend', onEnd, true)
			doc.removeEventListener('touchcancel', onCancel, true)
			if (startDocument === doc) {
				start = null
				startDocument = null
				reset()
			}
		}
	}
	const hostTouch = (event: TouchEvent) => {
		if (!host.contains(event.target as Node)) return
		if (event.type === 'touchstart') onStart(event)
		else if (event.type === 'touchmove') onMove(event)
		else if (event.type === 'touchend') onEnd(event)
		else onCancel(event)
	}
	host.addEventListener('click', onClick, true)
	host.addEventListener('touchstart', hostTouch, { passive: true })
	host.addEventListener('touchmove', hostTouch, { passive: false })
	host.addEventListener('touchend', hostTouch, { passive: false })
	host.addEventListener('touchcancel', hostTouch)
	view.addEventListener('relocate', onRelocate)
	return {
		attach,
		close: () => {
			gesture += 1
			turning = false
			clearPresentation()
			start = null
			startDocument = null
			reset()
			window.clearTimeout(clickTimer)
			host.removeEventListener('click', onClick, true)
			host.removeEventListener('touchstart', hostTouch)
			host.removeEventListener('touchmove', hostTouch)
			host.removeEventListener('touchend', hostTouch)
			host.removeEventListener('touchcancel', hostTouch)
			view.removeEventListener('relocate', onRelocate)
		},
	}
}

export const bindEpubSwipe = (
	view: FoliateViewElement,
	host: HTMLElement,
	direction: Direction,
	turn: Turn,
) => {
	const surface =
		(host.querySelector('[data-reader-spread]') as HTMLElement | null) ?? host
	let shared = controllers.get(surface)
	if (!shared) {
		shared = {
			controller: createSwipe(view, host, surface, direction, turn),
			refs: 0,
		}
		controllers.set(surface, shared)
	}
	shared.refs += 1
	const controller = shared.controller
	return {
		attach: controller.attach,
		close: () => {
			shared!.refs -= 1
			if (!shared!.refs) {
				controller.close()
				controllers.delete(surface)
			}
		},
	}
}
