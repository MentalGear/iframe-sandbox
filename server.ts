import { serve } from "bun"
import { join } from "path"

const PORT = 3333

console.log(`Server running at:`)
console.log(`- Host:    http://localhost:${PORT}`)
console.log(`- Sandbox: http://127.0.0.1:${PORT}`) // Same server, distinct origin

serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url)
        let path = url.pathname

        // Router
        if (path === "/" || path === "/index.html") {
            path = "/client/index.html"
        } else if (path === "/sw.js") {
            path = "/client/sw.js"
        }

        console.log(`[Server] ${req.method} ${url.pathname} -> ${path}`)

        // Security: Avoid serving sensitive files
        if (path.includes("..") || path.includes(".env")) {
            return new Response("Forbidden", { status: 403 })
        }

        // Resolve file path
        const filePath = join(process.cwd(), path)
        const file = Bun.file(filePath)

        if (await file.exists()) {
            const responseHeaders: Record<string, string> = {
                "Content-Type": file.type,
                "Cache-Control": "no-store, no-cache, must-revalidate",
            }

            // Security: Add CSP
            if (path.startsWith("/sandbox/")) {
                responseHeaders["Content-Security-Policy"] =
                    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
            } else if (path.startsWith("/client/")) {
                responseHeaders["Content-Security-Policy"] =
                    "default-src 'self' http://127.0.0.1:3333; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src http://127.0.0.1:3333;"
            }

            console.log(
                `[Server] CSP: ${responseHeaders["Content-Security-Policy"] || "none"}`,
            )
            return new Response(file, { headers: responseHeaders })
        }

        console.log(`[Server] 404: ${path}`)
        return new Response("Not Found", { status: 404 })
    },
})
