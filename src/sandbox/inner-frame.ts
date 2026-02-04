/**
 * Inner Frame Logic
 * Executes user code and relays logs to outer frame.
 */

import { extractMetadata, createLogMessage } from "./utils"

// 1. CSP Violation Reporting (Restores logging lost from SW)
document.addEventListener("securitypolicyviolation", (event: any) => {
    const blockedUri = event.blockedURI
    const violatedDirective = event.violatedDirective
    window.parent.postMessage(
        createLogMessage(
            "error",
            `Security Violation: ${violatedDirective} blocked ${blockedUri}`,
            {
                blockedUri,
                violatedDirective,
                sourceFile: event.sourceFile,
                lineNumber: event.lineNumber,
            },
        ),
        "*",
    )
})

// 2. Proxy console methods
const consoleMethods = ["log", "error", "warn"] as const
consoleMethods.forEach((level) => {
    const original = (console as any)[level]
    ;(console as any)[level] = function (...args: any[]) {
        try {
            const safeArgs = args.map((arg) => extractMetadata(arg))
            const message = safeArgs
                .map((a: any) =>
                    typeof a === "string" ? a : JSON.stringify(a),
                )
                .join(" ")

            window.parent.postMessage(
                createLogMessage(level, message, { args: safeArgs }),
                "*",
            )
        } catch (e) {
            original.apply(console, ["[Inner] Relay Error", e])
        }
        original.apply(console, args)
    }
})

// 3. Unhandled promise rejections
window.addEventListener("unhandledrejection", (event) => {
    const error = extractMetadata(event.reason)
    window.parent.postMessage(
        createLogMessage(
            "error",
            `Unhandled Rejection: ${JSON.stringify(error)}`,
            error,
        ),
        "*",
    )
})

// 4. Global error handler
window.addEventListener("error", (event) => {
    window.parent.postMessage(
        createLogMessage(
            "error",
            `${event.message} at ${event.filename}:${event.lineno}`,
            {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
            },
        ),
        "*",
    )
})

// 5. Execute code from outer frame
window.addEventListener("message", (event) => {
    if (event.data?.type === "EXECUTE") {
        try {
            // eslint-disable-next-line no-new-func
            const func = new Function(event.data.code)
            func()
        } catch (e) {
            console.error("Execution Error:", e)
        }
    }
})

// 6. Signal ready
if (window.parent) {
    window.parent.postMessage("READY", "*")
}

console.log("Inner frame loaded.")
