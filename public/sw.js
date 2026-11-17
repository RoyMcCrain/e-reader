/// <reference lib="webworker" />

const worker = /** @type {ServiceWorkerGlobalScope & typeof globalThis} */ (
	globalThis
)

worker.addEventListener('activate', (event) => {
	event.waitUntil(worker.clients.claim())
})
