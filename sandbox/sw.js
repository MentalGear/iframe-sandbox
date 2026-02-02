/**
 * Sandbox Service Worker
 * Implements a Virtual Firewall (Allowlist) and In-Memory Filesystem.
 */

importScripts("telemetry.js")

const CACHE_NAME = "sandbox-cache-v10"
const ASSETS_TO_CACHE = [
    "/sandbox/index.html",
    "/sandbox/executor.html",
    "/sandbox/sw.js",
    "/sandbox/telemetry.js",
]

// Configuration via URL Params (e.g., sw.js?strategy=cache-first)
const params = new URL(self.location.href).searchParams
const CACHE_STRATEGY = params.get("strategy") || "network-first"

// Ephemeral Rules Store (In-Memory)
let networkRules = { allow: [], useProxy: false, files: {} }

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)),
    )
    self.skipWaiting()
})

self.addEventListener("activate", (event) => {
    event.waitUntil(clients.claim())
})

self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SET_NETWORK_RULES") {
        networkRules = event.data.rules
    }
})

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url)
    const sameOrigin = url.origin === self.location.origin
    console.log(
        `[SW] Fetch Intercepted: ${url.href} (Strategy: ${CACHE_STRATEGY})`,
    )

    event.respondWith(
        (async () => {
            // 1. Virtual Files (Memory) - PRIORITY
            const virtualPath = url.pathname
            if (networkRules.files && networkRules.files[virtualPath]) {
                self.telemetry.broadcast(
                    "network",
                    {
                        message: `Virtual File: ${virtualPath} -> 200 OK`,
                    },
                    event.clientId,
                )
                return new Response(networkRules.files[virtualPath], {
                    headers: { "Content-Type": "text/plain" },
                })
            }

            // 2. Local Assets (Cache/Same-Origin)
            if (sameOrigin) {
                if (CACHE_STRATEGY === "cache-first") {
                    const cached = await caches.match(event.request)
                    return cached || fetch(event.request)
                } else if (CACHE_STRATEGY === "network-only") {
                    return fetch(event.request)
                } else {
                    // NETWORK FIRST (Default)
                    try {
                        const response = await fetch(event.request)
                        // Update cache in background
                        const cache = await caches.open(CACHE_NAME)
                        cache.put(event.request, response.clone())
                        return response
                    } catch (e) {
                        // Fallback to cache if offline
                        console.log(
                            "[SW] Network failed, falling back to cache",
                            e,
                        )
                        const cached = await caches.match(event.request)
                        if (cached) return cached
                        throw e
                    }
                }
            }

            // 3. Allowed Domains
            const isAllowed = (networkRules.allow || []).some((domain) =>
                url.hostname.endsWith(domain),
            )

            if (isAllowed) {
                if (networkRules.useProxy) {
                    const hostOrigin = self.location.origin.replace(
                        "sandbox.",
                        "",
                    )
                    const proxyUrl = `${hostOrigin}/_proxy?url=${encodeURIComponent(event.request.url)}`
                    self.telemetry.broadcast(
                        "network",
                        {
                            message: `Proxying: ${event.request.url}`,
                        },
                        event.clientId,
                    )
                    return fetch(proxyUrl).then((res) => {
                        self.telemetry.broadcast(
                            "network",
                            self.telemetry.serializeNetwork(event.request, res),
                            event.clientId,
                        )
                        return res
                    })
                }

                self.telemetry.broadcast(
                    "network",
                    {
                        message: `Direct Fetch: ${event.request.url}`,
                    },
                    event.clientId,
                )
                return fetch(event.request)
                    .then((res) => {
                        self.telemetry.broadcast(
                            "network",
                            self.telemetry.serializeNetwork(event.request, res),
                            event.clientId,
                        )
                        return res
                    })
                    .catch((err) => {
                        const errorDetails = self.telemetry.serializeError(
                            err,
                            event.request.url,
                        )
                        self.telemetry.broadcast(
                            "error",
                            errorDetails,
                            event.clientId,
                        ) // Just broadcast the error object

                        // Suggest CORS fix if using direct fetch
                        if (!networkRules.useProxy) {
                            errorDetails.message +=
                                " (Likely CORS issue. Try enabling 'useProxy: true' in network rules and ensure your server has a _proxy route to correctly change/handle cross-origin requests)"
                        }

                        return new Response(JSON.stringify(errorDetails), {
                            status: 502,
                            headers: { "Content-Type": "application/json" },
                        })
                    })
            }

            // 4. Blocked
            const blockMsg = `Blocked by Sandbox Security Policy: ${event.request.url}`
            self.telemetry.broadcast(
                "error",
                { message: blockMsg },
                event.clientId,
            )
            return new Response(
                JSON.stringify({ error: blockMsg, url: event.request.url }),
                {
                    status: 403,
                    headers: { "Content-Type": "application/json" },
                },
            )
        })(),
    )
})
