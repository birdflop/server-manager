// Live console sessions for remote panel servers. Each open console is one
// websocket to the server's Wings daemon, authenticated with a short-lived JWT
// fetched from the panel (and re-fetched when Wings says it's expiring).

import { BrowserWindow } from 'electron'
import WebSocket from 'ws'
import type { PteroOutputEvent, PteroStateEvent, PteroStatsEvent } from '@shared/types'
import { panelOrigin, websocketDetails } from './api'
import { mapPowerState, parseWingsStats } from './parse'

/** Cap the per-server scrollback buffer (matches the local console buffer). */
const BUFFER_MAX = 256 * 1024
/** Delay before re-dialing after an unexpected socket close. */
const RECONNECT_MS = 3000
/** Give up re-dialing after this many consecutive failures. */
const RECONNECT_MAX = 5

interface Session {
  serverId: string
  ws: WebSocket | null
  buffer: string
  authed: boolean
  closedByUser: boolean
  attempts: number
  reconnectTimer: NodeJS.Timeout | null
}

const sessions = new Map<string, Session>()

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

/**
 * Open (or reuse) a live console for a server. Resolves with the buffered
 * scrollback; output/state/stats stream as ptero:* events afterwards.
 */
export async function openConsole(serverId: string): Promise<string> {
  const existing = sessions.get(serverId)
  if (existing) return existing.buffer
  const session: Session = {
    serverId,
    ws: null,
    buffer: '',
    authed: false,
    closedByUser: false,
    attempts: 0,
    reconnectTimer: null
  }
  sessions.set(serverId, session)
  try {
    await dial(session)
  } catch (err) {
    sessions.delete(serverId) // don't leave a zombie session with no socket
    throw err
  }
  return session.buffer
}

/** Close a server's console session (no-op when none is open). */
export function closeConsole(serverId: string): void {
  const session = sessions.get(serverId)
  if (!session) return
  session.closedByUser = true
  if (session.reconnectTimer) clearTimeout(session.reconnectTimer)
  session.ws?.close()
  sessions.delete(serverId)
}

/** Close every open console (disconnect / app quit). */
export function closeAllConsoles(): void {
  for (const id of [...sessions.keys()]) closeConsole(id)
}

/** Send a command over the live socket when open; returns false otherwise. */
export function sendViaConsole(serverId: string, command: string): boolean {
  const session = sessions.get(serverId)
  if (!session?.authed || session.ws?.readyState !== WebSocket.OPEN) return false
  session.ws.send(JSON.stringify({ event: 'send command', args: [command] }))
  return true
}

async function dial(session: Session): Promise<void> {
  const { token, socketUrl } = await websocketDetails(session.serverId)
  // Wings only accepts sockets that look like they come from the panel.
  const ws = new WebSocket(socketUrl, { origin: panelOrigin() ?? undefined })
  session.ws = ws
  session.authed = false

  ws.on('open', () => ws.send(JSON.stringify({ event: 'auth', args: [token] })))

  ws.on('message', (data) => {
    let msg: { event?: string; args?: unknown[] }
    try {
      msg = JSON.parse(String(data)) as { event?: string; args?: unknown[] }
    } catch {
      return
    }
    void handleEvent(session, msg.event ?? '', (msg.args ?? []).map(String))
  })

  ws.on('close', () => {
    session.authed = false
    scheduleReconnect(session)
  })

  ws.on('error', () => {
    /* handled by the close event */
  })
}

/** Re-dial after an unexpected drop (Wings restart, network blip), with a cap. */
function scheduleReconnect(session: Session): void {
  if (session.closedByUser || !sessions.has(session.serverId)) return
  if (session.attempts >= RECONNECT_MAX) {
    append(session, '\x1b[31m[Birdflop] Lost connection to the panel console.\x1b[0m')
    sessions.delete(session.serverId)
    return
  }
  session.attempts++
  session.reconnectTimer = setTimeout(() => {
    // A dial that fails outright (panel unreachable) never emits 'close',
    // so count it here and keep trying.
    void dial(session).catch(() => scheduleReconnect(session))
  }, RECONNECT_MS)
}

async function handleEvent(session: Session, event: string, args: string[]): Promise<void> {
  switch (event) {
    case 'auth success':
      session.authed = true
      session.attempts = 0
      // Only ask for scrollback on the first connect; reconnects would duplicate it.
      if (!session.buffer) session.ws?.send(JSON.stringify({ event: 'send logs', args: [null] }))
      session.ws?.send(JSON.stringify({ event: 'send stats', args: [null] }))
      break
    case 'console output':
    case 'install output':
      append(session, args[0] ?? '')
      break
    case 'status': {
      const e: PteroStateEvent = { serverId: session.serverId, state: mapPowerState(args[0] ?? '') }
      broadcast('ptero:state', e)
      break
    }
    case 'stats': {
      const stats = parseWingsStats(args[0] ?? '')
      if (stats) {
        const e: PteroStatsEvent = { serverId: session.serverId, ...stats }
        broadcast('ptero:stats', e)
        broadcast('ptero:state', { serverId: session.serverId, state: stats.state })
      }
      break
    }
    case 'token expiring':
    case 'token expired':
    case 'jwt error':
      try {
        const { token } = await websocketDetails(session.serverId)
        session.ws?.send(JSON.stringify({ event: 'auth', args: [token] }))
      } catch {
        session.ws?.close() // fall back to the reconnect path
      }
      break
    case 'daemon error':
      append(session, `\x1b[31m[Daemon] ${args[0] ?? 'unknown error'}\x1b[0m`)
      break
  }
}

function append(session: Session, line: string): void {
  const chunk = line + '\r\n'
  session.buffer = (session.buffer + chunk).slice(-BUFFER_MAX)
  const e: PteroOutputEvent = { serverId: session.serverId, chunk }
  broadcast('ptero:output', e)
}
