/**
 * SafeSandbox Custom Element
 * A secure, isolated JavaScript sandbox using iFrame subdomains and Service Workers.
 */

import { type NetworkRules, type LogMessage } from "./types"

class SafeSandbox extends HTMLElement {
    private _iframe: HTMLIFrameElement
    private _networkRules: NetworkRules
    private _sandboxOrigin: string

    // Heartbeat / Kill Switch
    private _heartbeatChannel: MessageChannel | null = null
    private _heartbeatIntervalId: any = null
    private _heartbeatFailures = 0
    private _isResetting = false

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
        this._stopHeartbeat()
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

    /**
     * Resets the sandbox by destroying and recreating the iframe.
     * This is the "Kill Switch" measure if SW health check fails.
     */
    reset(): void {
        if (this._isResetting) return
        this._isResetting = true
        console.warn(
            "[SafeSandbox] Resetting sandbox due to security/health failure.",
        )

        // Stop heartbeat
        this._stopHeartbeat()

        // Nuke iframe
        this._iframe.remove()

        // Recreate iframe
        this._iframe = document.createElement("iframe")
        this._iframe.style.width = "100%"
        this._iframe.style.height = "100%"
        this._iframe.style.border = "none"
        this.shadowRoot!.appendChild(this._iframe)

        // Reload
        setTimeout(() => {
            this._isResetting = false
            this._updateIframeSource()
        }, 100)
    }

    private _stopHeartbeat() {
        if (this._heartbeatIntervalId) clearInterval(this._heartbeatIntervalId)
        if (this._heartbeatChannel) {
            this._heartbeatChannel.port1.close()
            this._heartbeatChannel.port2.close()
        }
        this._heartbeatChannel = null
        this._heartbeatIntervalId = null
    }

    private _startHeartbeat() {
        this._stopHeartbeat()

        this._heartbeatChannel = new MessageChannel()
        this._heartbeatFailures = 0

        // Send Port2 to Outer Frame
        this._iframe.contentWindow?.postMessage(
            { type: "REGISTER_HEARTBEAT_PORT" },
            this._sandboxOrigin,
            [this._heartbeatChannel.port2],
        )

        // Listen on Port1
        let pendingPing = false
        this._heartbeatChannel.port1.onmessage = (e) => {
            if (e.data === "PONG") {
                pendingPing = false
                this._heartbeatFailures = 0
            } else if (e.data === "SW_HEARTBEAT_CONNECTED") {
                console.log("[SafeSandbox] Secure Heartbeat Established 🔒")
            }
        }

        // Start Loop (1s)
        this._heartbeatIntervalId = setInterval(() => {
            if (pendingPing) {
                this._heartbeatFailures++
                console.warn(
                    `[SafeSandbox] Heartbeat missed (${this._heartbeatFailures}/3)`,
                )
                if (this._heartbeatFailures >= 5) {
                    this.reset()
                    return
                }
            }

            pendingPing = true
            this._heartbeatChannel?.port1.postMessage("PING")

            // Failsafe: if 'pendingPing' is still true after 2s, we count as miss in next tick
        }, 2000)
    }

    private _onMessage(event: MessageEvent): void {
        if (!this._sandboxOrigin) return
        if (event.origin !== this._sandboxOrigin) return

        const data = event.data
        if (!data) return

        if (data === "READY") {
            this.dispatchEvent(new CustomEvent("ready"))
            this._sendNetworkRules()
            this._startHeartbeat()
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
