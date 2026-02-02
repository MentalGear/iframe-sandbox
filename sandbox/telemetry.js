/**
 * Service Worker Telemetry Utilities
 * Handles safe serialization and broadcasting of firewall/network events.
 */

self.telemetry = {
    _channel: null,

    /**
     * Lazy-load the BroadcastChannel singleton.
     */
    getChannel() {
        if (!this._channel) {
            this._channel = new BroadcastChannel("sandbox-telemetry")
        }
        return this._channel
    },

    /**
     * Broadcasts a message to all active clients (sandboxed windows).
     */
    async broadcast(category, data, clientId = null) {
        // Method 1: BroadcastChannel (Primary - Persistent)
        try {
            this.getChannel().postMessage({
                type: "SW_TELEMETRY",
                category,
                ...data,
            })
        } catch (e) {
            console.error("[SW-Telemetry] BroadcastChannel failed:", e)
        }

        // Method 2: Direct Client Target (Backup for uncontrolled/initial frames)
        if (clientId) {
            try {
                const client = await self.clients.get(clientId)
                if (client) {
                    client.postMessage({
                        type: "SW_TELEMETRY",
                        category,
                        ...data,
                    })
                }
            } catch (e) {
                // Using console.debug to reduce noise for expected failures
                console.debug(
                    `[SW-Telemetry] Direct post failed (client ${clientId} not found/uncontrolled)`,
                )
            }
        }
    },

    /**
     * Safely serializes an Error object for postMessage.
     */
    serializeError(err, url) {
        return {
            name: err.name || "Error",
            message: err.message || "Unknown error",
            url: url || "unknown",
        }
    },

    /**
     * Safely serializes a Response object for postMessage.
     */
    serializeNetwork(request, response) {
        return {
            method: request.method,
            url: request.url,
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
        }
    },
}
