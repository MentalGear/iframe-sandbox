import { test, expect, Page } from "@playwright/test"
import { PRESETS } from "../../src/lib/presets"

/**
 * Helper: Wait for sandbox to be ready and set network rules
 */
async function setupSandbox(page: Page, rules: object) {
    // Wait for sandbox ready indicator
    await expect(page.locator("#sandbox-status")).toContainText("Ready", {
        timeout: 10000,
    })

    // Set rules in the JSON editor
    const rulesEditor = page.locator("#rulesEditor")
    await rulesEditor.fill(JSON.stringify(rules, null, 2))

    // Wait for debounced rule application
    await page.waitForTimeout(600)
}

/**
 * Helper: Execute code in sandbox and wait for logs
 */
async function executeAndWaitForLog(
    page: Page,
    code: string,
    expectedLogPattern: RegExp,
    timeout = 5000,
) {
    const logsDiv = page.locator("#logs")

    // Clear existing logs
    await page.click('button:has-text("Clear Logs")')

    // Set code
    await page.locator("#code").fill(code)

    // Run
    await page.click('button:has-text("Run Code")')

    // Wait for expected log
    await expect(logsDiv).toContainText(expectedLogPattern, { timeout })
}

// ============================================================================
// Test: JSONPlaceholder (CORS Allowed, Direct Fetch)
// ============================================================================
test.describe("JSONPlaceholder Preset", () => {
    test("direct fetch succeeds without proxy", async ({ page }) => {
        await page.goto("/")

        await setupSandbox(page, PRESETS.jsonplaceholder.rules)

        await executeAndWaitForLog(
            page,
            `fetch("https://jsonplaceholder.typicode.com/todos/1");`,
            /Fetch.*jsonplaceholder/,
        )

        // Should see 200 status
        await expect(page.locator("#logs")).toContainText(/200/)
    })
})

// ============================================================================
// Test: Google (CORS Blocked without Proxy, Works with Proxy)
// ============================================================================
test.describe("Google Preset", () => {
    test("fetch fails without proxy (CORS error)", async ({ page }) => {
        await page.goto("/")

        await setupSandbox(page, {
            ...PRESETS.google.rules,
            proxyUrl: undefined,
        })

        await executeAndWaitForLog(
            page,
            `fetch("https://www.google.com");`,
            /Fetch.*google/,
        )

        // Should see error (502 or CORS failure)
        await expect(page.locator("#logs")).toContainText(
            /502|CORS|error|proxyUrl/i,
        )
    })

    test("fetch succeeds with proxy enabled", async ({ page }) => {
        await page.goto("/")

        await setupSandbox(page, PRESETS.google.rules)

        await executeAndWaitForLog(
            page,
            `fetch("https://www.google.com");`,
            /Proxy.*google/,
        )

        // Should see 200 status via proxy
        await expect(page.locator("#logs")).toContainText(/200/)
    })
})

// ============================================================================
// Test: Block All
// ============================================================================
test.describe("Block All Preset", () => {
    test("all external requests return 403", async ({ page }) => {
        await page.goto("/")

        await setupSandbox(page, PRESETS.blocked.rules)

        await executeAndWaitForLog(
            page,
            `fetch("https://example.com");`,
            /Blocked.*example\.com/,
        )
    })
})

// ============================================================================
// Test: Virtual Files
// ============================================================================
test.describe("Virtual Files", () => {
    test("virtual file is served from memory", async ({ page }) => {
        await page.goto("/")

        const virtualContent = "Hello from virtual file!"

        await setupSandbox(page, PRESETS.virtualfiles.rules)

        await executeAndWaitForLog(
            page,
            PRESETS.virtualfiles.code,
            /Config:.*1.0/,
        )
        await expect(page.locator("#logs")).toContainText(/Data:.*Hello World/)
    })
})

