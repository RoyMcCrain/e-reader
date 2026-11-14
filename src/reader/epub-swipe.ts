import type { FoliateViewElement } from 'foliate-js/view.js'

type Direction = 'rtl' | 'ltr'
type Turn = (next: boolean) => void | Promise<void>
type Point = { x: number; y: number }
type Renderer = HTMLElement & { atStart?: boolean; atEnd?: boolean }

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const bindEpubSwipe = (
  view: FoliateViewElement,
  host: HTMLElement,
  direction: Direction,
  turn: Turn,
) => {
  let start: Point | null = null
  let renderer: HTMLElement | null = null
  let animation: Animation | null = null
  let clickTimer = 0
  let suppressClick = false
  let gesture = 0
  const reset = () => {
    animation?.cancel()
    animation = null
    if (renderer) {
      renderer.style.transform = ''
      renderer.style.transition = ''
    }
    renderer = null
  }
  const point = (touch: Touch): Point => ({
    x: touch.screenX,
    y: touch.screenY,
  })
  const onStart = (event: TouchEvent) => {
    event.stopImmediatePropagation()
    if (event.touches.length !== 1) {
      start = null
      reset()
      return
    }
    reset()
    gesture += 1
    start = point(event.touches[0])
    renderer = view as HTMLElement
  }
  const onMove = (event: TouchEvent) => {
    event.stopImmediatePropagation()
    if (event.touches.length !== 1) {
      start = null
      reset()
      return
    }
    if (!start || !renderer) return
    const current = point(event.touches[0])
    const dx = current.x - start.x
    const dy = current.y - start.y
    if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy) * 1.25) return
    if (!reducedMotion()) renderer.style.transform = `translateX(${dx}px)`
    if (Math.abs(dx) >= 45) event.preventDefault()
  }
  const settle = (element: Renderer, from: number) => {
    const ownGesture = gesture
    if (reducedMotion()) {
      element.style.transform = ''
      return
    }
    animation = element.animate(
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
        element.style.transform = ''
        animation = null
        if (renderer === element) renderer = null
      })
      .catch(() => undefined)
  }
  const onEnd = (event: TouchEvent) => {
    event.stopImmediatePropagation()
    if (!start) return
    const end = event.changedTouches[0]
    const dx = end ? point(end).x - start.x : 0
    const dy = end ? point(end).y - start.y : 0
    start = null
    if (!renderer) return
    const element = renderer
    const moved = Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.25
    const next = direction === 'rtl' ? dx > 0 : dx < 0
    const paginator = view.renderer as Renderer | null
    const available = next ? !paginator?.atEnd : !paginator?.atStart
    if (!moved || !available) {
      settle(element, dx)
      return
    }
    event.preventDefault()
    suppressClick = true
    window.clearTimeout(clickTimer)
    clickTimer = window.setTimeout(() => {
      suppressClick = false
    }, 500)
    if (!reducedMotion()) {
      animation?.cancel()
      element.style.transform = ''
      animation = element.animate(
        [
          { transform: `translateX(${dx}px)` },
          { transform: `translateX(${Math.sign(dx) * view.clientWidth}px)` },
        ],
        { duration: 110, easing: 'ease-out' },
      )
    } else element.style.transform = ''
    void Promise.resolve(turn(next)).catch(() => undefined)
  }
  const onCancel = (event: Event) => {
    event.stopImmediatePropagation()
    if (!start) return
    const element = renderer
    const from = element
      ? new DOMMatrixReadOnly(getComputedStyle(element).transform).m41
      : 0
    start = null
    if (element) settle(element, from)
  }
  const onRelocate = () => reset()
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
      start = null
      reset()
    }
  }
  const onHostStart = (event: TouchEvent) => {
    if (event.target !== host && event.target !== view) return
    onStart(event)
  }
  const onHostMove = (event: TouchEvent) => {
    if (event.target === host || event.target === view) onMove(event)
  }
  const onHostEnd = (event: TouchEvent) => {
    if (event.target === host || event.target === view) onEnd(event)
  }
  host.addEventListener('touchstart', onHostStart, { passive: true })
  host.addEventListener('touchmove', onHostMove, { passive: false })
  host.addEventListener('touchend', onHostEnd, { passive: false })
  view.addEventListener('relocate', onRelocate)
  return {
    attach,
    close: () => {
      gesture += 1
      reset()
      window.clearTimeout(clickTimer)
      host.removeEventListener('touchstart', onHostStart)
      host.removeEventListener('touchmove', onHostMove)
      host.removeEventListener('touchend', onHostEnd)
      view.removeEventListener('relocate', onRelocate)
    },
  }
}
