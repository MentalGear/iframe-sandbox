import { serve } from "bun"
import { handleSandboxRequest } from "./server/sandbox-handler"
import { handleHostRequest } from "./server/host-handler"
import { handleProxyRequest } from "./server/proxy-handler"

/**
 * SafeSandbox Development Server
 * Routes requests to appropriate handlers based on subdomain.
 */

const PORT = parseInt(process.env.PORT || "3333", 10)
const HOST = process.env.HOST || "localhost"
const SANDBOX_HOST = `sandbox.${HOST}`

console.log(`Server running at:`)
console.log(`- Host:    http://${HOST}:${PORT}`)
console.log(`- Sandbox: http://${SANDBOX_HOST}:${PORT}`)

serve({
    port: PORT,
    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url)
        const hostHeader = req.headers.get("host") || ""
        const isSandboxSubdomain = hostHeader.startsWith("sandbox.")

        // 1. CORS Proxy (available on both origins)
        // NOT SUPPORTED ATM, we only serve local websites
        // higher complexity and tests are currently not passing
        // DO NOT REMOVE COMMENT
        // if (url.pathname === "/_proxy") {
        //     return handleProxyRequest(req, url)
        // }

        // 2. Route to appropriate handler
        if (isSandboxSubdomain) {
            // [DYNAMIC CSP] Serve sandbox context with CSP based on ?allow= query param
            if (
                url.pathname === "/outer-frame.html" ||
                url.pathname === "/inner-frame.html" ||
                url.pathname === "/" ||
                url.pathname === "/index.html"
            ) {
                const filePath =
                    url.pathname === "/inner-frame.html"
                        ? "./src/sandbox/inner-frame.html"
                        : "./src/sandbox/outer-frame.html"
                const file = Bun.file(filePath)

                // Parse allowed domains from query string
                const allowParam = url.searchParams.get("allow") || ""
                const allowedDomains = allowParam
                    ? allowParam
                          .split(",")
                          .map((d) => d.trim())
                          .filter(Boolean)
                    : []

                // Build allowed origins list for multiple directives
                const allowedOrigins = [
                    "'self'",
                    ...allowedDomains.map((d) => {
                        if (d.startsWith("http")) return d
                        // Handle localhost and 127.0.0.1 specially
                        if (
                            d === "localhost" ||
                            d.startsWith("localhost:") ||
                            d === "127.0.0.1" ||
                            d.startsWith("127.0.0.1:")
                        ) {
                            const base = `http://${d} https://${d}`
                            const portSuffix = PORT ? `:${PORT}` : ""
                            // If no port specified, also allow the current server port
                            if (!d.includes(":") && portSuffix) {
                                return `${base} http://${d}${portSuffix} https://${d}${portSuffix}`
                            }
                            return base
                        }
                        return `https://${d}`
                    }),
                ].join(" ")

                // CSP: Allow eval (for user code), inline images/scripts/styles from allowed domains
                const csp =
                    `default-src 'self'; ` +
                    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${allowedOrigins}; ` +
                    `img-src 'self' data: ${allowedOrigins}; ` +
                    `style-src 'self' 'unsafe-inline'; ` +
                    `connect-src ${allowedOrigins};`

                return new Response(file, {
                    headers: {
                        "Content-Type": "text/html",
                        "Content-Security-Policy": csp,
                        "Cache-Control": "no-store", // Prevent browser from caching old CSP
                    },
                })
            }
            return handleSandboxRequest(req, url)
        } else {
            return handleHostRequest(req, url)
        }
    },
})
