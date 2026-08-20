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
import type { Build, PerfSource, ServerStatus } from '@shared/types'
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
  /** The group it sits in, or null when ungrouped. */
  groupId: string | null
}

/** Latest tick metrics for a running server (null until the first poll lands). */
export interface PluginServerPerf {
  source: PerfSource
  tps?: number
  mspt?: number
}

/** A sidebar group, as visible to plugins. */
export interface PluginGroupInfo {
  id: string
  name: string
  /** Ids of the servers in this group, in sidebar order. */
  serverIds: string[]
}

/**
 * What to install when creating a server. Only `name` and `serverType` are
 * required — everything else defaults to the latest game version and build for
 * that software, the first free port from 25565, the app's configured RAM
 * default, and a Java runtime matching the game version (downloaded if the
 * machine has none that fits).
 */
export interface PluginCreateServerOptions {
  name: string
  /** Software id, e.g. 'paper', 'fabric', 'velocity' — see `software.listTypes()`. */
  serverType: string
  mcVersion?: string
  /** Build id from `software.listBuilds()`; defaults to the newest. */
  build?: string
  port?: number
  ramMB?: number
  javaPath?: string
  jvmArgs?: string[]
  /**
   * Accepts the Minecraft EULA on the user's behalf. Leave false unless the
   * user has actually agreed — a server without it won't start.
   */
  eulaAccepted?: boolean
  groupId?: string | null
}

/**
 * Requires 'servers:read'; start/stop/restart/sendCommand additionally require
 * 'servers:control', and create/delete/rename/move require 'servers:manage'.
 */
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
  /** Download + install a new server. Resolves once it's ready to start. */
  create(options: PluginCreateServerOptions): Promise<PluginServerInfo>
  /** Delete a server: stops it, then removes its folder and index entry. */
  delete(id: string): Promise<void>
  rename(id: string, name: string): Promise<void>
  /** Move a server into a group (null = ungrouped), optionally before another server. */
  move(id: string, groupId: string | null, beforeId?: string | null): Promise<void>
}

/** Requires 'servers:read' to list; mutating calls require 'servers:manage'. */
export interface PluginGroupsApi {
  list(): Promise<PluginGroupInfo[]>
  /** Create a group and return it. */
  create(name: string): Promise<PluginGroupInfo>
  rename(id: string, name: string): Promise<void>
  /** Delete a group. Its servers survive — they fall back to ungrouped. */
  delete(id: string): Promise<void>
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

/** Registering requires 'software:providers'; the catalog reads require 'servers:read'. */
export interface PluginSoftwareApi {
  registerProvider(provider: ServerProvider): void
  /** Every server software the app can install, built-in and plugin-registered. */
  listTypes(): Promise<string[]>
  /** Minecraft versions available for a software id, newest first. */
  listVersions(serverType: string): Promise<string[]>
  /** Builds available for a (software, version) pair, newest first. */
  listBuilds(serverType: string, mcVersion: string): Promise<Build[]>
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
  groups: PluginGroupsApi
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
  | 'servers:manage'
  | 'content:sources'
  | 'tunnels:providers'
  | 'software:providers'
  | 'network:listen'

export const KNOWN_PERMISSIONS: PluginPermission[] = [
  'servers:read',
  'servers:control',
  'servers:manage',
  'content:sources',
  'tunnels:providers',
  'software:providers',
  'network:listen'
]
