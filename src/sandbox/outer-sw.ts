/**
 * Sandbox Service Worker (Outer Frame)
 * Implements network firewall (allowlist) and in-memory filesystem.
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope

// ============ IPC Utilities (inlined) ============

import type { LogMessage, NetworkRules } from "../lib/types"

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

const CACHE_NAME = "sandbox-cache-v12"
const ASSETS_TO_CACHE = ["/outer-frame.html", "/inner-frame.html"]

// Helper to check content length against max limit
async function checkContentLength(
    response: Response,
    maxLength: number | undefined,
    requestUrl: string,
    clientId: string,
): Promise<Response | null> {
    if (!maxLength) return null // No limit set

    const contentLength = response.headers.get("content-length")
    if (contentLength) {
        const size = parseInt(contentLength, 10)
        if (size > maxLength) {
            const blockMsg = `Blocked: Response too large (${size} bytes > ${maxLength} limit)`
            await ipc.send(
                "error",
                "security",
                blockMsg,
                { url: requestUrl, size, maxLength },
                clientId,
            )
            return new Response(JSON.stringify({ error: blockMsg }), {
                status: 413,
                headers: { "Content-Type": "application/json" },
            })
        }
    }
    return null // Size OK or unknown
}

const params = new URL(self.location.href).searchParams
const CACHE_STRATEGY = params.get("strategy") || "network-first"

let networkRules: NetworkRules = {
    allow: [],
    allowProtocols: ["http", "https"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
    maxContentLength: undefined,
    proxyUrl: undefined,
    files: {},
    cacheStrategy: "network-first",
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)),
    )
    self.skipWaiting()
})

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim())
})

// Heartbeat state
let heartbeatPort: MessagePort | null = null

self.addEventListener("message", (event) => {
    const data = event.data

    // 1. Handle Rules Update
    if (data?.type === "SET_NETWORK_RULES") {
        networkRules = {
            allow: data.rules?.allow ?? [],
            allowProtocols: data.rules?.allowProtocols ?? ["http", "https"],
            allowMethods: data.rules?.allowMethods ?? [
                "GET",
                "POST",
                "PUT",
                "DELETE",
                "PATCH",
                "HEAD",
                "OPTIONS",
            ],
            maxContentLength: data.rules?.maxContentLength ?? undefined,
            proxyUrl: data.rules?.proxyUrl ?? undefined,
            files: data.rules?.files ?? {},
            cacheStrategy: data.rules?.cacheStrategy ?? "network-first",
        }

        // Notify clients that rules are applied
        ipc.send("log", "system", "Network rules applied.", {
            rules: networkRules,
        })
    }

    // 2. Handle Heartbeat Port Registration
    if (data && data.type === "REGISTER_HEARTBEAT_PORT" && event.ports[0]) {
        heartbeatPort = event.ports[0]

        // Listen for PING
        heartbeatPort.onmessage = (e) => {
            if (e.data === "PING") {
                heartbeatPort?.postMessage("PONG")
            }
        }

        // Notify host we are ready
        heartbeatPort.postMessage("SW_HEARTBEAT_CONNECTED")
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
                // Special handling for inner-frame.html to inject CSP headers (immutable security)
                if (url.pathname.endsWith("/inner-frame.html")) {
                    const response = await (async () => {
                        const cached = await caches.match(event.request)
                        if (cached) return cached
                        return fetch(event.request)
                    })()

                    const newHeaders = new Headers(response.headers)
                    // SECURITY CSP:
                    // connect-src http: https: -> Allows standard HTTP/S (intercepted by SW).
                    //                             BLOCKS ws: wss: (WebSockets) and WebRTC.
                    // img-src * data: blob:    -> Allows images (intercepted by SW firewall).
                    // frame-src 'none'         -> BLOCKS child iframes (prevents escaping to fresh context).
                    newHeaders.set(
                        "Content-Security-Policy",
                        "connect-src http: https:; img-src * data: blob:; frame-src 'none'; default-src * 'unsafe-inline' 'unsafe-eval';",
                    )

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    })
                }

                const strategy = networkRules.cacheStrategy ?? "network-first"
                if (strategy === "cache-first") {
                    const cached = await caches.match(event.request)
                    return cached || fetch(event.request)
                } else if (strategy === "network-only") {
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

            // 3. Protocol Check
            const protocol = url.protocol.replace(":", "") as "http" | "https"
            const allowedProtocols = networkRules.allowProtocols ?? [
                "http",
                "https",
            ]
            if (!allowedProtocols.includes(protocol)) {
                const blockMsg = `Blocked: ${protocol}:// not allowed (only ${allowedProtocols.join(", ")})`
                await ipc.send(
                    "error",
                    "security",
                    blockMsg,
                    { url: event.request.url },
                    event.clientId,
                )
                return new Response(JSON.stringify({ error: blockMsg }), {
                    status: 403,
                    headers: { "Content-Type": "application/json" },
                })
            }

            // 4. Method Check
            const method = event.request.method
            const allowedMethods = networkRules.allowMethods ?? [
                "GET",
                "POST",
                "PUT",
                "DELETE",
                "PATCH",
                "HEAD",
                "OPTIONS",
            ]
            if (!allowedMethods.includes(method)) {
                const blockMsg = `Blocked: ${method} not allowed (only ${allowedMethods.join(", ")})`
                await ipc.send(
                    "error",
                    "security",
                    blockMsg,
                    { url: event.request.url },
                    event.clientId,
                )
                return new Response(JSON.stringify({ error: blockMsg }), {
                    status: 403,
                    headers: { "Content-Type": "application/json" },
                })
            }

            // 5. Allowed Domains
            const allowList = networkRules.allow ?? []
            const isAllowed = allowList.some((domain) =>
                url.hostname.endsWith(domain),
            )

            if (isAllowed) {
                if (networkRules.proxyUrl) {
                    // Build proxy URL - support relative and absolute paths
                    let proxyBase = networkRules.proxyUrl
                    if (proxyBase.startsWith("/")) {
                        // Relative path - prepend host origin
                        const hostOrigin = self.location.origin.replace(
                            "sandbox.",
                            "",
                        )
                        proxyBase = hostOrigin + proxyBase
                    }
                    const proxyUrl = `${proxyBase}?url=${encodeURIComponent(event.request.url)}`

                    await ipc.send(
                        "log",
                        "network",
                        `Proxy: ${event.request.url}`,
                        {},
                        event.clientId,
                    )

                    try {
                        const res = await fetch(proxyUrl)

                        // Check content length limit
                        const sizeBlock = await checkContentLength(
                            res,
                            networkRules.maxContentLength,
                            event.request.url,
                            event.clientId,
                        )
                        if (sizeBlock) return sizeBlock

                        const clonedRes = res.clone()
                        await ipc.send(
                            "log",
                            "network",
                            `${event.request.method} ${event.request.url} -> ${res.status}`,
                            ipc.serializeNetwork(event.request, res),
                            event.clientId,
                        )
                        return clonedRes
                    } catch (err: any) {
                        const errorDetails = ipc.serializeError(
                            err,
                            event.request.url,
                        )
                        await ipc.send(
                            "error",
                            "network",
                            `Proxy error: ${errorDetails.message}`,
                            errorDetails,
                            event.clientId,
                        )
                        return new Response(JSON.stringify(errorDetails), {
                            status: 502,
                            headers: { "Content-Type": "application/json" },
                        })
                    }
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

                    // Check content length limit
                    const sizeBlock = await checkContentLength(
                        res,
                        networkRules.maxContentLength,
                        event.request.url,
                        event.clientId,
                    )
                    if (sizeBlock) return sizeBlock

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

                    if (!networkRules.proxyUrl) {
                        message +=
                            " (Try adding a proxyUrl and ensure that server route handle/changes the CORS headers accordingly.)"
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