// ============================================================================
// Test: Code Execution
// ============================================================================
test.describe("Code Execution", () => {
    test("execute() runs code and logs appear in host", async ({ page }) => {
        await page.goto("/")

        await expect(page.locator("#sandbox-status")).toContainText("Ready", {
            timeout: 10000,
        })

        await page.click('button:has-text("Clear Logs")')

        // Set simple code that logs a unique message
        const uniqueMessage = `test-${Date.now()}`
        await page.locator("#code").fill(`console.log("${uniqueMessage}");`)

        await page.click('button:has-text("Run Code")')

        // Verify the log appears in host
        await expect(page.locator("#logs")).toContainText(uniqueMessage, {
            timeout: 5000,
        })
    })
})

// ============================================================================
// Test: Log Message Schema
// ============================================================================
test.describe("Log Message Schema", () => {
    test("logs show source and area tags", async ({ page }) => {
        await page.goto("/")

        await setupSandbox(page, PRESETS.jsonplaceholder.rules)

        await executeAndWaitForLog(
            page,
            `fetch("https://jsonplaceholder.typicode.com/todos/1");`,
            /\[outer:network\]/,
        )
    })

    test("user code logs show inner source", async ({ page }) => {
        await page.goto("/")

        await expect(page.locator("#sandbox-status")).toContainText("Ready", {
            timeout: 10000,
        })

        await page.click('button:has-text("Clear Logs")')
        await page.locator("#code").fill(`console.log("user log test");`)
        await page.click('button:has-text("Run Code")')

        // Should show inner source with user-code area
        await expect(page.locator("#logs")).toContainText(
            /\[inner.*\].*user log test/,
            {
                timeout: 5000,
            },
        )
    })
})

