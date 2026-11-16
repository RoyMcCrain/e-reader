export const awaitWithAbort = <T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> => {
  if (signal.aborted) {
    void promise.catch(() => undefined)
    return Promise.reject(new DOMException('Opening cancelled', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DOMException('Opening cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}

export const awaitContentLayout = async (
  doc: Document,
  signal: AbortSignal,
) => {
  // The iframe load event already waits for eager images; decoding every image
  // here would also wait for offscreen lazy images that cannot load yet.
  await awaitWithAbort(doc.fonts?.ready ?? Promise.resolve(), signal)
  const body = doc.body
  if (!body || typeof ResizeObserver === 'undefined') return
  // goTo resolves before Foliate's body observer updates the page count.
  await new Promise<void>((resolve, reject) => {
    const observer = new ResizeObserver(() => {
      observer.disconnect()
      signal.removeEventListener('abort', abort)
      resolve()
    })
    const abort = () => {
      observer.disconnect()
      reject(new DOMException('Opening cancelled', 'AbortError'))
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    observer.observe(body)
  })
}

export const awaitOwned = async <T>(
  promise: Promise<T>,
  signal: AbortSignal,
  cleanup: (value: T) => void,
): Promise<T> => {
  try {
    return await awaitWithAbort(promise, signal)
  } catch (error) {
    void promise.then(
      (value) => {
        if (signal.aborted) cleanup(value)
      },
      () => undefined,
    )
    throw error
  }
}
