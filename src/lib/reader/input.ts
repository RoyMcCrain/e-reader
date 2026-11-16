import type { FoliateViewElement } from 'foliate-js/view.js'

import { bindEpubSwipe } from '#lib/reader/epub-swipe'

export const READER_ACTIVITY_EVENT = 'reader-activity'
export const READER_TURN_EVENT = 'reader-turn'

type Direction = 'rtl' | 'ltr'
type Turn = (next: boolean, swipeDirection?: 'left' | 'right') => void
type Point = { x: number; y: number }

const notifyTurn =
	(host: HTMLElement, turn: Turn): Turn =>
	(next, swipeDirection) => {
		host.dispatchEvent(new Event(READER_TURN_EVENT, { bubbles: true }))
		turn(next, swipeDirection)
	}

const bindSwipe = (target: EventTarget, direction: Direction, turn: Turn) => {
	let start: Point | null = null
	let last: Point | null = null
	let cancelled = false
	let suppressClick = false
	let suppressionTimer: number | undefined
	const onStart = (event: TouchEvent) => {
		if (suppressionTimer !== undefined) window.clearTimeout(suppressionTimer)
		suppressionTimer = undefined
		suppressClick = false
		if (isIgnoredGestureTarget(event.target)) {
			start = null
			last = null
			cancelled = true
			return
		}
		start =
			event.touches.length === 1
				? { x: event.touches[0].clientX, y: event.touches[0].clientY }
				: null
		last = start
		cancelled = event.touches.length !== 1
		event.stopImmediatePropagation()
	}
	const onMove = (event: TouchEvent) => {
		if (!start) return
		event.stopImmediatePropagation()
		if (event.touches.length > 1) cancelled = true
		else if (event.touches.length === 1) {
			last = { x: event.touches[0].clientX, y: event.touches[0].clientY }
			const dx = last.x - start.x
			const dy = last.y - start.y
			if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.25)
				event.preventDefault()
		}
	}
	const onEnd = (event: TouchEvent) => {
		if (!start) return
		event.stopImmediatePropagation()
		if (cancelled) {
			start = null
			last = null
			cancelled = true
			return
		}
		const touch = event.changedTouches[0]
		const finish = touch
			? { x: touch.clientX, y: touch.clientY }
			: (last ?? start)
		const dx = finish.x - start.x
		const dy = finish.y - start.y
		start = null
		last = null
		if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.25) return
		event.preventDefault()
		suppressClick = true
		suppressionTimer = window.setTimeout(() => {
			suppressClick = false
			suppressionTimer = undefined
		}, 500)
		turn(direction === 'rtl' ? dx > 0 : dx < 0, dx < 0 ? 'left' : 'right')
	}
	const onCancel = (event: Event) => {
		if (!start) return
		event.stopImmediatePropagation()
		start = null
		last = null
		cancelled = true
	}
	const onClick = (event: MouseEvent) => {
		if (!suppressClick) return
		suppressClick = false
		event.preventDefault()
		event.stopImmediatePropagation()
	}
	target.addEventListener('click', onClick as EventListener, true)
	target.addEventListener('touchstart', onStart as EventListener, {
		capture: true,
		passive: true,
	})
	target.addEventListener('touchmove', onMove as EventListener, {
		capture: true,
		passive: false,
	})
	target.addEventListener('touchend', onEnd as EventListener, {
		capture: true,
		passive: false,
	})
	target.addEventListener('touchcancel', onCancel, true)
	return () => {
		target.removeEventListener('click', onClick as EventListener, true)
		target.removeEventListener('touchstart', onStart as EventListener, true)
		target.removeEventListener('touchmove', onMove as EventListener, true)
		target.removeEventListener('touchend', onEnd as EventListener, true)
		target.removeEventListener('touchcancel', onCancel, true)
		if (suppressionTimer !== undefined) window.clearTimeout(suppressionTimer)
		suppressionTimer = undefined
	}
}

const elementTarget = (target: EventTarget | null) => {
	const node = target as Node | null
	return node?.nodeType === 1 ? (node as Element) : null
}

const isEditableTarget = (target: EventTarget | null) =>
	Boolean(
		elementTarget(target)?.closest(
			'input, textarea, select, button, [contenteditable]:not([contenteditable="false"])',
		),
	)

const isIgnoredGestureTarget = (target: EventTarget | null) =>
	Boolean(
		elementTarget(target)?.closest(
			'a, button, input, select, textarea, label, form, [role="button"], [role="link"], [contenteditable]:not([contenteditable="false"])',
		),
	)

const hasKeyModifier = (event: KeyboardEvent) =>
	event.altKey ||
	event.ctrlKey ||
	event.metaKey ||
	(event.shiftKey && event.key !== ' ')

const isIgnoredKey = (event: KeyboardEvent, doc: Document) =>
	Boolean(
		event.defaultPrevented ||
		hasKeyModifier(event) ||
		isEditableTarget(event.target) ||
		doc.getSelection()?.toString(),
	)

