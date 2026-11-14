import type { FoliateViewElement } from 'foliate-js/view.js'
import { bindEpubSwipe } from './epub-swipe'

type Direction = 'rtl' | 'ltr'
type Turn = (next: boolean, swipeDirection?: 'left' | 'right') => void
type Point = { x: number; y: number }

const bindSwipe = (target: EventTarget, direction: Direction, turn: Turn) => {
  let start: Point | null = null
  let last: Point | null = null
  let cancelled = false
  let suppressClick = false
  const onStart = (event: TouchEvent) => {
    start =
      event.touches.length === 1
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
        : null
    last = start
    cancelled = event.touches.length !== 1
    event.stopImmediatePropagation()
  }
  const onMove = (event: TouchEvent) => {
    event.stopImmediatePropagation()
    if (event.touches.length > 1) cancelled = true
    else if (start && event.touches.length === 1) {
      last = { x: event.touches[0].clientX, y: event.touches[0].clientY }
      const dx = last.x - start.x
      const dy = last.y - start.y
      if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.25)
        event.preventDefault()
    }
  }
  const onEnd = (event: TouchEvent) => {
    event.stopImmediatePropagation()
    if (cancelled || !start) {
      start = null
      last = null
      cancelled = true
      return
    }
    const finish = event.changedTouches[0] ?? last ?? start
    const dx = finish.clientX - start.x
    const dy = finish.clientY - start.y
    start = null
    last = null
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.25) return
    event.preventDefault()
    suppressClick = true
    window.setTimeout(() => {
      suppressClick = false
    }, 500)
    turn(direction === 'rtl' ? dx > 0 : dx < 0, dx < 0 ? 'left' : 'right')
  }
  const onCancel = (event: Event) => {
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
  }
}

const isEditableTarget = (target: EventTarget | null) =>
  Boolean(
    target &&
    'nodeType' in target &&
    (target as Node).nodeType === 1 &&
    (target as Element).closest(
      'input, textarea, select, button, [contenteditable]:not([contenteditable="false"])',
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

const ignoredClick = (event: MouseEvent) => {
  const target = event.target
  return Boolean(
    target &&
    'nodeType' in target &&
    (target as Element).closest('a, button, input, select, textarea'),
  )
}

const bindEpubClick = (
  doc: Document,
  host: HTMLElement,
  direction: Direction,
  turn: Turn,
) => {
  const click = (event: MouseEvent) => {
    if (ignoredClick(event)) return
    const frame = doc.defaultView?.frameElement
    const FrameElement = host.ownerDocument.defaultView?.HTMLElement
    if (!frame || !FrameElement || !(frame instanceof FrameElement)) return
    const x = event.clientX + frame.getBoundingClientRect().left
    const rect = host.getBoundingClientRect()
    if (x < rect.left + rect.width * 0.22) turn(direction === 'rtl')
    else if (x > rect.right - rect.width * 0.22) turn(direction !== 'rtl')
  }
  doc.addEventListener('click', click)
  return () => doc.removeEventListener('click', click)
}

export const bindHostInput = (
  host: HTMLElement,
  direction: Direction,
  turn: Turn,
) => {
  const removeSwipe = host.querySelector('foliate-view')
    ? () => undefined
    : bindSwipe(host.ownerDocument, direction, turn)
  const removeKeys = bindKeys(host.ownerDocument, direction, turn)
  const click = (event: MouseEvent) => {
    if (ignoredClick(event)) return
    const rect = host.getBoundingClientRect()
    if (event.clientX < rect.left + rect.width * 0.22) turn(direction === 'rtl')
    else if (event.clientX > rect.right - rect.width * 0.22)
      turn(direction !== 'rtl')
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
  const swipe = bindEpubSwipe(view, host, direction, turn)
  const bind = (doc: Document) => {
    if (docs.has(doc)) return
    // The parent touch-action does not apply inside the EPUB iframe.
    doc.documentElement.style.touchAction = 'pinch-zoom'
    doc.body.style.touchAction = 'pinch-zoom'
    const removeKeys = bindKeys(doc, direction, turn)
    const removeClick = bindEpubClick(doc, host, direction, turn)
    const removeSwipe = swipe.attach(doc)
    docs.set(doc, () => {
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
