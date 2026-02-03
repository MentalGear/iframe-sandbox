# SafeSandbox Library

A secure JavaScript sandbox Custom Element featuring subdomain isolation, network virtualization, and transparent CORS handling.

## Features

- **`<safe-sandbox>` Custom Element**: Easy integration with automatic setup
- **Subdomain Isolation**: Strict origin separation between Host and Sandbox
- **Network Firewall**: Allowlist-based request filtering via Service Worker
- **CORS Proxy**: Optional server-side proxy for non-CORS APIs
- **Virtual Files**: In-memory file injection without disk writes

## Quick Start

```html
<safe-sandbox id="sandbox"></safe-sandbox>

<script type="module" src="/lib/SafeSandbox.ts"></script>
<script>
  const sandbox = document.getElementById('sandbox');
  
  sandbox.addEventListener('ready', () => {
    sandbox.setNetworkRules({
      allow: ['api.example.com'],
      files: { '/config.json': '{"key": "value"}' }
    });
    
    sandbox.execute('fetch("/config.json").then(r => r.json()).then(console.log)');
  });
  
  sandbox.addEventListener('log', (e) => console.log(e.detail));
</script>
```

## Architecture

```
Host (localhost:3333)
    |
    +-- playground/          # Demo UI
    +-- lib/SafeSandbox.ts   # Custom Element
    |
Sandbox (sandbox.localhost:3333)
    |
    +-- outer-frame.html     # SW registration, message relay
    +-- inner-frame.html     # Code execution
    +-- outer-sw.ts          # Network firewall
```

## Two-Layer Firewall

SafeSandbox uses two independent security layers:

```
┌─────────────────────────────────────────────────────┐
│ Network Firewall (Service Worker)                   │
│ Controls: domains, protocols, methods, size, rate   │
└─────────────────────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────┐
│ Execution Firewall (iframe sandbox attribute)       │
│ Controls: scripts, forms, popups, modals, downloads │
└─────────────────────────────────────────────────────┘
```

| Layer | Mechanism | What It Controls |
|-------|-----------|------------------|
| **Network** | Service Worker | What URLs can be fetched, HTTP methods, response size |
| **Execution** | iframe sandbox attr | What capabilities the sandboxed code has |

See [security_issues.md](security_issues.md) for known risks and mitigations.

## How It Works

```
Host Page
    |
    +-- <safe-sandbox> (Custom Element)
            |
            +-- iframe[sandbox] -> outer-frame.html (sandbox.localhost)
                    |
                    +-- Registers Service Worker (outer-sw.ts)
                    +-- iframe[sandbox] -> inner-frame.html
                            |
                            +-- User code runs here (eval)
                            +-- All fetch() intercepted by SW
```

**Double iframe design:**
1. **Outer frame** (`outer-frame.html`): Registers the Service Worker (SW) and relays messages between host and inner frame.
2. **Inner frame** (`inner-frame.html`): Executes user code via `eval()`. Console is proxied to send logs to parent. Has dynamic sandbox attributes based on execution config.

**Why this works:**
- The subdomain (`sandbox.localhost`) provides full origin isolation - no access to host cookies, storage, or DOM
- The Service Worker (SW) intercepts all network requests, enforcing the allowlist
- Permissive CSP lets the SW make any request, then SW decides what's actually allowed
- Messages flow: Host <-> Outer Frame <-> Inner Frame, with strict origin checks


## API

### Attributes

| Attribute | Description |
|-----------|-------------|
| `sandbox-origin` | Sandbox subdomain URL (auto-derived if omitted) |
| `src` | User content URL to sandbox (future) |

### Methods

```ts
sandbox.execute(code: string)     // Run JS in sandbox
sandbox.loadSrc(url: string)      // Load URL in sandbox (future)
sandbox.setNetworkRules(rules)    // Set network rules
```

### Events

| Event | Detail |
|-------|--------|
| `ready` | Sandbox initialized |
| `log` | LogMessage from sandbox |

### NetworkRules

