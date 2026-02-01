const CACHE_NAME = "host-cache-v2"
const ASSETS_TO_CACHE = ["/", "/client/index.html"]

self.addEventListener("install", (event) => {
    console.log("[Host SW] Installing...")
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log("[Host SW] Caching assets")
            return cache.addAll(ASSETS_TO_CACHE)
        }),
    )
    self.skipWaiting()
})

self.addEventListener("activate", (event) => {
    console.log(`[Host SW] Activating ${CACHE_NAME}...`)
    event.waitUntil(
        caches
            .keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            console.log(
                                `[Host SW] Deleting old cache: ${cacheName}`,
                            )
                            return caches.delete(cacheName)
                        }
                    }),
                )
            })
            .then(() => clients.claim()),
    )
})

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url)

    // Only handle requests to our own origin for caching
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse
                }
                return fetch(event.request).then((response) => {
                    // Optional: cache new requests here if desired
                    return response
                })
            }),
        )
    }
})
