/**
 * Server consoles emit plain log lines (Paper/Spigot/Forge/Vanilla strip ANSI
 * when not attached to a TTY). We add color ourselves, per line, by recognizing
 * the standard log-level token so warnings/errors stand out in xterm.
 *
 * Coloring happens in the main process before buffering, so colors appear live
 * and on re-open. The save-log path strips ANSI again, keeping saved logs clean.
 */

const RESET = '\x1b[0m'
const RED = '\x1b[91m' // ERROR / SEVERE / FATAL + stack traces
const YELLOW = '\x1b[33m' // WARN / WARNING
const GRAY = '\x1b[90m' // DEBUG / TRACE / FINE*
const GREEN = '\x1b[92m' // the "Done (…)!" ready line

// Matches the level inside the usual prefix: `[..thread/WARN]`, `[12:34:56 INFO]`.
const LEVEL_RE = /(?:\/|\s|\[)(ERROR|SEVERE|FATAL|WARN(?:ING)?|INFO|DEBUG|TRACE|FINE|FINER|FINEST)\]/

/** Pick an ANSI color prefix for a single line, or null to leave it untouched. */
function colorForLine(line: string): string | null {
  // Already carries its own ANSI (our internal messages, or a server that emits color).
  if (line.includes('\x1b[')) return null

  const m = LEVEL_RE.exec(line)
  if (m) {
    const lvl = m[1]
    if (lvl === 'ERROR' || lvl === 'SEVERE' || lvl === 'FATAL') return RED
    if (lvl.startsWith('WARN')) return YELLOW
    if (lvl === 'INFO') return /\bDone \(/.test(line) ? GREEN : null
    return GRAY
  }

  // No level token — most often a stack-trace continuation of an error block,
  // or a raw exception line printed to stderr without a log prefix.
  if (
    /^\s+at\s/.test(line) ||
    /^\s*Caused by:/.test(line) ||
    /^\s*\.\.\. \d+ more\b/.test(line) ||
    /^[\w.$]+(?:Exception|Error)(?::|\s|$)/.test(line)
  ) {
    return RED
  }
  return null
}

/** Wrap one line's visible body in color, preserving a trailing CR. */
function paint(line: string): string {
  const cr = line.endsWith('\r') ? '\r' : ''
  const body = cr ? line.slice(0, -1) : line
  if (!body) return line
  const c = colorForLine(body)
  return c ? c + body + RESET + cr : line
}

export interface ColorState {
  /** Trailing partial line held until its newline arrives, so we color whole lines. */
  pending: string
}

/**
 * Colorize a stream chunk. Complete lines are colored and returned; any trailing
 * partial line is held in `state.pending` until the next chunk completes it.
 */
export function colorize(state: ColorState, text: string): string {
  const data = state.pending + text
  const lastNl = data.lastIndexOf('\n')
  if (lastNl === -1) {
    state.pending = data
    return ''
  }
  state.pending = data.slice(lastNl + 1)
  const complete = data.slice(0, lastNl + 1)
  // split keeps a trailing '' (from the final \n); paint('') is a no-op.
  return complete
    .split('\n')
    .map((line) => paint(line))
    .join('\n')
}

/** Flush any held partial line (e.g. on process exit). */
export function flushColor(state: ColorState): string {
  if (!state.pending) return ''
  const out = paint(state.pending)
  state.pending = ''
  return out
}
