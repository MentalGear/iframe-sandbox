/**
 * SafeSandbox Custom Element
 * A secure, isolated JavaScript sandbox using iFrame subdomains and Service Workers.
 */

import { type NetworkRules, type LogMessage } from "./types"

class SafeSandbox extends HTMLElement {
    private _iframe: HTMLIFrameElement
    private _networkRules: NetworkRules
    private _sandboxOrigin: string

    static get observedAttributes(): string[] {
        return ["sandbox-origin", "src", "script-unsafe"]
    }

    constructor() {
        super()
        this.attachShadow({ mode: "open" })

        this._iframe = document.createElement("iframe")
        this._iframe.style.width = "100%"
        this._iframe.style.height = "100%"
        this._iframe.style.border = "none"
        this.shadowRoot!.appendChild(this._iframe)

        this._onMessage = this._onMessage.bind(this)
        this._networkRules = {}
        this._sandboxOrigin = ""
    }

    connectedCallback(): void {
        window.addEventListener("message", this._onMessage)
        this._updateSandboxOrigin()
        this._updateIframeSource()
    }

    disconnectedCallback(): void {
        window.removeEventListener("message", this._onMessage)
    }

    attributeChangedCallback(
        name: string,
        oldValue: string | null,
        newValue: string | null,
    ): void {
        if (oldValue === newValue) return

        if (name === "sandbox-origin") {
            this._updateSandboxOrigin()
            this._updateIframeSource()
        } else if (name === "script-unsafe") {
            this._updateIframeSource()
        } else if (name === "src") {
            // Future: load user content in sandbox
        }
    }

    private _updateSandboxOrigin(): void {
        const attr = this.getAttribute("sandbox-origin")
        if (attr) {
            this._sandboxOrigin = attr
        } else {
            // Default: derive from current origin
            const currentHost = window.location.hostname
            const port = window.location.port
            this._sandboxOrigin = `http://sandbox.${currentHost}${port ? ":" + port : ""}`
        }
    }

    /**
     * Executes JavaScript code within the sandbox.
     */
    execute(code: string): void {
        if (!this._iframe.contentWindow) return
        this._iframe.contentWindow.postMessage(
            { type: "EXECUTE", code },
            this._sandboxOrigin,
        )
    }

    /**
     * Loads a URL inside the sandbox (future: with optional debug capture).
     */
    loadSrc(url: string): void {
        // Future implementation
        console.log("[SafeSandbox] loadSrc not yet implemented:", url)
    }

    /**
     * Sets network rules for the sandbox.
     * - CSP (connect-src) is set via URL params -> server generates CSP header
     * - Virtual Files are sent via postMessage to Service Worker
     */
    setNetworkRules(rules: NetworkRules): void {
        const oldRules = this._networkRules
        this._networkRules = rules

        // Sync attribute with rule
        if (rules.scriptUnsafe) {
            this.setAttribute("script-unsafe", "true")
        } else {
            this.removeAttribute("script-unsafe")
        }

        // Calculate new source URL
        const newSrc = this._calculateIframeSrc()

        // Only reload if the URL (and thus the CSP) would change
        if (this._iframe.src !== newSrc) {
            this._iframe.src = newSrc
        } else {
            // If URL didn't change (e.g. only virtual files changed),
            // we still need to send the files to the SW if it's already ready
            this._sendVirtualFiles()
        }
    }

    private _calculateIframeSrc(): string {
        if (!this._sandboxOrigin) return ""

        const params = new URLSearchParams()

        // Encode allowed domains
        const allowedDomains = this._networkRules.allow || []
        if (allowedDomains.length > 0) {
            params.set("allow", allowedDomains.join(","))
        }

        // Pass host origin to allow robust messaging back
        params.set("host", window.location.origin)

        // Pass unsafe flag if attribute is present
        if (this.hasAttribute("script-unsafe")) {
            params.set("unsafe", "true")
        }

        const queryString = params.toString()
        const allowParam = queryString ? `?${queryString}` : ""
        return `${this._sandboxOrigin}/outer-frame.html${allowParam}`
    }

    private _sendVirtualFiles(): void {
        if (!this._iframe.contentWindow) return
        if (!this._networkRules.files) return
        this._iframe.contentWindow.postMessage(
            {
                type: "SET_NETWORK_RULES",
                rules: { files: this._networkRules.files },
            },
            this._sandboxOrigin,
        )
    }

    private _updateIframeSource(): void {
        if (this._sandboxOrigin) {
            this._iframe.setAttribute(
                "sandbox",
                "allow-scripts allow-forms allow-popups allow-modals allow-same-origin",
            )
            this._iframe.src = this._calculateIframeSrc()
        }
    }

    private _onMessage(event: MessageEvent): void {
        if (!this._sandboxOrigin) return
        if (event.origin !== this._sandboxOrigin) return

        const data = event.data
        if (!data) return

        if (data === "READY") {
            this.dispatchEvent(new CustomEvent("ready"))
            // Send Virtual Files to SW after iframe is ready
            this._sendVirtualFiles()
        } else if (data.type === "LOG") {
            this.dispatchEvent(
                new CustomEvent<LogMessage>("log", { detail: data }),
            )
        } else {
            this.dispatchEvent(new CustomEvent("message", { detail: data }))
        }
    }
}

customElements.define("safe-sandbox", SafeSandbox)

export { SafeSandbox, NetworkRules, LogMessage }
