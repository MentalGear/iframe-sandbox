const CACHE_NAME = "sandbox-cache-v3"
const ASSETS_TO_CACHE = [
    "/sandbox/index.html",
    "/sandbox/executor.html",
    "/sandbox/sw.js",
]

self.addEventListener("install", (event) => {
    console.log("[SW] Installing...")
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log("[SW] Caching assets")
            return cache.addAll(ASSETS_TO_CACHE)
        }),
    )
    self.skipWaiting()
})

self.addEventListener("activate", (event) => {
    console.log(`[SW] Activating ${CACHE_NAME}...`)
    event.waitUntil(
        caches
            .keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            console.log(`[SW] Deleting old cache: ${cacheName}`)
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
    console.log(`[SW] Intercepted: ${url.pathname}`)

    // 1. Offline First Strategy for static assets
    if (url.pathname.startsWith("/sandbox/")) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                return cachedResponse || fetch(event.request)
            }),
        )
        return
    }

    // 2. Intercept Specific "Untrusted" Requests from Executor
    if (url.pathname === "/secret.txt") {
        event.respondWith(
            new Response("Intercepted Secret Data! You are safe.", {
                status: 200,
            }),
        )
        return
    }

    // 3. Block access to sensitive endpoints or Host (conceptually)
    // Since we are origin-isolated from localhost:3333, we can't easily fetch host data anyway (CORS),
    // but if the Host had CORS enabled, we could block it here.

    // Default: Allow network
    event.respondWith(fetch(event.request))
})
