import { describe, expect, test } from 'bun:test'
import { awaitWithAbort } from '#lib/reader/epub-layout'

describe('awaitWithAbort', () => {
  test('abort前に拒否されたpromiseを観測しAbortErrorを返す', async () => {
    const controller = new AbortController()
    controller.abort()
    const rejection = Promise.reject(new Error('late rejection'))

    expect(awaitWithAbort(rejection, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
