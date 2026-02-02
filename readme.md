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
      useProxy: false,
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
    +-- ipc.ts               # Messaging utilities
```

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
  allow?: string[]              // Allowed domains (default: [])
  useProxy?: boolean            // Use CORS proxy (default: false)
  files?: Record<string, string> // Virtual files (default: {})
  cacheStrategy?: 'network-first' | 'cache-first' | 'network-only'
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

- [ ] **captureContentDebug**: When enabled, inject telemetry into `loadSrc()` content to capture console.log/error and thrown exceptions from external URLs
- [ ] **WebSocket Support**: Intercept and filter WS connections
- [ ] **Security Audits**: Automated CSP validation on startup
- [ ] **MessageChannel IPC**: Replace postMessage wildcards with secure port transfer

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

```bash
bun server.ts
# Open http://localhost:3333
```