```ts
interface NetworkRules {
  // Network Firewall (Service Worker)
  allow?: string[]              // Allowed domains (default: [])
  allowProtocols?: ('http' | 'https')[]  // Allowed protocols (default: both)
  allowMethods?: string[]       // Allowed HTTP methods (default: all)
  maxContentLength?: number     // Max response size in bytes
  proxyUrl?: string             // CORS proxy URL (e.g., '/_proxy'), url of a server that changes CORS headers of a request and passes them to the sandbox. Important: you should be in control of this.
  files?: Record<string, string> // Virtual files (default: {})
  cacheStrategy?: 'network-first' | 'cache-first' | 'network-only'
  
  // Execution Firewall (iframe sandbox attribute)
  execution?: {
    scripts?: boolean      // allow-scripts (default: true)
    formSending?: boolean  // allow-forms (default: true)
    popups?: boolean       // allow-popups (default: false)
    modals?: boolean       // allow-modals (default: true)
    downloads?: boolean    // allow-downloads (default: false)
  }
}
```

### LogMessage

```ts
interface LogMessage {
  type: 'LOG'
  timestamp: number
  source: 'outer' | 'inner'
  level: 'log' | 'warn' | 'error'
  area?: 'network' | 'security' | 'user-code'
  message: string
  data?: Record<string, unknown>
}
```

## Configuration

Set via environment variables:

```bash
PORT=3333 HOST=localhost bun server.ts
```

## Security Model

1. **Origin Isolation**: Sandbox on dedicated subdomain, no shared cookies/storage
2. **Network Firewall**: All external requests blocked unless in allowlist
3. **CSP Hardening**: Strict policies per origin

## Future Work
- is the sandbox server safe from request of other origins? eg can other origins/website use our sandbox subdomain for their own CSP or does it block all request from other sources ?
- [ ] **WebSocket Support**: Intercept and filter WS connections
> WebSocket (ws:, wss:) falls under connect-src in CSP. Looking at the current sandbox CSP in server.ts
connect-src *
It already allows all connections, including WebSockets. The SW firewall is what gates WebSocket connections - the SW intercepts fetch requests but cannot intercept WebSocket connections directly.
Important caveat: Service Workers cannot intercept WebSocket handshakes. So if you allow a domain in the SW's allow list, and the CSP permits it (connect-src *), WebSocket connections to that domain will go through without SW control.


- new JS REALMS API: browser support. to run without iframe
- [] MessageChannel: allow only passing primitives and callables. This prevents "prototype pollution" attacks from leaking out by preventing all complex objects from passing the messageChannel
- [ ] **MessageChannel IPC**: Replace postMessage wildcards with secure port transfer
- [ ] **Security Audits**: Automated CSP validation on startup
- [ ] **captureContentDebug**: When enabled, inject telemetry into `loadSrc()` content to capture console.log/error and thrown exceptions from external URLs
- [ ] **CSP-based Execution Control**: For finer control like blocking `eval()` while allowing scripts, or blocking inline scripts while allowing external - implement via meta tag injection in SW. Current execution firewall uses iframe sandbox attributes which are coarse-grained.
- [ ] add quickjs sandbox: https://sebastianwessel.github.io/quickjs/use-cases/ai-generated-code.html


## Service Worker Caching

Set via `cacheStrategy` in NetworkRules or URL param `outer-sw.js?strategy=<value>`:

| Strategy | Behavior |
|----------|----------|
| `network-first` | Try network, fallback to cache (default) |
| `cache-first` | Use cache if available, else network |
| `network-only` | Always fetch, no caching |

> [!WARNING]
> `cache-first` may serve stale content. Use `network-first` (default) for development. And/or clear your page data: Dev Tools > Application > Clear Data.

## Testing

E2E tests use **Playwright**. Run them using the script defined in `package.json`:

```bash
# Run all tests (Playwright)
bun run test

# Or run directly via playwright
bunx playwright test
```

> [!NOTE]
> Do not use `bun test` directly, as it attempts to run tests with the Bun unit test runner, which is incompatible with `@playwright/test` structures.

## Playground

```bash
bun server.ts
# Open http://localhost:3333
```