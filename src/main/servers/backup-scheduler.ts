import type { Instance } from '@shared/types'
import { isProxy } from '@shared/software'
import { getConfig } from '../config'
import { readInstance } from '../store/instances'
import { createBackup, pruneBackups } from './backups'
import * as servers from './registry'
import { serverEvents } from './registry'

/**
 * Automatic backup schedules. A server's timer runs only while it's running: it
 * starts on the ready line, fires every N hours, and stops with the process. Before
 * zipping we flush + pause world saves (save-all / save-off) so the archive is
 * consistent, then re-enable saving. Retention keeps the newest K auto backups.
 */

const MIN_INTERVAL_MS = 15 * 60 * 1000
/** How long to wait after save-all for the flush to hit disk. */
const FLUSH_MS = 3000

const timers = new Map<string, ReturnType<typeof setInterval>>()

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function startSchedule(root: string, instance: Instance): void {
  stopSchedule(instance.id)
  const cfg = instance.backup
  if (!cfg?.enabled) return
  const intervalMs = Math.max(MIN_INTERVAL_MS, (cfg.intervalHours || 6) * 3600 * 1000)
  timers.set(
    instance.id,
    setInterval(() => void runAutoBackup(root, instance.id), intervalMs)
  )
}

function stopSchedule(id: string): void {
  const t = timers.get(id)
  if (!t) return
  clearInterval(t)
  timers.delete(id)
}

async function runAutoBackup(root: string, id: string): Promise<void> {
  const inst = readInstance(root, id)
  const cfg = inst?.backup
  if (!inst || !cfg?.enabled || !servers.isRunning(id)) return

  const pauseSaves = !isProxy(inst.serverType)
  if (pauseSaves) {
    servers.sendCommand(id, 'save-off')
    servers.sendCommand(id, 'save-all')
    await sleep(FLUSH_MS)
  }
  try {
    createBackup(root, id, 'auto-')
    servers.appendNotice(id, '[backup] Automatic backup created.')
  } catch (err) {
    servers.appendNotice(id, `[backup] Automatic backup failed: ${(err as Error).message}`)
  } finally {
    if (pauseSaves) servers.sendCommand(id, 'save-on')
  }
  pruneBackups(root, id, 'auto', Math.max(1, cfg.keep || 10))
}

/**
 * Re-apply a server's schedule after its config changed. No-op unless the server is
 * running (schedules attach on the ready line).
 */
export function resyncBackupSchedule(root: string, instance: Instance): void {
  if (!servers.isRunning(instance.id)) return
  startSchedule(root, instance)
}

/** Follow server lifecycle events for the app's lifetime. Call once at startup. */
export function initBackupScheduler(): void {
  serverEvents.on('status', ({ id, status }: { id: string; status: string }) => {
    if (status === 'running') {
      const root = getConfig().rootPath
      if (!root) return
      const inst = readInstance(root, id)
      if (inst?.backup?.enabled) startSchedule(root, inst)
    } else if (status === 'stopped') {
      stopSchedule(id)
    }
  })
}

/** Stop every schedule (app quit). */
export function stopAllBackupSchedules(): void {
  for (const id of [...timers.keys()]) stopSchedule(id)
}
