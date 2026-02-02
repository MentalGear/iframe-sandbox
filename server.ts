import { serve } from "bun"
import { join } from "path"

/**
 * SafeSandbox Server
 * Handles Host assets (localhost) and Sandbox assets (sandbox.localhost).
 */

const PORT = parseInt(process.env.PORT || "3333", 10)
const HOST = process.env.HOST || "localhost"
const SANDBOX_HOST = `sandbox.${HOST}`

console.log(`Server running at:`)
console.log(`- Host:    http://${HOST}:${PORT}`)
console.log(`- Sandbox: http://${SANDBOX_HOST}:${PORT}`)

const server = {
    port: PORT,
    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url)
        const hostHeader = req.headers.get("host") || ""
        const isSandboxSubdomain = hostHeader.startsWith("sandbox.")
        let path = url.pathname

        // 1. CORS Proxy
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
                resHeaders.delete("content-encoding")
                resHeaders.delete("content-length")
                resHeaders.delete("transfer-encoding")
                resHeaders.delete("connection")
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
            // Sandbox subdomain routing
            if (path === "/outer-sw.js") {
                path = "/sandbox/outer-sw.ts"
            } else if (path === "/" || path === "/index.html") {
                path = "/sandbox/outer-frame.html"
            } else if (!path.startsWith("/sandbox/")) {
                path = "/sandbox" + path
            }
        } else {
            // Host domain routing
            if (path === "/SafeSandbox.js" || path === "/lib/SafeSandbox.js") {
                path = "/lib/SafeSandbox.ts"
            } else if (
                !path.startsWith("/playground/") &&
                !path.startsWith("/lib/") &&
                !path.startsWith("/sandbox/")
            ) {
                path = "/playground" + (path === "/" ? "/index.html" : path)
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

            // Transpile TypeScript files for browser
            if (path.endsWith(".ts")) {
                responseHeaders["Content-Type"] = "application/javascript"

                try {
                    const result = await Bun.build({
                        entrypoints: [filePath],
                        target: "browser",
                        format: "esm",
                    })

                    if (result.success && result.outputs.length > 0) {
                        const jsCode = await result.outputs[0].text()

                        // Add headers and return transpiled JS
                        if (path.includes("outer-sw"))
                            responseHeaders["Service-Worker-Allowed"] = "/"

                        if (
                            isSandboxSubdomain ||
                            path.startsWith("/sandbox/")
                        ) {
                            responseHeaders["Content-Security-Policy"] =
                                "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src *;"
                        } else {
                            const sandboxOrigin = `http://${SANDBOX_HOST}:${PORT}`
                            responseHeaders["Content-Security-Policy"] =
                                `default-src 'self' ${sandboxOrigin}; ` +
                                `script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; ` +
                                `frame-src ${sandboxOrigin};`
                        }

                        return new Response(jsCode, {
                            headers: responseHeaders,
                        })
                    } else {
                        console.error(
                            `[Server] Build failed for ${path}:`,
                            result.logs,
                        )
                        return new Response("Build Error", { status: 500 })
                    }
                } catch (e: any) {
                    console.error(`[Server] Transpile error for ${path}:`, e)
                    return new Response(`Transpile Error: ${e.message}`, {
                        status: 500,
                    })
                }
            }

            // Allow SW to register at root
            if (path.includes("outer-sw"))
                responseHeaders["Service-Worker-Allowed"] = "/"

            if (isSandboxSubdomain || path.startsWith("/sandbox/")) {
                // Sandbox Security Policy
                responseHeaders["Content-Security-Policy"] =
                    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src *;"
            } else {
                // Host Security Policy
                const sandboxOrigin = `http://${SANDBOX_HOST}:${PORT}`
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
