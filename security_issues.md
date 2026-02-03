# Security Considerations

This document outlines known security properties, risks, and potential mitigations for SafeSandbox.

## Security Architecture

```
Host (localhost)
    |
    +-- <safe-sandbox> Custom Element
            |
            +-- iframe[sandbox] -> sandbox.localhost (ORIGIN BOUNDARY)
                    |
                    +-- outer-frame.html (SW registration, message relay)
                    |       |
                    |       +-- Service Worker (network firewall)
                    |
                    +-- inner-frame.html (code execution)
```

## Guaranteed Isolation

| Property | Mechanism | Can Config Break It? |
|----------|-----------|---------------------|
| Host cookie access | Origin isolation | No |
| Host localStorage/sessionStorage | Origin isolation | No |
| Host DOM access | Cross-origin policy | No |
| Credentialed requests to host | CORS | No |

The subdomain boundary (`sandbox.localhost` vs `localhost`) is enforced by the browser and cannot be bypassed by any configuration.

---

## Known Risks

### 1. Infrastructure Tampering via allow-same-origin

**Issue:** The inner-frame has `sandbox="allow-scripts allow-same-origin"`. This means code running in inner-frame can access outer-frame:

```javascript
// Malicious code in inner-frame could:
window.parent.document.body.innerHTML = "modified"
window.parent.navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()))
```

**Impact:** Code cannot escape to host, but CAN tamper with sandbox infrastructure (SW, outer-frame DOM, message handlers).

**Why allow-same-origin is required:** The SW only intercepts requests from its own origin. Without it, inner-frame gets a null origin and the network firewall is bypassed entirely.

**Potential Mitigations:**
1. **Freeze critical objects** in outer-frame before loading inner-frame
2. **Shadow DOM isolation** - encapsulate outer-frame internals
3. **Monitor SW registration** - detect/restore if unregistered
4. **Separate SW scope** - research if SW can cover different sandbox origins

---

### 2. Permissive CSP by Design

**Issue:** The sandbox CSP is intentionally permissive (`script-src *`, `style-src *`, etc.) because the SW is the network security layer.

**Impact:** If the SW is tampered with or bypassed, there's no CSP fallback for network restrictions.

**Mitigations:**
- SW registration monitoring
- CSP meta tag injection for defense-in-depth (future work)

---

### 3. WebSocket Bypass

**Issue:** Service Workers cannot intercept WebSocket handshakes. If a domain is in the allow list, WebSocket connections go through without SW control.

**Impact:** Limited network monitoring for WS connections.

**Mitigations:**
- Block WS via CSP `connect-src` if needed
- Document this limitation for users

---

## Security Checklist for Users

- [ ] Use HTTPS in production (`allowProtocols: ["https"]`)
- [ ] Minimize allow list to only required domains
- [ ] Set `maxContentLength` to prevent large payload attacks
- [ ] Restrict HTTP methods if possible (`allowMethods: ["GET"]`)
- [ ] Consider `execution.popups: false` to prevent popup-based attacks

---

## Future Hardening

- [ ] Freeze outer-frame globals before loading inner-frame
- [ ] CSP meta tag injection for defense-in-depth
- [ ] SW health monitoring and auto-recovery
- [ ] Investigate Realms API when browser support improves
