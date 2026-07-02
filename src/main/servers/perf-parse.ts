/**
 * Parsers for tick-metric command output (Paper `tps`/`mspt`, spark `tps`).
 * Pure string logic, kept separate from the poller so it's unit-testable.
 */

/** Strip § color codes and ANSI escapes from command output. */
function stripCodes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/§./g, '').replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Extract the most recent TPS value from Paper's `tps` or spark's `tps` output.
 * Paper: "TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0" (5s window first on newer builds).
 * spark: "TPS from last 5s, 10s, 1m, 5m, 15m: 20.05*, 20.0, ..." (asterisk = above 20).
 */
export function parseTps(text: string): number | null {
  const m = stripCodes(text).match(/TPS from last[^:]*:\s*([^\n]+)/i)
  if (!m) return null
  const first = m[1].match(/[\d.]+/)
  if (!first) return null
  const tps = parseFloat(first[0])
  return Number.isFinite(tps) ? Math.min(20, tps) : null
}

/**
 * Extract an average milliseconds-per-tick value.
 * Paper `mspt`: "Server tick times (avg/min/max) from last 5s, 10s, 1m: 2.4/1.2/10.3, ..."
 * spark `tps`: "Tick durations (min/med/95%ile/max) from last 10s, 1m: 1.2/2.4/5.0/10.3; ..."
 */
export function parseMspt(text: string): number | null {
  const clean = stripCodes(text)
  const paper = clean.match(/tick times[^:]*:\s*([\d.]+)/i)
  if (paper) return parseFloat(paper[1])
  const spark = clean.match(/Tick durations[^:]*:\s*[\d.]+\/([\d.]+)/i)
  return spark ? parseFloat(spark[1]) : null
}

/** Whether command output means "that command doesn't exist here". */
export function isUnknownCommand(text: string): boolean {
  return /Unknown command|Unknown or incomplete command/i.test(stripCodes(text))
}
