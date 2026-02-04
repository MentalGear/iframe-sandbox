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

const CACHE_NAME = "sandbox-cache-v15"
const ASSETS_TO_CACHE: string[] = []

// Virtual Files: in-memory filesystem for sandbox
let virtualFiles: Record<string, string> = {}
let currentRules: NetworkRules = {}

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE)
        }),
    )
    self.skipWaiting()
})

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key)),
            )
        }),
    )
    self.clients.claim()
})

self.addEventListener("message", (event) => {
    if (event.data?.type === "UPDATE_FILES") {
        virtualFiles = event.data.files ?? {}
    } else if (event.data?.type === "UPDATE_RULES") {
        currentRules = event.data.rules ?? {}
        if (currentRules.files) {
            virtualFiles = currentRules.files
        }
        ipc.send(
            "log",
            "security",
            `SW: Rules updated (proxy: ${currentRules.proxyUrl || "OFF"})`,
        )
    }
})

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url)
    const ref = event.request.referrer

    // 1. Virtual Files
    const virtualPath = url.pathname
    if (virtualFiles[virtualPath]) {
        event.respondWith(
            new Response(virtualFiles[virtualPath], {
                headers: { "Content-Type": "text/plain" },
            }),
        )
        return
    }

    // 2. Passthrough - CSP (set by server) will block if needed
    event.respondWith(
        fetch(event.request)
            .then(async (response) => {
                // Log successful fetch for telemetry (only for external/proxied requests)
                const isInfra =
                    url.pathname === "/outer-frame.html" ||
                    url.pathname === "/inner-frame.html" ||
                    url.pathname === "/outer-sw.js" ||
                    url.pathname === "/index.html" ||
                    url.pathname === "/"

                if (!isInfra || url.searchParams.has("url")) {
                    await ipc.send(
                        "log",
                        "network",
                        `Fetch: ${event.request.method} ${url.href} -> ${response.status}`,
                        {
                            url: url.href,
                            method: event.request.method,
                            status: response.status,
                        },
                    )
                }
                return response
            })
            .catch(async (err) => {
                // Log failed fetch (could be CSP block or network error)
                await ipc.send(
                    "error",
                    "network",
                    `Fetch Error: ${event.request.method} ${url.href} - ${err.message}`,
                    {
                        url: url.href,
                        method: event.request.method,
                        error: err.message,
                    },
                )
                throw err
            }),
    )
})
