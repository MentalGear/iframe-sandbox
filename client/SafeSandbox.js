/**
 * SafeSandbox Custom Element
 * A secure, isolated JavaScript sandbox using iFrame subdomains and Service Workers.
 */
class SafeSandbox extends HTMLElement {
    static get observedAttributes() {
        return ["src"]
    }

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        this._iframe = document.createElement("iframe")
        this._iframe.style.width = "100%"
        this._iframe.style.height = "100%"
        this._iframe.style.border = "none"
        this.shadowRoot.appendChild(this._iframe)

        this._onMessage = this._onMessage.bind(this)
        this._networkRules = { allow: [], files: {} }
    }

    connectedCallback() {
        window.addEventListener("message", this._onMessage)
        this._updateIframeSource()
    }

    disconnectedCallback() {
        window.removeEventListener("message", this._onMessage)
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "src" && oldValue !== newValue) {
            this._updateIframeSource()
        }
    }

    /**
     * Executes JavaScript code within the sandbox.
     * @param {string} code
     */
    execute(code) {
        if (!this._iframe.contentWindow) return
        const targetOrigin = new URL(this.getAttribute("src")).origin
        this._iframe.contentWindow.postMessage(
            { type: "EXECUTE", code },
            targetOrigin,
        )
    }

    /**
     * Sets network rules for the sandbox Service Worker.
     * @param {Object} rules { files: {}, blocks: [], allow: [] }
     */
    setNetworkRules(rules) {
        this._networkRules = rules
        this._sendNetworkRules()
    }

    _sendNetworkRules() {
        if (!this._iframe.contentWindow) return
        try {
            const src = this.getAttribute("src")
            if (!src) return
            const targetOrigin = new URL(src).origin
            this._iframe.contentWindow.postMessage(
                { type: "SET_NETWORK_RULES", rules: this._networkRules },
                targetOrigin,
            )
        } catch (e) {
            console.error("Failed to send network rules:", e)
        }
    }

    _updateIframeSource() {
        const src = this.getAttribute("src")
        if (src) {
            this._iframe.src = src
        }
    }

    _onMessage(event) {
        const src = this.getAttribute("src")
        if (!src) return

        const expectedOrigin = new URL(src).origin
        if (event.origin !== expectedOrigin) return

        const data = event.data
        if (!data) return

        // Dispatch as custom events
        if (data.type === "LOG") {
            this.dispatchEvent(new CustomEvent("log", { detail: data }))
        } else if (data === "READY") {
            this.dispatchEvent(new CustomEvent("ready"))
            this._sendNetworkRules() // Re-apply rules on every ready event
        } else {
            this.dispatchEvent(new CustomEvent("message", { detail: data }))
        }
    }
}

customElements.define("safe-sandbox", SafeSandbox)