const bindKeys = (doc: Document, direction: Direction, turn: Turn) => {
	const key = (event: KeyboardEvent) => {
		if (isIgnoredKey(event, doc)) return
		const next =
			event.key === 'PageDown' ||
			(event.key === ' ' && !event.shiftKey) ||
			event.key === (direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight')
		const prev =
			event.key === 'PageUp' ||
			(event.key === ' ' && event.shiftKey) ||
			event.key === (direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft')
		if (!next && !prev) return
		event.preventDefault()
		turn(next)
	}
	doc.addEventListener('keydown', key)
	return () => doc.removeEventListener('keydown', key)
}

const ignoredClick = (event: MouseEvent) =>
	Boolean(
		elementTarget(event.target)?.closest(
			'a, button, input, select, textarea, form',
		),
	)

const hasSelection = (doc: Document) => {
	const selection = doc.getSelection()
	return Boolean(selection && !selection.isCollapsed)
}

const bindEpubClick = (
	doc: Document,
	host: HTMLElement,
	direction: Direction,
	turn: Turn,
) => {
	const click = (event: MouseEvent) => {
		if (ignoredClick(event) || hasSelection(doc)) return
		const frame = doc.defaultView?.frameElement
		const FrameElement = host.ownerDocument.defaultView?.HTMLElement
		if (!frame || !FrameElement || !(frame instanceof FrameElement)) return
		const x = event.clientX + frame.getBoundingClientRect().left
		const rect = host.getBoundingClientRect()
		if (x < rect.left + rect.width * 0.22) {
			event.preventDefault()
			turn(direction === 'rtl')
		} else if (x > rect.right - rect.width * 0.22) {
			event.preventDefault()
			turn(direction !== 'rtl')
		}
	}
	doc.addEventListener('click', click)
	return () => doc.removeEventListener('click', click)
}

export const bindHostInput = (
	host: HTMLElement,
	direction: Direction,
	turn: Turn,
) => {
	const notify = notifyTurn(host, turn)
	const removeSwipe = host.querySelector('foliate-view')
		? () => undefined
		: bindSwipe(host, direction, notify)
	const removeKeys = bindKeys(host.ownerDocument, direction, notify)
	const click = (event: MouseEvent) => {
		if (ignoredClick(event) || hasSelection(host.ownerDocument)) return
		const rect = host.getBoundingClientRect()
		if (event.clientX < rect.left + rect.width * 0.22) {
			event.preventDefault()
			notify(direction === 'rtl')
		} else if (event.clientX > rect.right - rect.width * 0.22) {
			event.preventDefault()
			notify(direction !== 'rtl')
		}
	}
	host.addEventListener('click', click)
	return () => {
		removeSwipe()
		removeKeys()
		host.removeEventListener('click', click)
	}
}

export const bindEpubInput = (
	view: FoliateViewElement,
	host: HTMLElement,
	direction: Direction,
	turn: Turn,
) => {
	const docs = new Map<Document, () => void>()
	const notify = notifyTurn(host, turn)
	const swipe = bindEpubSwipe(view, host, direction, notify)
	const bind = (doc: Document) => {
		if (docs.has(doc)) return
		// The parent touch-action does not apply inside the EPUB iframe.
		doc.documentElement.style.touchAction = 'pinch-zoom'
		doc.body.style.touchAction = 'pinch-zoom'
		const activity = () =>
			host.dispatchEvent(new Event(READER_ACTIVITY_EVENT, { bubbles: true }))
		const pointerMove = (event: PointerEvent) => {
			if (event.pointerType !== 'touch') activity()
		}
		doc.addEventListener('pointermove', pointerMove, {
			capture: true,
			passive: true,
		})
		doc.addEventListener('keydown', activity, true)
		const removeKeys = bindKeys(doc, direction, notify)
		const removeClick = bindEpubClick(doc, host, direction, notify)
		const clickActivity = (event: MouseEvent) => {
			if (!event.defaultPrevented) activity()
		}
		doc.addEventListener('click', clickActivity)
		const removeSwipe = swipe.attach(doc)
		docs.set(doc, () => {
			doc.removeEventListener('pointermove', pointerMove, true)
			doc.removeEventListener('keydown', activity, true)
			doc.removeEventListener('click', clickActivity)
			removeKeys()
			removeClick()
			removeSwipe()
		})
	}
	const refresh = (loaded?: Document) => {
		const contents = view.renderer?.getContents() ?? []
		if (loaded) bind(loaded)
		contents.forEach(({ doc }) => bind(doc))
		const current = new Set(contents.map(({ doc }) => doc))
		if (loaded) current.add(loaded)
		docs.forEach((unbind, doc) => {
			if (current.has(doc)) return
			unbind()
			docs.delete(doc)
		})
	}
	const load = (event: Event) =>
		refresh((event as CustomEvent<{ doc: Document }>).detail.doc)
	view.addEventListener('load', load)
	refresh()
	return () => {
		view.removeEventListener('load', load)
		docs.forEach((unbind) => unbind())
		docs.clear()
		swipe.close()
	}
}
