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
        return ["sandbox-origin", "src"]
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
     * Sets network rules for the sandbox Service Worker.
     */
    setNetworkRules(rules: NetworkRules): void {
        this._networkRules = rules
        this._sendNetworkRules()
    }

    private _sendNetworkRules(): void {
        if (!this._iframe.contentWindow) return
        this._iframe.contentWindow.postMessage(
            { type: "SET_NETWORK_RULES", rules: this._networkRules },
            this._sandboxOrigin,
        )
    }

    private _updateIframeSource(): void {
        if (this._sandboxOrigin) {
            this._iframe.setAttribute(
                "sandbox",
                "allow-scripts allow-forms allow-popups allow-modals allow-same-origin",
            )
            this._iframe.src = `${this._sandboxOrigin}/outer-frame.html`
        }
    }

    private _onMessage(event: MessageEvent): void {
        if (!this._sandboxOrigin) return
        if (event.origin !== this._sandboxOrigin) return

        const data = event.data
        if (!data) return

        if (data === "READY") {
            this.dispatchEvent(new CustomEvent("ready"))
            this._sendNetworkRules()
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
