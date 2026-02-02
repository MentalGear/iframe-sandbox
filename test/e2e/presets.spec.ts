import { test, expect, Page } from "@playwright/test"

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

        await setupSandbox(page, {
            allow: ["jsonplaceholder.typicode.com"],
            proxyUrl: undefined,
            files: {},
        })

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
            allow: ["www.google.com"],
            proxyUrl: undefined,
            files: {},
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

        await setupSandbox(page, {
            allow: ["www.google.com"],
            proxyUrl: "/_proxy",
            files: {},
        })

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

        await setupSandbox(page, {
            allow: [],
            proxyUrl: undefined,
            files: {},
        })

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

        await setupSandbox(page, {
            allow: [],
            proxyUrl: undefined,
            files: { "/virtual.txt": virtualContent },
        })

        await executeAndWaitForLog(
            page,
            `fetch("/virtual.txt").then(r => r.text()).then(t => console.log("Content:", t));`,
            /Virtual.*virtual\.txt/,
        )

        // Should see the content logged
        await expect(page.locator("#logs")).toContainText(virtualContent)
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

        await setupSandbox(page, {
            allow: ["jsonplaceholder.typicode.com"],
            proxyUrl: undefined,
            files: {},
        })

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
