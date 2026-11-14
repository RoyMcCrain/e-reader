export const awaitWithAbort = <T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> => {
  if (signal.aborted)
    return Promise.reject(new DOMException('Opening cancelled', 'AbortError'))
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DOMException('Opening cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
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
