/**
 * The API surface handed to app plugins — the plugin-facing compatibility
 * contract. Everything here is a curated facade over the app's internals:
 * internals can be refactored freely as long as this file's shapes hold.
 *
 * The published `@birdflop/plugin-sdk` package mirrors these types for plugin
 * authors; keep the two in sync when this file changes.
 *
 * All methods are Promise-returning so the same interface works for inline
 * plugins and process-isolated plugins (which talk to the app over RPC).
 */
import type { PerfSource, ServerStatus } from '@shared/types'
import type { ContentSourceProvider } from '../content/types'
import type { TunnelProvider } from '../tunnels/types'
import type { ServerProvider } from '../software/types'

/** In-process server lifecycle events, mirrored from the server registry. */
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

/** Latest tick metrics for a running server (null until the first poll lands). */
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
  /** Latest TPS/MSPT sample, or null when unknown (server stopped, proxy, no RCON). */
  getPerformance(id: string): Promise<PluginServerPerf | null>
  /** Subscribe to output/status/closed events for all servers. Returns an unsubscribe fn. */
  onEvent(cb: (event: PluginServerEvent) => void): () => void
  start(id: string): Promise<void>
  stop(id: string): Promise<void>
  restart(id: string): Promise<void>
  sendCommand(id: string, command: string): Promise<void>
}

/** Per-plugin persistent JSON storage under the app's userData folder. */
export interface PluginStorageApi {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

/** Writes to the plugin's log file (userData/plugin-logs/<id>.log). */
export interface PluginLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/**
 * Renderer-facing IPC, namespaced per plugin: a handler registered as `verb`
 * is invokable from the renderer as channel `plugin:<id>:<verb>`, and
 * `broadcast(event, …)` reaches listeners on `plugin:<id>:<event>`.
 */
export interface PluginIpcApi {
  handle(verb: string, fn: (...args: unknown[]) => unknown): void
  broadcast(event: string, payload: unknown): void
}

/** Requires 'content:sources'. */
export interface PluginContentApi {
  registerSource(provider: ContentSourceProvider): void
}

/** Requires 'tunnels:providers'. */
export interface PluginTunnelsApi {
  registerProvider(provider: TunnelProvider): void
}

/** Requires 'software:providers'. */
export interface PluginSoftwareApi {
  registerProvider(provider: ServerProvider): void
}

/** Everything a plugin can reach. Handed to `activate()`. */
export interface PluginContext {
  app: {
    /** The app's version (semver). */
    version: string
  }
  plugin: {
    id: string
    /** Absolute path to the plugin's own folder (read-only by convention). */
    dir: string
  }
  servers: PluginServersApi
  storage: PluginStorageApi
  log: PluginLogger
  ipc: PluginIpcApi
  content: PluginContentApi
  tunnels: PluginTunnelsApi
  software: PluginSoftwareApi
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

export const KNOWN_PERMISSIONS: PluginPermission[] = [
  'servers:read',
  'servers:control',
  'content:sources',
  'tunnels:providers',
  'software:providers',
  'network:listen'
]
