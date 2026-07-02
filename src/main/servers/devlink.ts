import { join, resolve, basename } from 'node:path'
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import chokidar, { type FSWatcher } from 'chokidar'
import type { BuildSystemInfo, Instance } from '@shared/types'
import { contentDirOf, contentKindOf } from '@shared/software'
import { readIndex, readInstance, instanceDir, updateInstance } from '../store/instances'
import * as servers from './registry'

/**
 * Dev-project links: watch a plugin/mod project's build output folder and, whenever a
 * fresh jar is built, copy it into the server's plugins/mods folder (replacing the
 * previously deployed build) and run the configured action (restart / console command).
 * Unlike the per-server file watcher, links are active app-wide — a build deploys even
 * while the server is stopped, so the next start picks it up.
 */

interface Link {
  watcher: FSWatcher
  timer: ReturnType<typeof setTimeout> | null
}

const links = new Map<string, Link>()

/** Sniff a project folder for its build system + conventional output folder. */
export function detectBuildSystem(projectPath: string): BuildSystemInfo {
  const has = (...names: string[]): boolean => names.some((n) => existsSync(join(projectPath, n)))
  if (has('build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts')) {
    return { system: 'gradle', outputDir: 'build/libs' }
  }
  if (has('pom.xml')) return { system: 'maven', outputDir: 'target' }
  return { system: null, outputDir: '' }
}

/** Build byproducts that are never the jar you want on the server. */
function isDeployableJar(name: string): boolean {
  const lower = name.toLowerCase()
  if (!lower.endsWith('.jar')) return false
  if (lower.startsWith('original-')) return false // maven-shade backup of the unshaded jar
  return !['-sources.jar', '-javadoc.jar', '-dev.jar', '-dev-shadow.jar'].some((s) =>
    lower.endsWith(s)
  )
}

/** The most recently modified deployable jar in a build output folder, or null. */
function newestJar(outDir: string): string | null {
  let best: { path: string; mtime: number } | null = null
  let entries: string[]
  try {
    entries = readdirSync(outDir)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!isDeployableJar(entry)) continue
    try {
      const st = statSync(join(outDir, entry))
      if (st.isFile() && (!best || st.mtimeMs > best.mtime)) {
        best = { path: join(outDir, entry), mtime: st.mtimeMs }
      }
    } catch {
      /* file vanished mid-scan */
    }
  }
  return best?.path ?? null
}

/**
 * Copy the newest built jar into the server's content folder, replacing the previously
 * deployed build, and run the configured action if the server is running.
 * Returns the deployed jar name. Throws with a friendly message when there's nothing to deploy.
 */
export function deployNow(root: string, id: string): string {
  const inst = readInstance(root, id)
  if (!inst) throw new Error('Server not found')
  const cfg = inst.devLink
  if (!cfg?.projectPath) throw new Error('No project linked')
  if (contentKindOf(inst.serverType) === 'none') {
    throw new Error('This server type has no plugins/mods folder to deploy into.')
  }

  const outDir = resolve(cfg.projectPath, cfg.outputDir || '')
  const jar = newestJar(outDir)
  if (!jar) throw new Error(`No built jar found in ${outDir}. Build the project first.`)

  const jarName = basename(jar)
  const dir = instanceDir(root, id)
  const contentDir = join(dir, contentDirOf(inst.serverType))
  mkdirSync(contentDir, { recursive: true })

  // Replace the previous build if its filename changed (e.g. a version bump).
  const previous = cfg.lastDeployedJar
  if (previous && previous !== jarName) {
    try {
      rmSync(join(contentDir, previous), { force: true })
    } catch {
      /* locked or already gone — the copy below still lands the new build */
    }
  }
  copyFileSync(jar, join(contentDir, jarName))
  updateInstance(root, id, { devLink: { ...cfg, lastDeployedJar: jarName } })

  if (servers.isRunning(id)) {
    const command = cfg.command?.trim()
    if (cfg.action === 'command' && command) {
      servers.appendNotice(id, `[dev link] Deployed ${jarName} — running "${command}"…`)
      servers.sendCommand(id, command)
    } else {
      servers.appendNotice(id, `[dev link] Deployed ${jarName} — restarting…`)
      // Use the freshly persisted config so the restart keeps the new lastDeployedJar.
      const fresh = readInstance(root, id)
      if (fresh) servers.restart(fresh, dir)
    }
  }
  return jarName
}

/**
 * (Re)create the output watcher for an instance from its current devLink config.
 * Safe to call repeatedly; tears down any existing watcher first.
 */
export function syncDevLink(root: string, instance: Instance): void {
  stopDevLink(instance.id)

  const cfg = instance.devLink
  if (!cfg?.enabled || !cfg.projectPath) return
  if (contentKindOf(instance.serverType) === 'none') return

  const outDir = resolve(cfg.projectPath, cfg.outputDir || '')
  const debounceMs = Math.max(200, cfg.debounceMs || 1500)

  const watcher = chokidar.watch(outDir, {
    depth: 0,
    ignoreInitial: true,
    // Wait for the build tool to finish writing so we never copy a half-written jar.
    awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 100 }
  })

  const entry: Link = { watcher, timer: null }
  const fire = (changedPath: string): void => {
    if (!isDeployableJar(basename(changedPath))) return
    if (entry.timer) clearTimeout(entry.timer)
    // Builds often emit several jars (plain + shaded); after the debounce we deploy
    // the newest one, which is the shaded/final artifact in every common setup.
    entry.timer = setTimeout(() => {
      try {
        deployNow(root, instance.id)
      } catch {
        /* nothing deployable (e.g. clean) — wait for the next build */
      }
    }, debounceMs)
  }

  watcher.on('add', fire).on('change', fire)
  // Swallow watcher errors (e.g. output folder deleted by a clean) — non-fatal.
  watcher.on('error', () => {})

  links.set(instance.id, entry)
}

/** Attach watchers for every instance with an enabled dev link (app startup / root change). */
export function syncAllDevLinks(root: string): void {
  stopAllDevLinks()
  for (const meta of readIndex(root).instances) {
    const inst = readInstance(root, meta.id)
    if (inst?.devLink?.enabled) syncDevLink(root, inst)
  }
}

/** Tear down the dev-link watcher for one instance, if any. */
export function stopDevLink(id: string): void {
  const entry = links.get(id)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  void entry.watcher.close()
  links.delete(id)
}

/** Tear down every dev-link watcher (app quit / root change). */
export function stopAllDevLinks(): void {
  for (const id of [...links.keys()]) stopDevLink(id)
}
