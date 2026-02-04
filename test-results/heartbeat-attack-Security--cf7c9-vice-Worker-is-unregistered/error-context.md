# Page snapshot

```yaml
- generic [ref=e1]:
  - heading "SafeSandbox Playground" [level=1] [ref=e2]
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]: "Playground Preset:"
      - combobox [ref=e6]:
        - option "-- Select preset --"
        - option "JSONPlaceholder (CORS OK)"
        - option "Google (CORS Proxy)"
        - option "Block All"
        - option "Virtual Files"
        - option "Cache Strategy"
        - option "Security Isolation"
        - option "External HTML (MDN)"
        - option "Local HTML Page"
        - option "Origin Escape Test"
        - option "Infrastructure Exposure Test"
        - option "Iframe Injection Security Test"
        - option "Custom Preset (auto-saves)" [selected]
    - generic [ref=e8]: "Sandbox: Ready"
  - generic [ref=e9]:
    - generic [ref=e10]:
      - generic [ref=e11]: "Untrusted Source Code:"
      - textbox [ref=e12]: "navigator.serviceWorker.getRegistrations().then(regs => { if (regs.length > 0) { regs[0].unregister().then(success => { console.log(\"ATTACK: SW Unregistered: \" + success); }); } else { console.log(\"ATTACK: No SW found to unregister\"); } });"
      - generic [ref=e14]: "Network Rules (JSON):"
      - textbox [ref=e15]: "{ \"allow\": [\"jsonplaceholder.typicode.com\"] }"
      - generic [ref=e16]:
        - button "Run Code" [active] [ref=e17] [cursor=pointer]
        - 'button "Proxy: OFF" [ref=e18] [cursor=pointer]'
        - button "Clear Logs" [ref=e19] [cursor=pointer]
        - button "Hard Reset" [ref=e20] [cursor=pointer]
    - generic [ref=e21]:
      - generic [ref=e22]: "Sandbox View (Strict Subdomain):"
      - iframe [ref=e24]:
        - iframe [ref=f1e2]:
          
  - heading "Host Message Logs" [level=3] [ref=e26]
  - generic [ref=e27]:
    - generic [ref=e28]: "[outer:system] Network rules applied."
    - generic [ref=e29]: "[playground] Sandbox is ready!"
    - generic [ref=e30]: "[outer:system] SW: active"
    - generic [ref=e31]: "[inner:user-code] ATTACK: SW Unregistered: true"
    - generic [ref=e32]: "[outer:system] Network rules applied."
    - generic [ref=e33]: "[playground] Executing code..."
    - generic [ref=e34]: "[playground] Network rules applied."
```