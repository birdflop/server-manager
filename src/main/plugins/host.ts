import { app, shell, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PluginInfo, PluginState } from '@shared/types'
import { getConfig, setConfig } from '../config'
import { readManifest, checkEngine, type PluginManifest } from './manifest'
import { createPluginContext, type PluginContextHandle } from './context'
import { pluginLogPath, createPluginLogger } from './log'
import { startPluginProcess, type PluginProcessHandle } from './runner'
import type { BirdflopPlugin } from './api'

/** How long a plugin's activate() may run before it's failed. */
const ACTIVATE_TIMEOUT_MS = 10_000

interface LoadedPlugin {
  /** Folder name, used as the display id when the manifest itself is broken. */
  folder: string
  dir: string
  manifest: PluginManifest | null
  state: PluginState
  error?: string
  /** Inline plugins: the entry module + its context teardown. */
  module?: BirdflopPlugin
  handle?: PluginContextHandle
  /** Process-isolated plugins: the utility-process handle. */
  proc?: PluginProcessHandle
}

const plugins = new Map<string, LoadedPlugin>()

/** Where user-installed plugins live: userData/plugins/<folder>/plugin.json. */
export function pluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

function idOf(p: LoadedPlugin): string {
  return p.manifest?.id ?? p.folder
}

function toInfo(p: LoadedPlugin): PluginInfo {
  return {
    id: idOf(p),
    name: p.manifest?.name ?? p.folder,
    version: p.manifest?.version ?? '?',
    description: p.manifest?.description,
    author: p.manifest?.author,
    permissions: p.manifest?.permissions ?? [],
    isolation: p.manifest?.isolation ?? 'inline',
    state: p.state,
    error: p.error,
    dir: p.dir,
    logPath: pluginLogPath(idOf(p)),
    contributes: p.manifest?.contributes
  }
}

export function listPlugins(): PluginInfo[] {
  return [...plugins.values()]
    .map(toInfo)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function broadcastChanged(): void {
  const list = listPlugins()
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('plugins:changed', list)
}

function withTimeout(work: Promise<void> | void, what: string): Promise<void> {
  return Promise.race([
    Promise.resolve(work),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out after ${ACTIVATE_TIMEOUT_MS / 1000}s`)), ACTIVATE_TIMEOUT_MS)
    )
  ])
}

/** Activate one scanned plugin (manifest already validated). */
async function activate(p: LoadedPlugin): Promise<void> {
  const manifest = p.manifest
  if (!manifest) return
  const log = createPluginLogger(manifest.id)
  try {
    if (manifest.isolation === 'process') {
      p.proc = await startPluginProcess(manifest, p.dir, (message) => {
        p.proc = undefined
        p.state = 'error'
        p.error = message
        broadcastChanged()
      })
    } else {
      const entry = join(p.dir, manifest.main)
      // Resolve through the plugin's own folder so its bundled node_modules work,
      // and drop any cached copy so reloads pick up fresh code.
      const req = createRequire(join(p.dir, 'plugin.json'))
      const resolved = req.resolve(entry)
      delete req.cache[resolved]
      const mod = req(resolved) as BirdflopPlugin | { default: BirdflopPlugin }
      const plugin = ('default' in mod && mod.default ? mod.default : mod) as BirdflopPlugin
      if (typeof plugin.activate !== 'function') {
        throw new Error(`entry "${manifest.main}" doesn't export an activate() function`)
      }
      const handle = createPluginContext(manifest)
      handle.ctx.plugin.dir = p.dir
      p.module = plugin
      p.handle = handle
      await withTimeout(plugin.activate(handle.ctx), 'activate()')
    }
    p.state = 'active'
    p.error = undefined
    log.info(`activated (v${manifest.version})`)
  } catch (err) {
    // A failed activation must not leave half-registered hooks behind.
    deactivate(p)
    p.state = 'error'
    p.error = (err as Error).message
    log.error(`activation failed: ${p.error}`)
  }
}

/** Tear down one plugin (disable/reload/quit). Never throws. */
function deactivate(p: LoadedPlugin): void {
  try {
    void p.module?.deactivate?.()
  } catch {
    /* plugin's own cleanup is best-effort */
  }
  try {
    p.handle?.dispose()
  } catch {
    /* ignore */
  }
  try {
    p.proc?.stop()
  } catch {
    /* ignore */
  }
  p.module = undefined
  p.handle = undefined
  p.proc = undefined
  if (p.state === 'active') p.state = 'disabled'
}

/** Scan the plugins folder and (re)load everything. Called at startup and on reload. */
export async function loadPlugins(): Promise<PluginInfo[]> {
  for (const p of plugins.values()) deactivate(p)
  plugins.clear()

  const root = pluginsDir()
  mkdirSync(root, { recursive: true })
  const disabled = new Set(getConfig().disabledPlugins)

  for (const folder of readdirSync(root, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue
    const dir = join(root, folder.name)
    // Folders without a manifest (logs, scratch space) aren't plugins.
    if (!existsSync(join(dir, 'plugin.json'))) continue

    const p: LoadedPlugin = { folder: folder.name, dir, manifest: null, state: 'error' }
    try {
      p.manifest = readManifest(dir)
      const engineError = checkEngine(p.manifest.engines?.bsm, app.getVersion())
      if (engineError) throw new Error(engineError)
      if (plugins.has(p.manifest.id)) {
        throw new Error(`another plugin already uses the id "${p.manifest.id}"`)
      }
    } catch (err) {
      p.error = (err as Error).message
      createPluginLogger(idOf(p)).error(`not loaded: ${p.error}`)
      plugins.set(idOf(p), p)
      continue
    }

    plugins.set(p.manifest.id, p)
    if (disabled.has(p.manifest.id)) {
      p.state = 'disabled'
      continue
    }
    await activate(p)
  }

  broadcastChanged()
  return listPlugins()
}

/** Enable or disable one plugin, persisting the choice. Takes effect immediately. */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<PluginInfo[]> {
  const config = getConfig()
  const disabled = new Set(config.disabledPlugins)
  if (enabled) disabled.delete(id)
  else disabled.add(id)
  setConfig({ disabledPlugins: [...disabled] })

  const p = plugins.get(id)
  if (p?.manifest) {
    if (enabled && p.state !== 'active') await activate(p)
    if (!enabled && p.state === 'active') deactivate(p)
    // A previously failed plugin stays in 'error' until re-enabled or reloaded.
    if (!enabled && p.state === 'error') p.state = 'disabled'
  }
  broadcastChanged()
  return listPlugins()
}

/** Open the plugins folder in the OS file manager. */
export function openPluginsFolder(): void {
  const dir = pluginsDir()
  mkdirSync(dir, { recursive: true })
  void shell.openPath(dir)
}

/** Open a plugin's log file (creating an empty one if it never logged). */
export function openPluginLog(id: string): void {
  const path = pluginLogPath(id)
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, '', 'utf-8')
  }
  void shell.openPath(path)
}

/** Tear down every plugin (app quit). */
export function deactivateAllPlugins(): void {
  for (const p of plugins.values()) deactivate(p)
}
