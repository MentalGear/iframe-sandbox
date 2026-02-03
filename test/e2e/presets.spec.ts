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
})
