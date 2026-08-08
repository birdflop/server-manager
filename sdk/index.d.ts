/**
 * Type definitions for Birdflop Server Manager plugins.
 *
 * A plugin is a folder inside the app's userData `plugins/` directory:
 *
 *   my-plugin/
 *     plugin.json   — the manifest (see PluginManifest)
 *     index.js      — CommonJS entry exporting activate() (and optionally deactivate())
 *
 * ```js
 * /** @type {import('@birdflop/plugin-sdk').BirdflopPlugin} *\/
 * module.exports = {
 *   async activate(ctx) {
 *     ctx.log.info('hello from ' + ctx.plugin.id)
 *     const servers = await ctx.servers.list()
 *   },
 *   deactivate() {}
 * }
 * ```
 *
 * These types mirror `src/main/plugins/api.ts` in the app — the app side is
 * the source of truth; keep the two in sync.
 */

// ---- Shared app types ----

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping'

/** Where a server's tick metrics come from. */
export type PerfSource = 'builtin' | 'spark' | 'none'

/** A selectable build/version of a given server software. */
export interface Build {
  id: string
  label: string
  channel?: string
}

/** A unified search result across content sources. */
export interface ContentSearchHit {
  /** Your source's id. */
  source: string
  /** Source-specific project id. */
  id: string
  title: string
  description: string
  iconUrl?: string
  downloads: number
  author?: string
  /** The file is hosted off-site and can't be downloaded directly. */
  external?: boolean
  /** Page to open when the item can't be installed directly. */
  pageUrl?: string
}

/** Lifecycle state of a shared tunnel. */
export type TunnelState = 'offline' | 'starting' | 'online' | 'reconnecting' | 'error'

/** Live tunnel info for one instance. */
export interface TunnelInfo {
  provider: string | null
  state: TunnelState
  /** Public address players connect to, when online. */
  publicAddress?: string
  message?: string
}

/** Availability of a tunnel provider, for the provider picker. */
export interface TunnelProviderStatus {
  id: string
  label: string
  ready: boolean
  needs?: 'auth' | 'unavailable'
  message?: string
}

// ---- Provider interfaces (registry contributions) ----

/** Everything a content source needs to pick a compatible file for a server. */
export interface ContentResolveContext {
  /** Modrinth-style loader ids compatible with the server's software. */
  loaders: string[]
  mcVersion: string
}

/** A concrete download for one project. */
export interface ResolvedContentDownload {
  url: string
  filename: string
  /** Source-specific id of the resolved version ('' when the source can't say). */
  versionId: string
  versionNumber?: string
  /** Project ids this version requires — installed automatically alongside it. */
  requiredDeps?: string[]
}

/** A place plugins/mods can be searched and installed from. */
export interface ContentSourceProvider {
  /** Registry key, recorded as install provenance. Must be unique. */
  id: string
  /** Display name for the source picker. */
  label: string
  /** Which content kinds this source serves. */
  kinds: ('plugins' | 'mods')[]
  search(query: string, ctx: ContentResolveContext): Promise<ContentSearchHit[]>
  resolve(projectId: string, ctx: ContentResolveContext): Promise<ResolvedContentDownload>
}

/** Everything the installer needs to materialize a server jar. */
export interface InstallSpec {
  kind: 'jar' | 'installer'
  url: string
  fileName: string
  installer?: 'forge' | 'neoforge' | 'quilt'
  meta?: Record<string, string>
}

/** A source of versions, builds, and downloads for one server software. */
export interface ServerProvider {
  id: string
  listGameVersions(): Promise<string[]>
  listBuilds(mc: string): Promise<Build[]>
  resolveInstall(mc: string, buildId: string): Promise<InstallSpec>
}

/** A live tunnel that can be torn down. */
export interface TunnelHandle {
  stop(): void
}

export interface TunnelStartOptions {
  instanceId?: string
  publicPort?: number
  label?: string
}

/**
 * A way to expose a local server to the public internet.
 * Only available to inline plugins (not `"isolation": "process"`).
 */
export interface TunnelProvider {
  id: string
  label: string
  status(): Promise<TunnelProviderStatus>
  start(
    port: number,
    onUpdate: (info: TunnelInfo) => void,
    opts?: TunnelStartOptions
  ): Promise<TunnelHandle>
}

