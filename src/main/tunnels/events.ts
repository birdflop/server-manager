// Pure helpers for the Birdflop tunnel integration: parsing the NDJSON event
// stream emitted by `bftunnel local --json`, translating relay errors into
// actionable messages, and picking a compatible binary release. No Electron
// imports — everything here is unit-testable.

/** Live stats for one route, as serialized by the relay. */
export interface BftunnelRouteStat {
  hostname: string
  port: number
  active_connections: number
  total_connections: number
  bytes: number
}

/** One NDJSON event from `bftunnel local --json`. */
export type BftunnelEvent =
  | { event: 'identity_issued'; subdomain: string; token: string }
  | { event: 'bound'; addresses: string[] }
  | { event: 'connected'; reconnect: boolean; addresses: string[] }
  | { event: 'reconnecting'; attempt: number; delay_ms: number; error: string }
  | { event: 'stats'; routes: BftunnelRouteStat[] }
  | { event: 'error'; message: string; fatal: boolean }

const EVENT_NAMES = new Set([
  'identity_issued',
  'bound',
  'connected',
  'reconnecting',
  'stats',
  'error'
])

/**
 * Parse one stdout line from `bftunnel local --json`. Returns null for blank
 * lines, non-JSON noise, and unknown event kinds (a newer binary may add some).
 */
export function parseTunnelEvent(line: string): BftunnelEvent | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  const event = (parsed as { event?: unknown })?.event
  if (typeof event !== 'string' || !EVENT_NAMES.has(event)) return null
  return parsed as BftunnelEvent
}

/**
 * Known relay/client failure signatures → what the user should actually do.
 * Mirrors the crash diagnosis the console does for server exits.
 */
const DIAGNOSES: Array<[RegExp, string]> = [
  [
    /rate limit/i,
    'The relay is rate-limiting new registrations from your network. Wait a minute and try again.'
  ],
  [
    /identity capacity/i,
    'The relay is at capacity and not accepting new tunnel identities right now. Try again later.'
  ],
  [
    /unknown subdomain/i,
    'Your saved tunnel identity no longer exists on the relay (it may have been revoked). Sharing again will enroll a fresh address.'
  ],
  [
    /invalid token|authentication failed/i,
    'The relay rejected your saved tunnel identity. Sharing again will enroll a fresh address.'
  ],
  [
    /address already in use/i,
    'Your tunnel address is already registered with the relay — is the same identity being shared from another computer?'
  ],
  [
    /too many tunnels/i,
    'You have reached the relay’s limit on simultaneous tunnels for one identity. Stop sharing another server first.'
  ],
  [
    /could not connect|timed out|connection refused|network unreachable|eof during/i,
    'Could not reach the tunnel relay. Check your internet connection — the relay may also be down.'
  ],
  [
    /port must be above|not in allowed range/i,
    'The relay does not allow this public port. Change the server’s port and share again.'
  ],
  [
    /relay shutting down|disconnected by relay administrator/i,
    'The relay closed the connection. The tunnel reconnects automatically.'
  ]
]

/** Translate a raw tunnel error into an actionable message (or pass it through). */
export function diagnoseTunnelError(message: string): string {
  for (const [pattern, diagnosis] of DIAGNOSES) {
    if (pattern.test(message)) return diagnosis
  }
  return message
}

/** Parse a `vX.Y.Z` tag; null when it isn't one. */
function parseTag(tag: string): [number, number, number] | null {
  const m = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/**
 * Pick the newest release tag that is protocol-compatible with `pinned`,
 * meaning the same major.minor (patch releases never change the protocol).
 * Falls back to `pinned` when nothing newer/compatible is offered.
 */
export function pickLatestCompatible(tags: string[], pinned: string): string {
  const base = parseTag(pinned)
  if (!base) return pinned
  let best = pinned
  let bestPatch = base[2]
  for (const tag of tags) {
    const v = parseTag(tag)
    if (!v || v[0] !== base[0] || v[1] !== base[1]) continue
    if (v[2] > bestPatch) {
      best = tag
      bestPatch = v[2]
    }
  }
  return best
}
