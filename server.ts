import { serve } from "bun"
import { join } from "path"

const PORT = 3333

console.log(`Server running at:`)
console.log(`- Host:    http://localhost:${PORT}`)
console.log(`- Sandbox: http://sandbox.localhost:${PORT}`)

serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url)
        const hostHeader = req.headers.get("host") || ""
        const isSandboxSubdomain = hostHeader.startsWith("sandbox.")
        let path = url.pathname

        // 1. CORS Proxy (must be before path mapping)
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

        // 2. Router
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
                // Forward legacy SW requests to sandbox SW (for demo purposes)
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

            if (path.endsWith("sw.js"))
                responseHeaders["Service-Worker-Allowed"] = "/"

            if (isSandboxSubdomain || path.startsWith("/sandbox/")) {
                responseHeaders["Content-Security-Policy"] =
                    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src *;"
            } else {
                const sandboxOrigin = `http://sandbox.localhost:${PORT}`
                responseHeaders["Content-Security-Policy"] =
                    `default-src 'self' ${sandboxOrigin} http://127.0.0.1:${PORT}; ` +
                    `script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; ` +
                    `frame-src ${sandboxOrigin} http://127.0.0.1:${PORT};`
            }

            return new Response(file, { headers: responseHeaders })
        }

        console.log(`[Server] 404: ${path} (from ${hostHeader})`)
        return new Response("Not Found", { status: 404 })
    },
})