// ---- The plugin context ----

/** In-process server lifecycle events. */
export type PluginServerEvent =
  | { type: 'output'; id: string; chunk: string }
  | { type: 'status'; id: string; status: ServerStatus }
  | { type: 'closed'; id: string; code: number | null }

/** A managed server, as visible to plugins. */
export interface PluginServerInfo {
  id: string
  name: string
  serverType: string
  mcVersion: string
  port: number
  status: ServerStatus
}

/** Latest tick metrics for a running server. */
export interface PluginServerPerf {
  source: PerfSource
  tps?: number
  mspt?: number
}

/** Requires 'servers:read'; mutating calls additionally require 'servers:control'. */
export interface PluginServersApi {
  list(): Promise<PluginServerInfo[]>
  get(id: string): Promise<PluginServerInfo | null>
  status(id: string): Promise<ServerStatus>
  /** Buffered console scrollback (ANSI-colored, ring-buffered to 256 KB). */
  readConsole(id: string): Promise<string>
  /** Latest TPS/MSPT sample, or null when unknown. */
  getPerformance(id: string): Promise<PluginServerPerf | null>
  /** Subscribe to output/status/closed events for all servers. Returns an unsubscribe fn. */
  onEvent(cb: (event: PluginServerEvent) => void): () => void
  start(id: string): Promise<void>
  stop(id: string): Promise<void>
  restart(id: string): Promise<void>
  sendCommand(id: string, command: string): Promise<void>
}

/** Per-plugin persistent JSON storage. */
export interface PluginStorageApi {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

/** Writes to the plugin's log file (visible from app Settings → Plugins). */
export interface PluginLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/**
 * Renderer-facing IPC, namespaced per plugin: `handle(verb, fn)` answers
 * `window.api.invokePlugin('<id>', verb, …)`; `broadcast(event, payload)`
 * reaches `window.api.onPluginEvent('<id>', event, cb)` listeners.
 */
export interface PluginIpcApi {
  handle(verb: string, fn: (...args: unknown[]) => unknown): void
  broadcast(event: string, payload: unknown): void
}

/** Everything a plugin can reach. Handed to activate(). */
export interface PluginContext {
  app: {
    /** The app's version (semver). */
    version: string
  }
  plugin: {
    id: string
    /** Absolute path to the plugin's own folder. */
    dir: string
  }
  servers: PluginServersApi
  storage: PluginStorageApi
  log: PluginLogger
  ipc: PluginIpcApi
  /** Requires 'content:sources'. */
  content: { registerSource(provider: ContentSourceProvider): void }
  /** Requires 'tunnels:providers'. Inline plugins only. */
  tunnels: { registerProvider(provider: TunnelProvider): void }
  /** Requires 'software:providers'. */
  software: { registerProvider(provider: ServerProvider): void }
}

/** Shape of a plugin's entry module. */
export interface BirdflopPlugin {
  activate(ctx: PluginContext): void | Promise<void>
  /** Called on disable/reload/quit. Registrations are cleaned up automatically. */
  deactivate?(): void | Promise<void>
}

/** Permission ids a plugin may declare in its manifest. */
export type PluginPermission =
  | 'servers:read'
  | 'servers:control'
  | 'content:sources'
  | 'tunnels:providers'
  | 'software:providers'
  | 'network:listen'

/** Shape of plugin.json. */
export interface PluginManifest {
  /** Stable identifier — lowercase slug (letters, digits, - or _). */
  id: string
  name: string
  version: string
  description?: string
  author?: string
  /** Entry file, relative to the plugin folder (CommonJS). */
  main: string
  /** Minimum app version, e.g. { "bsm": ">=0.9.0" }. */
  engines?: { bsm?: string }
  permissions?: PluginPermission[]
  /** 'inline' (default) runs in the app's main process; 'process' in an isolated utility process. */
  isolation?: 'inline' | 'process'
  /** Declarative UI contributions. */
  contributes?: {
    /** Extra console command buttons, shown in every server's console. */
    consoleMacros?: { label: string; command: string }[]
  }
}
