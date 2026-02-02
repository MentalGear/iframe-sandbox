/**
 * Shared Type Definitions for SafeSandbox
 */

export interface NetworkRules {
    allow?: string[]
    proxyUrl?: string // e.g., '/_proxy' or 'https://proxy.example.com'
    files?: Record<string, string>
    cacheStrategy?: "network-first" | "cache-first" | "network-only"
}

export interface LogMessage {
    type: "LOG"
    timestamp: number
    source: "outer" | "inner"
    level: "log" | "warn" | "error"
    area?: "network" | "security" | "user-code"
    message: string
    data?: Record<string, unknown>
}
