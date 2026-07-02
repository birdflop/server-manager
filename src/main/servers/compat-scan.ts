import type { CompatIssue } from '@shared/types'

/**
 * Log scanning for compatibility runs: given a server's startup output, find the
 * lines that indicate a plugin/mod failed to load, and grade smoke-command output.
 * Pure string logic so it's unit-testable without a live server.
 */

const MAX_ISSUES = 25
const MAX_LINE_LEN = 400
const SMOKE_EXCERPT_LINES = 12
const SMOKE_EXCERPT_LEN = 700

/** Remove ANSI color codes (the console buffer is colorized before we see it). */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Known fatal load/enable failures across the supported platforms.
 * Bukkit/Paper family, then Fabric/Quilt, then Forge/NeoForge, then generic fatals.
 */
const ERROR_PATTERNS: RegExp[] = [
  /Could not load '/, // Bukkit: plugin jar rejected
  /Error occurred while enabling /, // Bukkit: onEnable threw
  /Unsupported API version/, // Bukkit: api-version newer than the server
  /Ambiguous plugin name/,
  /Incompatible mods? (?:found|set)/i, // Fabric loader
  /Mod resolution failed/i, // Fabric loader
  /Missing or unsupported mandatory dependencies/i, // Forge
  /Mod loading (?:has )?failed/i, // Forge/NeoForge
  /Fatal errors were detected during the transition/i, // Forge
  /Failed to start the minecraft server/i,
  /Encountered an unexpected exception/i // vanilla fatal crash
]

/** Suspicious-but-not-always-fatal lines worth surfacing in the report. */
const WARN_PATTERNS: RegExp[] = [
  /\bERROR\]/, // any log4j ERROR line not matched above
  /\[SEVERE\]/, // legacy Bukkit log level
  /^\s*Caused by: /,
  /\w(?:Exception|Error)(?::\s|$)/ // exception headline lines (stack frames excluded below)
]

/** Markers that a smoke command didn't work (unknown command = plugin never registered it). */
const SMOKE_FAIL_PATTERNS: RegExp[] = [
  /Unknown command/i, // Bukkit family
  /Unknown or incomplete command/i, // Brigadier (vanilla 1.13+)
  /Incorrect argument for command/i,
  /An unexpected error occurred trying to execute that command/i,
  /\bERROR\]/,
  /\w(?:Exception|Error)(?::\s|$)/
]

/** True for stack-trace body lines — we keep the headline, not every frame. */
function isStackFrame(line: string): boolean {
  return /^\s+at\s/.test(line) || /^\s*\.\.\.\s\d+\smore/.test(line)
}

/** Scan a server's startup output for load failures + suspicious lines. */
export function scanStartupIssues(raw: string): CompatIssue[] {
  const issues: CompatIssue[] = []
  const seen = new Set<string>()
  for (const rawLine of stripAnsi(raw).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || isStackFrame(rawLine)) continue
    let severity: CompatIssue['severity'] | null = null
    if (ERROR_PATTERNS.some((p) => p.test(line))) severity = 'error'
    else if (WARN_PATTERNS.some((p) => p.test(line))) severity = 'warn'
    if (!severity) continue
    const trimmed = line.slice(0, MAX_LINE_LEN)
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    issues.push({ severity, line: trimmed })
    if (issues.length >= MAX_ISSUES) break
  }
  return issues
}

/** Grade the console output captured after a smoke command was sent. */
export function evaluateSmoke(raw: string): { ok: boolean; excerpt: string } {
  const clean = stripAnsi(raw)
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const ok = !lines.some((l) => SMOKE_FAIL_PATTERNS.some((p) => p.test(l)))
  const excerpt = lines.slice(0, SMOKE_EXCERPT_LINES).join('\n').slice(0, SMOKE_EXCERPT_LEN)
  return { ok, excerpt }
}
