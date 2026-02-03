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
        if (url.pathname === "/_proxy") {
            return handleProxyRequest(req, url)
        }

        // 2. Route to appropriate handler
        if (isSandboxSubdomain) {
            return handleSandboxRequest(req, url)
        } else {
            return handleHostRequest(req, url)
        }
    },
})
