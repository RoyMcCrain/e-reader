import { expect, test } from '@playwright/test'

const installInput = async (page: import('@playwright/test').Page) => {
  await page.goto('/')
  return page.evaluate(async () => {
    const { bindHostInput }: typeof import('#lib/reader/input') =
      await new Function('return import("/src/lib/reader/input.ts")')()
    const host = document.createElement('main')
    const content = document.createElement('div')
    content.textContent = 'Selectable reader content'
    const control = document.createElement('button')
    control.textContent = 'Control'
    host.append(content, control)
    document.body.append(host)
    host.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 400,
        top: 0,
        bottom: 400,
        width: 400,
        height: 400,
      }) as DOMRect

    const turns: boolean[] = []
    const propagated: string[] = []
    const remove = bindHostInput(host, 'ltr', (next) => turns.push(next))
    for (const type of ['touchstart', 'touchmove', 'touchend'])
      host.addEventListener(type, () => propagated.push(type))

    const touch = (
      target: Element,
      type: string,
      x: number,
      emptyEnd = false,
    ) => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true,
      }) as TouchEvent
      Object.defineProperties(event, {
        touches: {
          value: type === 'touchend' ? [] : [{ clientX: x, clientY: 200 }],
        },
        changedTouches: {
          value: emptyEnd ? [] : [{ clientX: x, clientY: 200 }],
        },
      })
      target.dispatchEvent(event)
    }
    const clickAt = (x: number) =>
      host.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: x,
        }),
      )
    const clearTurns = () => turns.splice(0)

    touch(content, 'touchstart', 200)
    touch(content, 'touchmove', 220)
    touch(content, 'touchend', 220, true)
    const shortEmptyEndTurns = [...clearTurns()]

    touch(content, 'touchstart', 200)
    touch(content, 'touchmove', 120)
    touch(content, 'touchend', 120, true)
    const longEmptyEndTurns = [...clearTurns()]
    clickAt(398)
    const swipeClickSuppressionTurns = [...clearTurns()]
    touch(content, 'touchstart', 200)
    clickAt(398)
    const freshTouchClickTurns = [...clearTurns()]

    const text = content.firstChild
    if (!text) throw new Error('Reader content text missing')
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    clickAt(398)
    const selectedClickTurns = [...clearTurns()]
    selection?.removeAllRanges()

    touch(control, 'touchstart', 200)
    touch(control, 'touchmove', 100)
    touch(control, 'touchend', 100)
    const controlPropagated = [...propagated]
    const controlTurns = [...clearTurns()]

    const outside = document.createElement('div')
    document.body.append(outside)
    touch(outside, 'touchstart', 200)
    touch(outside, 'touchmove', 100)
    touch(outside, 'touchend', 100)
    const outsideTurns = [...clearTurns()]
    remove()
    host.remove()
    outside.remove()
    return {
      shortEmptyEndTurns,
      longEmptyEndTurns,
      swipeClickSuppressionTurns,
      freshTouchClickTurns,
      selectedClickTurns,
      controlPropagated,
      controlTurns,
      outsideTurns,
    }
  })
}

test('public host input owns gestures and respects controls and selection', async ({
  page,
}) => {
  const result = await installInput(page)
  expect(result.controlPropagated).toEqual([
    'touchstart',
    'touchmove',
    'touchend',
  ])
  expect(result.controlTurns).toEqual([])
  expect(result.selectedClickTurns).toEqual([])
  expect(result.outsideTurns).toEqual([])
})

test('public host input falls back to the last point and resets click suppression on a fresh gesture', async ({
  page,
}) => {
  const result = await installInput(page)
  expect(result.shortEmptyEndTurns).toEqual([])
  expect(result.longEmptyEndTurns).toEqual([true])
  expect(result.swipeClickSuppressionTurns).toEqual([])
  expect(result.freshTouchClickTurns).toEqual([true])
})
