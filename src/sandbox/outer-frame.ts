/**
 * Outer Frame Logic
 * Handles Service Worker registration and message relay.
 */

// 1. Origin Setup
const innerFrame = document.getElementById("inner") as HTMLIFrameElement
const params = new URLSearchParams(window.location.search)

// Prefer explicit Host Origin passed from parent, fallback only if missing
const HOST_ORIGIN =
    params.get("host") || window.location.origin.replace("sandbox.", "")

// Load inner frame with same query params (for CSP propagation)
innerFrame.src = "inner-frame.html" + window.location.search

// Type definitions for global state
declare global {
    interface Window {
        pendingRules: any
    }
}

window.pendingRules = null

// Helper: Send status updates to host
function sendStatus(status: string, level: "log" | "warn" | "error" = "log") {
    window.parent.postMessage(
        {
            type: "LOG",
            source: "outer",
            level: level,
            area: "system",
            message: status,
            timestamp: Date.now(),
        },
        HOST_ORIGIN,
    )
}

function syncRulesWithSW(rules: any) {
    if (!rules) return
    navigator.serviceWorker.ready.then((registration) => {
        const worker = registration.active
        if (worker) {
            worker.postMessage({
                type: "UPDATE_RULES",
                rules: rules,
            })
            sendStatus("SW: rules synced")
        }
    })
}

// 2. Service Worker Registration
if ("serviceWorker" in navigator) {
    sendStatus("SW: registering...")

    navigator.serviceWorker
        .register("/outer-sw.js", {
            scope: "/",
            updateViaCache: "none",
            type: "module",
        })
        .then((reg) => {
            sendStatus("SW: registered")

            const checkState = () => {
                if (reg.active) {
                    sendStatus("SW: active")
                    window.parent.postMessage("READY", HOST_ORIGIN)
                } else {
                    setTimeout(checkState, 100)
                }
            }
            checkState()
        })
        .catch((err) => {
            sendStatus("SW: error: " + err.message)
        })

    // When the service worker takes control, sync the current rules
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        sendStatus("SW: controller changed, syncing rules...")
        if (window.pendingRules) {
            syncRulesWithSW(window.pendingRules)
        }
    })

    // Listen for messages from SW (Virtual File events only now)
    navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "LOG") {
            window.parent.postMessage(event.data, HOST_ORIGIN)
        }
    })
} else {
    sendStatus("SW: not supported", "error")
}

// 3. Message Handler - Unified relay and trace
let innerFrameReady = false
let executionQueue: any[] = []

window.addEventListener("message", (event) => {
    const data = event.data
    if (!data) return

    const isHost = event.source === window.parent
    const isInner = event.source === innerFrame.contentWindow
    const originMatch = event.origin === HOST_ORIGIN

    // A. Messages from Host
    if (isHost || (originMatch && event.source !== innerFrame.contentWindow)) {
        if (data.type === "EXECUTE") {
            if (innerFrameReady && innerFrame.contentWindow) {
                innerFrame.contentWindow.postMessage(data, "*")
            } else {
                executionQueue.push(data)
            }
        } else if (data.type === "SET_NETWORK_RULES") {
            window.pendingRules = data.rules
            syncRulesWithSW(data.rules)
        } else if (data.type === "RESET") {
            navigator.serviceWorker.getRegistrations().then((regs) => {
                Promise.all(regs.map((r) => r.unregister())).then(() => {
                    window.parent.postMessage(
                        { type: "RESET_COMPLETE" },
                        HOST_ORIGIN,
                    )
                })
            })
        }
        return
    }

    // B. Messages from Inner Frame
    if (isInner) {
        if (data === "READY") {
            innerFrameReady = true

            if (executionQueue.length > 0) {
                while (executionQueue.length > 0) {
                    const qData = executionQueue.shift()
                    innerFrame.contentWindow?.postMessage(qData, "*")
                }
            }

            // Signal to host
            window.parent.postMessage("READY", HOST_ORIGIN)
        } else if (data.type === "LOG") {
            // Relay inner logs to host
            window.parent.postMessage(data, HOST_ORIGIN)
        }
        return
    }
})

// 4. Service Worker Message Listener
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
        const data = event.data
        if (data?.type === "LOG") {
            // Log relay from SW
            window.parent.postMessage(data, HOST_ORIGIN)
        }
    })
}
