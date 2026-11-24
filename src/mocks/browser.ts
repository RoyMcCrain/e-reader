import { setupWorker } from 'msw/browser'

import { handlers } from '#mocks/handlers'

const worker = setupWorker(...handlers)

// Memoized: React dev double-effects call start twice, and MSW throws on
// a redundant start while the first is still enabling interception.
let starting: Promise<unknown>

export const startMockWorker = () =>
	(starting ??= worker.start({ onUnhandledFrame: 'bypass' }))
