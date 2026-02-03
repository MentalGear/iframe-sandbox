/**
 * Proxy Handler - CORS proxy for external resources
 * Shared by both host and sandbox origins.
 */

export async function handleProxyRequest(
    req: Request,
    url: URL,
): Promise<Response> {
    const targetUrl = url.searchParams.get("url")

    const corsHeaders = new Headers()
    corsHeaders.set("Access-Control-Allow-Origin", "*")
    corsHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    corsHeaders.set("Access-Control-Allow-Headers", "*")

    // Handle preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders })
    }

    if (!targetUrl) {
        return new Response("Missing url parameter", {
            status: 400,
            headers: corsHeaders,
        })
    }

    console.log(`[Proxy] Fetching: ${targetUrl}`)

    try {
        const proxyRes = await fetch(targetUrl)
        const resHeaders = new Headers(proxyRes.headers)

        // Remove problematic headers
        resHeaders.delete("content-encoding")
        resHeaders.delete("content-length")
        resHeaders.delete("transfer-encoding")
        resHeaders.delete("connection")

        // Add CORS
        resHeaders.set("Access-Control-Allow-Origin", "*")

        return new Response(proxyRes.body, {
            status: proxyRes.status,
            statusText: proxyRes.statusText,
            headers: resHeaders,
        })
    } catch (e: any) {
        return new Response(`Proxy Error: ${e.message}`, {
            status: 502,
            headers: corsHeaders,
        })
    }
}
