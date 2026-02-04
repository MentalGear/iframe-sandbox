import { join } from "path"

/**
 * Sandbox Handler - Minimal file exposure
 * Only serves the 3 files needed for sandbox infrastructure.
 */

const SANDBOX_ROOT = join(process.cwd(), "src/sandbox")

// Permissive CSP - Service Worker is the network security layer
// CSP only controls execution (inline, eval) which we handle via iframe sandbox attribute
// frame-src 'self' prevents user code from creating iframes to external origins
const SANDBOX_CSP =
    "default-src * blob: data:; " +
    "script-src * 'unsafe-inline' 'unsafe-eval' blob:; " +
    "style-src * 'unsafe-inline'; " +
    "img-src * blob: data:; " +
    "font-src * data:; " +
    "connect-src *; " +
    "frame-src 'self';"

export async function handleSandboxRequest(
    req: Request,
    url: URL,
): Promise<Response> {
    const path = url.pathname

    // Only these 3 routes are allowed
    let filePath: string
    let isTypeScript = false

    if (
        path === "/" ||
        path === "/index.html" ||
        path === "/outer-frame.html"
    ) {
        filePath = join(SANDBOX_ROOT, "outer-frame.html")
    } else if (path === "/inner-frame.html") {
        filePath = join(SANDBOX_ROOT, "inner-frame.html")
    } else if (path === "/outer-sw.js") {
        filePath = join(SANDBOX_ROOT, "outer-sw.ts")
        isTypeScript = true
    } else {
        // Block everything else
        return new Response("Not Found", { status: 404 })
    }

    const file = Bun.file(filePath)
    if (!(await file.exists())) {
        return new Response("Not Found", { status: 404 })
    }

    const headers: Record<string, string> = {
        "Content-Type": file.type,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Security-Policy": SANDBOX_CSP,
    }

    // Transpile TypeScript for browser
    if (isTypeScript) {
        headers["Content-Type"] = "application/javascript"
        headers["Service-Worker-Allowed"] = "/"

        const result = await Bun.build({
            entrypoints: [filePath],
            target: "browser",
            format: "esm",
        })

        if (result.success && result.outputs.length > 0) {
            const jsCode = await result.outputs[0].text()
            return new Response(jsCode, { headers })
        } else {
            console.error("[Sandbox] Build failed:", result.logs)
            return new Response("Build Error", { status: 500 })
        }
    }

    return new Response(file as any, { headers })
}
