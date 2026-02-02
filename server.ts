import { serve, type Server } from "bun"
import { join } from "path"

/**
 * SafeSandbox Server
 * Handles Host assets (localhost:3333) and Sandbox assets (sandbox.localhost:3333).
 */

const PORT = 3333

console.log(`Server running at:`)
console.log(`- Host:    http://localhost:${PORT}`)
console.log(`- Sandbox: http://sandbox.localhost:${PORT}`)

const server = {
    port: PORT,
    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url)
        const hostHeader = req.headers.get("host") || ""
        const isSandboxSubdomain = hostHeader.startsWith("sandbox.")
        let path = url.pathname

        // 1. CORS Proxy (Optional enhancement)
        if (path === "/_proxy") {
            const targetUrl = url.searchParams.get("url")
            const proxyHeaders = new Headers()
            proxyHeaders.set("Access-Control-Allow-Origin", "*")
            proxyHeaders.set(
                "Access-Control-Allow-Methods",
                "GET, POST, OPTIONS",
            )
            proxyHeaders.set("Access-Control-Allow-Headers", "*")

            if (req.method === "OPTIONS")
                return new Response(null, { headers: proxyHeaders })
            if (!targetUrl)
                return new Response("Missing url", {
                    status: 400,
                    headers: proxyHeaders,
                })

            console.log(`[Proxy] Fetching: ${targetUrl}`)
            try {
                const proxyRes = await fetch(targetUrl)
                const resHeaders = new Headers(proxyRes.headers)

                // Security: Strip headers that might conflict with the uncompressed body
                resHeaders.delete("content-encoding")
                resHeaders.delete("content-length")
                resHeaders.delete("transfer-encoding")
                resHeaders.delete("connection")

                // Ensure the sandbox can read the returned data
                resHeaders.set("Access-Control-Allow-Origin", "*")
                return new Response(proxyRes.body, {
                    status: proxyRes.status,
                    statusText: proxyRes.statusText,
                    headers: resHeaders,
                })
            } catch (e: any) {
                return new Response(`Proxy Error: ${e.message}`, {
                    status: 502,
                    headers: proxyHeaders,
                })
            }
        }

        // 2. Router & Subdomain Mapping
        if (isSandboxSubdomain) {
            if (path === "/sw.js") path = "/sandbox/sw.js"
            else if (!path.startsWith("/sandbox/")) {
                path = "/sandbox" + (path === "/" ? "/index.html" : path)
            }
        } else {
            // Main domain (localhost:3333) logic
            if (path === "/SafeSandbox.js") {
                path = "/client/SafeSandbox.js"
            } else if (path === "/sw.js") {
                // Fallback for demo: serve Sandbox SW from root if needed
                path = "/sandbox/sw.js"
            } else if (
                !path.startsWith("/client/") &&
                !path.startsWith("/sandbox/")
            ) {
                path = "/client" + (path === "/" ? "/index.html" : path)
            }
        }

        // 3. Serve Files
        if (path.includes(".."))
            return new Response("Forbidden", { status: 403 })

        const relPath = path.startsWith("/") ? path.slice(1) : path
        const filePath = join(process.cwd(), relPath)
        const file = Bun.file(filePath)

        if (await file.exists()) {
            const responseHeaders: Record<string, string> = {
                "Content-Type": file.type,
                "Cache-Control": "no-store, no-cache, must-revalidate",
            }

            // Allow SW to register at root
            if (path.endsWith("sw.js"))
                responseHeaders["Service-Worker-Allowed"] = "/"

            if (isSandboxSubdomain || path.startsWith("/sandbox/")) {
                // Sandbox Security Policy
                responseHeaders["Content-Security-Policy"] =
                    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src *;"
            } else {
                // Host Security Policy (Strict Subdomain Framing)
                const sandboxOrigin = `http://sandbox.localhost:${PORT}`
                responseHeaders["Content-Security-Policy"] =
                    `default-src 'self' ${sandboxOrigin}; ` +
                    `script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; ` +
                    `frame-src ${sandboxOrigin};`
            }

            return new Response(file as any, { headers: responseHeaders })
        }

        console.log(`[Server] 404: ${path} (from ${hostHeader})`)
        return new Response("Not Found", { status: 404 })
    },
}

serve(server)
