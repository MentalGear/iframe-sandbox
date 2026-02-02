/**
 * Sandbox Service Worker (Outer Frame)
 * Implements network firewall (allowlist) and in-memory filesystem.
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope

// ============ IPC Utilities (inlined) ============

interface LogMessage {
    type: "LOG"
    timestamp: number
    source: "outer" | "inner"
    level: "log" | "warn" | "error"
    area?: "network" | "security" | "user-code"
    message: string
    data?: Record<string, unknown>
}

interface NetworkRules {
    allow?: string[]
    useProxy?: boolean
    files?: Record<string, string>
}

const ipc = {
    async send(
        level: LogMessage["level"],
        area: LogMessage["area"],
        message: string,
        data: Record<string, unknown> = {},
        clientId?: string,
    ): Promise<void> {
        const logMessage: LogMessage = {
            type: "LOG",
            timestamp: Date.now(),
            source: "outer",
            level,
            area,
            message,
            data,
        }

        // Send to specific client if provided
        if (clientId) {
            try {
                const client = await self.clients.get(clientId)
                if (client) {
                    client.postMessage(logMessage)
                }
            } catch (e) {
                // Client not reachable
            }
        }

        // Also broadcast to all clients
        try {
            const clients = await self.clients.matchAll()
            for (const client of clients) {
                client.postMessage(logMessage)
            }
        } catch (e) {
            // Failed to broadcast
        }
    },

    serializeError(err: Error, url: string): Record<string, unknown> {
        return {
            name: err.name || "Error",
            message: err.message || "Unknown error",
            url: url || "unknown",
        }
    },

    serializeNetwork(
        request: Request,
        response: Response,
    ): Record<string, unknown> {
        return {
            method: request.method,
            url: request.url,
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
        }
    },
}

// ============ Service Worker ============

const CACHE_NAME = "sandbox-cache-v11"
const ASSETS_TO_CACHE = [
    "/sandbox/outer-frame.html",
    "/sandbox/inner-frame.html",
]

const params = new URL(self.location.href).searchParams
const CACHE_STRATEGY = params.get("strategy") || "network-first"

let networkRules: NetworkRules = { allow: [], useProxy: false, files: {} }

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)),
    )
    self.skipWaiting()
})

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim())
})

self.addEventListener("message", (event) => {
    if (event.data?.type === "SET_NETWORK_RULES") {
        networkRules = {
            allow: event.data.rules?.allow ?? [],
            useProxy: event.data.rules?.useProxy ?? false,
            files: event.data.rules?.files ?? {},
        }
    }
})

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url)
    const sameOrigin = url.origin === self.location.origin

    event.respondWith(
        (async () => {
            // 1. Virtual Files
            const virtualPath = url.pathname
            const files = networkRules.files ?? {}
            if (files[virtualPath]) {
                await ipc.send(
                    "log",
                    "network",
                    `Virtual: ${virtualPath} -> 200`,
                    {},
                    event.clientId,
                )
                return new Response(files[virtualPath], {
                    headers: { "Content-Type": "text/plain" },
                })
            }

            // 2. Same-Origin (Cache)
            if (sameOrigin) {
                if (CACHE_STRATEGY === "cache-first") {
                    const cached = await caches.match(event.request)
                    return cached || fetch(event.request)
                } else if (CACHE_STRATEGY === "network-only") {
                    return fetch(event.request)
                } else {
                    try {
                        const response = await fetch(event.request)
                        const cache = await caches.open(CACHE_NAME)
                        cache.put(event.request, response.clone())
                        return response
                    } catch (e) {
                        const cached = await caches.match(event.request)
                        if (cached) return cached
                        throw e
                    }
                }
            }

            // 3. Allowed Domains
            const allowList = networkRules.allow ?? []
            const isAllowed = allowList.some((domain) =>
                url.hostname.endsWith(domain),
            )

            if (isAllowed) {
                if (networkRules.useProxy) {
                    const hostOrigin = self.location.origin.replace(
                        "sandbox.",
                        "",
                    )
                    const proxyUrl = `${hostOrigin}/_proxy?url=${encodeURIComponent(event.request.url)}`

                    await ipc.send(
                        "log",
                        "network",
                        `Proxy: ${event.request.url}`,
                        {},
                        event.clientId,
                    )

                    const res = await fetch(proxyUrl)
                    await ipc.send(
                        "log",
                        "network",
                        `${event.request.method} ${event.request.url} -> ${res.status}`,
                        ipc.serializeNetwork(event.request, res),
                        event.clientId,
                    )
                    return res
                }

                await ipc.send(
                    "log",
                    "network",
                    `Fetch: ${event.request.url}`,
                    {},
                    event.clientId,
                )

                try {
                    const res = await fetch(event.request)
                    await ipc.send(
                        "log",
                        "network",
                        `${event.request.method} ${event.request.url} -> ${res.status}`,
                        ipc.serializeNetwork(event.request, res),
                        event.clientId,
                    )
                    return res
                } catch (err: any) {
                    const errorDetails = ipc.serializeError(
                        err,
                        event.request.url,
                    )
                    let message = errorDetails.message as string

                    if (!networkRules.useProxy) {
                        message += " (Try useProxy: true)"
                    }

                    await ipc.send(
                        "error",
                        "network",
                        message,
                        errorDetails,
                        event.clientId,
                    )

                    return new Response(JSON.stringify(errorDetails), {
                        status: 502,
                        headers: { "Content-Type": "application/json" },
                    })
                }
            }

            // 4. Blocked
            const blockMsg = `Blocked: ${event.request.url}`
            await ipc.send(
                "error",
                "security",
                blockMsg,
                { url: event.request.url },
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
