import { serve } from "bun"
import { handleSandboxRequest } from "./server/sandbox-handler"
import { handleHostRequest } from "./server/host-handler"
import { handleProxyRequest } from "./server/proxy-handler"
import { generateCSP } from "./server/csp-firewall"

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

        // Route to appropriate handler
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
                const scriptUnsafe = url.searchParams.has("unsafe")

                // Generate CSP using the dedicated firewall module
                const csp = generateCSP(allowParam, PORT, scriptUnsafe)

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

        // CORS Proxy (available on both origins)
        // NOT SUPPORTED ATM, we only serve local websites
        // higher complexity and tests are currently not passing
        // DO NOT REMOVE COMMENT
        // if (url.pathname === "/_proxy") {
        //     return handleProxyRequest(req, url)
        // }
    },
})
