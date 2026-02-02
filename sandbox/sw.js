const CACHE_NAME = "sandbox-cache-v7"
const ASSETS_TO_CACHE = [
    "/sandbox/index.html",
    "/sandbox/executor.html",
    "/sandbox/sw.js",
]

// Ephemeral Rules Store (In-Memory)
// Resets to "Block All" whenever the Service Worker restarts.
let networkRules = {
    allow: [],
    files: {},
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)),
    )
    self.skipWaiting()
})

self.addEventListener("activate", (event) => {
    event.waitUntil(
        Promise.all([
            caches
                .keys()
                .then((keys) =>
                    Promise.all(
                        keys.map((k) => k !== CACHE_NAME && caches.delete(k)),
                    ),
                ),
            clients.claim(),
        ]),
    )
})

self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SET_NETWORK_RULES") {
        console.log(
            "[SW] Updating network rules (Ephemeral):",
            event.data.rules,
        )
        // Merge with existing rules or replace?
        // Typically replace is safer to ensure state matches Host intent.
        // But for partial updates, merge might be desired.
        // For this library, we'll replace to keep it deterministic.
        networkRules = event.data.rules
    }
})

self.addEventListener("fetch", (event) => {
    event.respondWith(
        (async () => {
            const url = new URL(event.request.url)
            const sameOrigin = url.origin === self.location.origin

            // 1. Static Assets (Always allow)
            if (sameOrigin && ASSETS_TO_CACHE.includes(url.pathname)) {
                const cached = await caches.match(event.request)
                return cached || fetch(event.request)
            }

            // 2. Virtual Files
            if (networkRules.files && networkRules.files[url.pathname]) {
                return new Response(networkRules.files[url.pathname], {
                    status: 200,
                    headers: { "Content-Type": "text/plain" },
                })
            }

            // 3. Allowlist Check
            const allowList = networkRules.allow || []
            const isAllowed = allowList.some((pattern) => {
                if (pattern.includes("://"))
                    return event.request.url.startsWith(pattern)
                return (
                    url.hostname === pattern ||
                    url.hostname.endsWith("." + pattern)
                )
            })

            if (sameOrigin || isAllowed) {
                if (!sameOrigin) {
                    // Route cross-origin allowed requests through host proxy
                    const hostOrigin = self.location.origin.replace(
                        "sandbox.",
                        "",
                    )
                    const proxyUrl = `${hostOrigin}/_proxy?url=${encodeURIComponent(event.request.url)}`
                    return fetch(proxyUrl).catch((err) => {
                        console.error("[SW] Proxy fetch failed:", err)
                        return new Response(
                            JSON.stringify({
                                error: `Proxy Error: ${err.message}`,
                            }),
                            {
                                status: 502,
                                headers: { "Content-Type": "application/json" },
                            },
                        )
                    })
                }
                return fetch(event.request)
            }

            // 4. Block
            console.warn(`[SW] Blocked: ${event.request.url}`)
            return new Response(
                JSON.stringify({
                    error: "Blocked by Sandbox Security Policy.",
                }),
                {
                    status: 403,
                    headers: { "Content-Type": "application/json" },
                },
            )
        })(),
    )
})
