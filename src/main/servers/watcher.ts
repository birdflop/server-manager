import { resolve } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { Instance } from '@shared/types'

/**
 * Per-instance file watching. When a server's watch config is enabled, changes to the
 * watched paths fire a debounced callback (provided by the registry) that restarts the
 * server or runs a console command. Watchers are owned here; the registry attaches one
 * when a server starts and detaches it when the process closes.
 */
interface Watch {
  watcher: FSWatcher
  timer: ReturnType<typeof setTimeout> | null
}

const watchers = new Map<string, Watch>()

/** Whether a changed path should trigger the action given the configured extension filter. */
function matchesExtensions(changedPath: string, extensions: string[]): boolean {
  if (extensions.length === 0) return true
  const lower = changedPath.toLowerCase()
  return extensions.some((ext) => lower.endsWith(`.${ext.replace(/^\./, '').toLowerCase()}`))
}

/**
 * (Re)create the watcher for an instance from its current `watch` config. Tears down any
 * existing watcher first, so this is safe to call repeatedly (e.g. when settings change).
 * `onTrigger` receives the path that changed (relative to the instance dir).
 */
export function syncWatch(
  instance: Instance,
  dir: string,
  onTrigger: (changedPath: string) => void
): void {
  stopWatch(instance.id)

  const cfg = instance.watch
  const paths = (cfg?.paths ?? []).map((p) => p.trim()).filter(Boolean)
  if (!cfg?.enabled || paths.length === 0) return

  const extensions = (cfg.extensions ?? []).map((e) => e.trim()).filter(Boolean)
  const debounceMs = Math.max(100, cfg.debounceMs || 1000)
  // chokidar v4 emits paths relative to `cwd`; resolve our relative paths against the dir.
  const targets = paths.map((p) => resolve(dir, p))

  const watcher = chokidar.watch(targets, {
    cwd: dir,
    ignoreInitial: true,
    // Wait for writes to settle so we don't fire on a half-written jar mid-build.
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  })

  const entry: Watch = { watcher, timer: null }
  const fire = (changedPath: string): void => {
    if (!matchesExtensions(changedPath, extensions)) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => onTrigger(changedPath), debounceMs)
  }

  watcher.on('add', fire).on('change', fire).on('unlink', fire)
  // Swallow watcher errors (e.g. a watched path that doesn't exist yet) — they're non-fatal.
  watcher.on('error', () => {})

  watchers.set(instance.id, entry)
}

/** Tear down the watcher for one instance, if any. */
export function stopWatch(id: string): void {
  const entry = watchers.get(id)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  void entry.watcher.close()
  watchers.delete(id)
}

/** Tear down every watcher (used on app quit). */
export function stopAllWatch(): void {
  for (const id of [...watchers.keys()]) stopWatch(id)
}
