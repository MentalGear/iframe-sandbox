import { NetworkRules } from "./types"

export interface Preset {
    id: string
    label: string
    rules: NetworkRules
    code: string
}

export const PRESETS: Record<string, Preset> = {
    jsonplaceholder: {
        id: "jsonplaceholder",
        label: "JSONPlaceholder (CORS OK)",
        rules: { allow: ["jsonplaceholder.typicode.com"] },
        code: `// JSONPlaceholder - CORS-friendly API
console.log("Fetching from JSONPlaceholder...");
fetch("https://jsonplaceholder.typicode.com/todos/1")
  .then(r => r.json())
  .then(data => console.log("Got:", data));`,
    },
    google: {
        id: "google",
        label: "Google (CORS Proxy)",
        rules: { allow: ["www.google.com"], proxyUrl: "/_proxy" },
        code: `// Google - Needs CORS proxy
console.log("Fetching Google via proxy...");
fetch("https://www.google.com")
  .then(r => console.log("Status:", r.status));`,
    },
    blocked: {
        id: "blocked",
        label: "Block All",
        rules: { allow: [] },
        code: `// All external blocked
console.log("Attempting blocked request...");
fetch("https://example.com");`,
    },
    virtualfiles: {
        id: "virtualfiles",
        label: "Virtual Files",
        rules: {
            files: {
                "/config.json": '{"version": "1.0"}',
                "/data.txt": "Hello World",
            },
        },
        code: `// Virtual files demo
fetch("/config.json").then(r => r.json()).then(d => console.log("Config:", d));
fetch("/data.txt").then(r => r.text()).then(t => console.log("Data:", t));`,
    },
    caching: {
        id: "caching",
        label: "Cache Strategy",
        rules: {
            allow: ["jsonplaceholder.typicode.com"],
            cacheStrategy: "cache-first",
        },
        code: `// Cache-first strategy demo
console.log("First fetch (network)...");
fetch("https://jsonplaceholder.typicode.com/posts/1");
setTimeout(() => {
  console.log("Second fetch (should hit cache)...");
  fetch("https://jsonplaceholder.typicode.com/posts/1");
}, 1000);`,
    },
    security: {
        id: "security",
        label: "Security Isolation",
        rules: {},
        code: `// Security isolation tests
console.log("Testing isolation...");

// Test 1: alert() is silently blocked (no modal appears)
alert("If you see this modal, sandbox is broken!");
console.log("PASS: alert() called (check console for sandbox warning)");

// Test 2: window.top should be inaccessible
try {
  const top = window.top.location.href;
  console.error("FAIL: window.top accessible:", top);
} catch (e) {
  console.log("PASS: window.top blocked");
}

// Test 3: document.cookie should be isolated
document.cookie = "sandbox_test=123";
const cookies = document.cookie;
console.log("Sandbox cookies:", cookies);
if (cookies.includes("sandbox_test")) {
  console.log("PASS: Sandbox can set cookies");
}
console.log("Check host devtools - should NOT see 'sandbox_test' cookie");`,
    },
    htmlContent: {
        id: "htmlContent",
        label: "External HTML (MDN)",
        rules: { allow: ["developer.mozilla.org"], proxyUrl: "/_proxy" },
        code: `// Load external HTML content via proxy
const sourceUrl = "https://developer.mozilla.org/";
console.log("Fetching MDN homepage...");

fetch(sourceUrl)
  .then(r => {
    console.log("Response status:", r.status);
    return r.text();
  })
  .then(html => {
    console.log("HTML loaded, length:", html.length, "chars");
    // Inject base tag so relative paths resolve to original domain
    const baseTag = '<base href="' + sourceUrl + '">';
    const htmlWithBase = html.replace('<head>', '<head>' + baseTag);
    // Display the fetched HTML content in the sandbox
    document.open();
    document.write(htmlWithBase);
    document.close();
    console.log("HTML content rendered with base tag!");
  })
  .catch(err => console.error("Fetch failed:", err));`,
    },
    localHtml: {
        id: "localHtml",
        label: "Local HTML Page",
        rules: {
            allow: ["localhost", "picsum.photos", "fastly.picsum.photos"],
            proxyUrl: "/_proxy",
        },
        code: `// Load local test page from host origin via proxy
console.log("Loading local test page...");

// Fetch from host origin (sandbox only serves 3 infrastructure files)
const hostOrigin = window.location.origin.replace("sandbox.", "");
const pageUrl = hostOrigin + "/playground/test-assets/test-page.html";

fetch(pageUrl)
  .then(r => r.text())
  .then(html => {
    console.log("HTML loaded, rendering...");
    // Inject base tag so relative paths resolve to host origin
    const baseTag = '<base href="' + hostOrigin + '/playground/test-assets/">';
    const htmlWithBase = html.replace('<head>', '<head>' + baseTag);
    document.open();
    document.write(htmlWithBase);
    document.close();
  })
  .catch(err => console.error("Failed:", err));`,
    },
}