// ============================================================================
// Test: Security Isolation
// ============================================================================
test.describe("Security Isolation", () => {
    test("alert() is blocked", async ({ page }) => {
        await page.goto("/")

        await expect(page.locator("#sandbox-status")).toContainText("Ready", {
            timeout: 10000,
        })

        // Set up dialog handler - should NOT be called
        let dialogAppeared = false
        page.on("dialog", async (dialog) => {
            dialogAppeared = true
            await dialog.dismiss()
        })

        await page.click('button:has-text("Clear Logs")')
        await page.locator("#code").fill(`
            alert("Test alert");
            console.log("PASS: alert called without error");
        `)
        await page.click('button:has-text("Run Code")')

        // Wait for log
        await expect(page.locator("#logs")).toContainText(
            /PASS.*alert called/,
            {
                timeout: 5000,
            },
        )

        // Verify no dialog appeared
        expect(dialogAppeared).toBe(false)
    })

    test("window.top is inaccessible", async ({ page }) => {
        await page.goto("/")

        await expect(page.locator("#sandbox-status")).toContainText("Ready", {
            timeout: 10000,
        })

        await page.click('button:has-text("Clear Logs")')
        await page.locator("#code").fill(`
            try {
                const top = window.top.location.href;
                console.log("FAIL: window.top accessible");
            } catch (e) {
                console.log("PASS: window.top blocked");
            }
        `)
        await page.click('button:has-text("Run Code")')

        await expect(page.locator("#logs")).toContainText(
            /PASS.*window\.top blocked/,
            {
                timeout: 5000,
            },
        )
    })

    test("cookies are isolated from host", async ({ page }) => {
        await page.goto("/")

        // Set a cookie on the host
        await page.context().addCookies([
            {
                name: "host_cookie",
                value: "host_value",
                domain: "localhost",
                path: "/",
            },
        ])

        await expect(page.locator("#sandbox-status")).toContainText("Ready", {
            timeout: 10000,
        })

        await page.click('button:has-text("Clear Logs")')
        await page.locator("#code").fill(`
            // Try to set sandbox cookie
            document.cookie = "sandbox_test=123; SameSite=Lax";
            
            // Host cookie isolation check
            const hasHost = document.cookie.includes("host_cookie");
            console.log(hasHost ? "FAIL: Host cookie visible" : "PASS: Host cookie isolated");
            
            // Log local state
            console.log("Sandbox cookie set:", document.cookie.includes("sandbox_test") ? "YES" : "NO");
            console.log("Raw cookie jar:", document.cookie || "(empty)");
        `)
        await page.click('button:has-text("Run Code")')

        await expect(page.locator("#logs")).toContainText(
            /PASS: Host cookie isolated/,
            {
                timeout: 5000,
            },
        )

        // Ensure host cookie is NOT there
        await expect(page.locator("#logs")).not.toContainText(
            /FAIL: Host cookie visible/,
        )
    })

    test("cannot escape to host via outer-frame script injection", async ({
        page,
    }) => {
        await page.goto("/")

        await expect(page.locator("#sandbox-status")).toContainText("Ready", {
            timeout: 10000,
        })

        await page.click('button:has-text("Clear Logs")')
        await page.locator("#code").fill(`
            // Test 1: Try to access outer-frame (should work - same sandbox origin)
            try {
                const outerDoc = window.parent.document;
                console.log("Outer-frame access: " + (outerDoc ? "YES" : "NO"));
            } catch (e) {
                console.log("Outer-frame access: BLOCKED - " + e.message);
            }

            // Test 2: Try to access window.top.document (should fail - cross-origin)
            try {
                const topDoc = window.top.document;
                const topTitle = topDoc.title;
                console.error("FAIL: HOST ESCAPE - accessed window.top.document: " + topTitle);
            } catch (e) {
                console.log("PASS: window.top.document blocked - " + e.name);
            }

            // Test 3: Inject script into outer-frame, try to access host from there
            try {
                const script = window.parent.document.createElement('script');
                script.textContent = \`
                    try {
                        const hostDoc = window.top.document;
                        window.parent.postMessage({type:'LOG', source:'outer', level:'error', area:'security', 
                            message:'FAIL: HOST ESCAPE from injected script'}, '*');
                    } catch (e) {
                        window.parent.postMessage({type:'LOG', source:'outer', level:'log', area:'security',
                            message:'PASS: Injected script blocked from host - ' + e.name}, '*');
                    }
                \`;
                window.parent.document.body.appendChild(script);
            } catch (e) {
                console.log("Script injection failed: " + e.message);
            }
        `)
        await page.click('button:has-text("Run Code")')

        // Wait for logs
        await page.waitForTimeout(1000)

        // Verify outer-frame is accessible (same origin)
        await expect(page.locator("#logs")).toContainText(
            /Outer-frame access: YES/,
        )

        // Verify host is NOT accessible
        await expect(page.locator("#logs")).toContainText(
            /PASS: window\.top\.document blocked/,
        )

        // Verify injected script also cannot access host
        await expect(page.locator("#logs")).toContainText(
            /PASS: Injected script blocked from host/,
        )

        // Ensure no escape happened
        await expect(page.locator("#logs")).not.toContainText(/HOST ESCAPE/)
    })

    test("no infrastructure functions exposed on window.parent", async ({
        page,
    }) => {
        await page.goto("/")

        await expect(page.locator("#sandbox-status")).toContainText("Ready", {
            timeout: 10000,
        })

        await page.click('button:has-text("Clear Logs")')
        await page.locator("#code").fill(`
            // Check for exposed infrastructure elements
            const exposedItems = [];
            
            // Check for known critical functions/variables that should NOT be exposed
            const forbidden = [
                'updateSandboxAttributes',
                'sendStatus', 
                'checkState',
                'statusEl',
                'HOST_ORIGIN',
                'innerFrame'
            ];
            
            for (const name of forbidden) {
                if (typeof window.parent[name] !== 'undefined') {
                    exposedItems.push(name);
                }
            }
            
            // Also check via window.top[0] path
            try {
                if (typeof window.top[0]?.updateSandboxAttributes === 'function') {
                    exposedItems.push('window.top[0].updateSandboxAttributes');
                }
            } catch (e) {
                // Cross-origin blocked - good
            }
            
            if (exposedItems.length > 0) {
                console.error("FAIL: Exposed items: " + exposedItems.join(", "));
            } else {
                console.log("PASS: No infrastructure exposed on window.parent");
            }
        `)
        await page.click('button:has-text("Run Code")')

        await expect(page.locator("#logs")).toContainText(
            /PASS: No infrastructure exposed/,
            { timeout: 5000 },
        )

        await expect(page.locator("#logs")).not.toContainText(
            /FAIL: Exposed items/,
        )
    })

    test("iframe injection to external origin is blocked", async ({ page }) => {
        await page.goto("/")

        await expect(page.locator("#sandbox-status")).toContainText("Ready", {
            timeout: 10000,
        })

        await page.click('button:has-text("Clear Logs")')
        await page.locator("#code").fill(`
            // Try to create an iframe pointing to external origin
            const iframe = document.createElement('iframe');
            iframe.src = 'https://example.com';
            iframe.id = 'injected-iframe';
            document.body.appendChild(iframe);
            
            // Wait for iframe to attempt load, then check if we can access it
            setTimeout(() => {
                const injected = document.getElementById('injected-iframe');
                try {
                    // Try to access the iframe's document
                    // If CSP blocked it or it's cross-origin, this will throw
                    const doc = injected.contentDocument;
                    const body = doc?.body?.innerHTML;
                    if (body && body.length > 0) {
                        console.error("FAIL: Could read iframe content");
                    } else {
                        console.log("PASS: Iframe content not accessible");
                    }
                } catch (e) {
                    // SecurityError means cross-origin/blocked - this is expected
                    console.log("PASS: Iframe access blocked - " + e.name);
                }
            }, 2000);
        `)
        await page.click('button:has-text("Run Code")')

        // Wait for the timeout in the code
        await page.waitForTimeout(3000)

        // Should see blocked/inaccessible message
        await expect(page.locator("#logs")).toContainText(
            /PASS:.*blocked|not accessible/i,
            { timeout: 5000 },
        )

        // Should NOT be able to read content
        await expect(page.locator("#logs")).not.toContainText(
            /FAIL: Could read iframe content/,
        )
    })

    test("Defense Trio hardening checks", async ({ page }) => {
        await page.goto("/")
        await expect(page.locator("#sandbox-status")).toContainText("Ready")

        await page.click('button:has-text("Clear Logs")')
        await page.locator("#code").fill(`
            // 1. Try to unregister SW via window.parent
            if (window.parent.navigator.serviceWorker) {
               window.parent.navigator.serviceWorker.getRegistrations()
               .then(regs => {
                    if(regs.length === 0) console.log("FAIL: No regs found");
                    regs.forEach(r => {
                        r.unregister()
                        .then(() => console.log("FAIL: Unregister succeeded"))
                        .catch(e => console.log("PASS: Unregister blocked (" + e.message + ")"));
                    });
               });
            } else {
                console.log("FAIL: parent.navigator.serviceWorker not found");
            }

            // 2. Try to register new SW
            window.parent.navigator.serviceWorker.register('/fake-sw.js')
            .then(() => console.log("FAIL: Register succeeded"))
            .catch(e => console.log("PASS: Register blocked (" + e.message + ")"));

            // 3. Try to spawn iframe in outer-frame
            try {
               const f = window.parent.document.createElement('iframe');
               f.src = 'about:blank';
               window.parent.document.body.appendChild(f);
               
               setTimeout(() => {
                   if (window.parent.document.body.contains(f)) {
                       console.log("FAIL: Iframe persists in outer frame");
                   } else {
                       console.log("PASS: Iframe removed/blocked from outer frame");
                   }
               }, 500);
            } catch(e) {
               console.log("PASS: Iframe creation blocked (" + e.message + ")");
            }
        `)
        await page.click('button:has-text("Run Code")')

        // Wait for results
        await page.waitForTimeout(1000)

        // Check 1: SW Unregister
        await expect(page.locator("#logs")).toContainText(
            /PASS: Unregister blocked/,
        )

        // Check 2: SW Register
        await expect(page.locator("#logs")).toContainText(
            /PASS: Register.*blocked/,
        )

        // Check 3: Iframe Blocking
        await expect(page.locator("#logs")).toContainText(
            /PASS: Iframe.*blocked/,
        )
    })
})
