import { test, expect } from "@playwright/test"

test.describe("Security Heartbeat", () => {
    test.skip("sandbox resets when Service Worker is unregistered", async ({
        page,
    }) => {
        // 1. Load Sandbox
        await page.goto("/")
        const status = page.locator("#sandbox-status")
        const logs = page.locator("#logs")

        await expect(status).toBeVisible()
        await expect(status).toContainText("Ready", { timeout: 10000 })

        // Wait for Heartbeat to establish (SW logs "Secure Heartbeat Established")
        // Note: console logs from host are not in #logs usually, but let's check #logs if SW sends PONG info?
        // Actually, SafeSandbox logs PING failure to console.warn.
        // We'll rely on the reset behavior: iframe reloading.

        // 2. Perform ATTACK: Unregister SW from inner frame
        await page.click('button:has-text("Clear Logs")')
        await page.locator("#code").fill(`
            navigator.serviceWorker.getRegistrations().then(regs => {
                if (regs.length > 0) {
                    regs[0].unregister().then(success => {
                        console.log("ATTACK: SW Unregistered: " + success);
                    });
                } else {
                    console.log("ATTACK: No SW found to unregister");
                }
            });
        `)
        await page.click('button:has-text("Run Code")')

        await expect(logs).toContainText("ATTACK: SW Unregistered: true", {
            timeout: 5000,
        })

        // 3. Wait for Reset (Kill Switch)
        // The heartbeat is 1s. 3 misses = 3s. Reset takes ~100ms.
        // Recovery means SW registers again.

        // We expect "Ready" to flicker or SW: active to reappear in logs after being cleared.
        // Since logs are cleared on reset (iframe reload), we should check that
        // the sandbox returns to state "Ready" AND we see a new "SW: registering..." sequence.

        // BUT: #logs is outside the iframe?
        // The logs div is in the Host (index.html).
        // The reset destroys the iframe. Does it clear logs? No.
        // But the NEW iframe will send "SW: registering..."

        await expect(logs).toContainText("SW: registering...", {
            timeout: 10000,
        })
        await expect(logs).toContainText("SW: active", { timeout: 10000 })

        // 4. Verify console warning about reset (Playwright captures console)
        const messages: string[] = []
        page.on("console", (msg) => messages.push(msg.text()))

        // Wait a bit more to ensure we captured the reset warning
        await page.waitForTimeout(4000)

        const resetWarning = messages.find((m) =>
            m.includes("Resetting sandbox due to security/health failure"),
        )
        if (!resetWarning) {
            console.log("Console messages:", messages.join("\n"))
        }
        expect(resetWarning).toBeTruthy()
    })
})
