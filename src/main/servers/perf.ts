import { BrowserWindow } from 'electron'
import type { Instance, PerfSource, ServerPerfEvent } from '@shared/types'
import { isProxy } from '@shared/software'
import { rconExec } from '../util/rcon'
import { parseTps, parseMspt, isUnknownCommand } from './perf-parse'

/**
 * Tick-metric polling: while a server runs, poll TPS/MSPT every few seconds over the
 * app-managed local RCON connection — silently, so the visible console stays clean.
 * Paper-family servers answer the built-in `tps`/`mspt` commands; everything else is
 * asked via `spark tps` (works when the spark mod/plugin is installed). When neither
 * responds, we report source 'none' and stop polling for that run.
 */

const POLL_MS = 5000
/** Connection failures tolerated before giving up (RCON comes up slightly after ready). */
const MAX_CONN_FAILURES = 24

const BUILTIN_TPS_TYPES = new Set(['paper', 'purpur', 'folia'])

interface Poller {
  timer: ReturnType<typeof setInterval>
  /** Metric sources left to try, first entry is the active one. */
  modes: Exclude<PerfSource, 'none'>[]
  connFailures: number
  /** Guards against overlapping polls when RCON is slow. */
  busy: boolean
}

const pollers = new Map<string, Poller>()

function broadcast(e: ServerPerfEvent): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('server:perf', e)
}

/** Begin polling tick metrics for a server that just became ready. */
export function startPerfPolling(instance: Instance): void {
  stopPerfPolling(instance.id)
  if (isProxy(instance.serverType)) return
  const rcon = instance.rcon
  if (!rcon) {
    broadcast({ id: instance.id, source: 'none' })
    return
  }

  const modes: Poller['modes'] = BUILTIN_TPS_TYPES.has(instance.serverType)
    ? ['builtin', 'spark']
    : ['spark']
  const poller: Poller = {
    modes,
    connFailures: 0,
    busy: false,
    timer: setInterval(() => void poll(instance, rcon), POLL_MS)
  }
  pollers.set(instance.id, poller)
}

/** Stop polling for a server (process exited or app is shutting down). */
export function stopPerfPolling(id: string): void {
  const p = pollers.get(id)
  if (!p) return
  clearInterval(p.timer)
  pollers.delete(id)
}

function giveUp(id: string): void {
  stopPerfPolling(id)
  broadcast({ id, source: 'none' })
}

async function poll(instance: Instance, rcon: { port: number; password: string }): Promise<void> {
  const poller = pollers.get(instance.id)
  if (!poller || poller.busy) return
  poller.busy = true
  try {
    const mode = poller.modes[0]
    if (!mode) return giveUp(instance.id)

    if (mode === 'builtin') {
      const tpsOut = await rconExec(rcon.port, rcon.password, 'tps')
      if (isUnknownCommand(tpsOut)) {
        poller.modes.shift()
        return
      }
      const tps = parseTps(tpsOut)
      if (tps === null) return // unparseable this tick — try again next poll
      let mspt: number | undefined
      try {
        const msptOut = await rconExec(rcon.port, rcon.password, 'mspt')
        mspt = parseMspt(msptOut) ?? undefined
      } catch {
        /* tps alone is still useful */
      }
      poller.connFailures = 0
      broadcast({ id: instance.id, source: 'builtin', tps, mspt })
      return
    }

    // spark mode
    const out = await rconExec(rcon.port, rcon.password, 'spark tps')
    if (isUnknownCommand(out)) {
      poller.modes.shift()
      return
    }
    const tps = parseTps(out)
    if (tps === null) return
    poller.connFailures = 0
    broadcast({ id: instance.id, source: 'spark', tps, mspt: parseMspt(out) ?? undefined })
  } catch {
    // Connection refused / timeout — RCON not up yet, or disabled in this server's config.
    if (++poller.connFailures >= MAX_CONN_FAILURES) giveUp(instance.id)
  } finally {
    const p = pollers.get(instance.id)
    if (p) p.busy = false
  }
}

/** Stop every poller (app quit). */
export function stopAllPerfPolling(): void {
  for (const id of [...pollers.keys()]) stopPerfPolling(id)
}
