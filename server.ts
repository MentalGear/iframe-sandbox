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
            // If accessed via localhost, serve client (Host)
            // If accessed via 127.0.0.1, serve sandbox (for direct testing, though usually accessed via iframe)
            // Actually, to keep it simple, let's explicitely route:
            // localhost:3333/ -> client/index.html
            // But the sandbox iframe is loaded via 127.0.0.1:3333/sandbox/index.html
            path = "/client/index.html"
        }

        // Serve static files
        // Security: Only allow serving from client/ and sandbox/ folders to prevent directory traversal
        let filePath
        if (path.startsWith("/client/")) {
            filePath = join(process.cwd(), path)
        } else if (path.startsWith("/sandbox/")) {
            filePath = join(process.cwd(), path)
        } else {
            return new Response("Not Found", { status: 404 })
        }

        const file = Bun.file(filePath)
        if (await file.exists()) {
            const headers = new Headers()
            headers.set("Content-Type", file.type)
            headers.set(
                "Cache-Control",
                "no-store, no-cache, must-revalidate, proxy-revalidate",
            )
            headers.set("Pragma", "no-cache")
            headers.set("Expires", "0")

            // Security: Add CSP
            if (path.startsWith("/sandbox/")) {
                // Sandbox needs scripts and same-origin to allow Service Worker
                headers.set(
                    "Content-Security-Policy",
                    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
                )
            } else {
                // Host CSP: Allows loading iframe from 127.0.0.1
                headers.set(
                    "Content-Security-Policy",
                    "default-src 'self' http://127.0.0.1:3333; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src http://127.0.0.1:3333;",
                )
            }

            return new Response(file, { headers })
        }

        console.log(`404: ${path}`)
        return new Response("Not Found", { status: 404 })
    },
})
