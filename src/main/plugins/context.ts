import { app, ipcMain, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Instance, ServerStatus } from '@shared/types'
import { getConfig } from '../config'
import { readIndex, readInstance, instanceDir } from '../store/instances'
import * as servers from '../servers/registry'
import { perfOf } from '../servers/perf'
import { ensureRcon } from '../servers/rcon-provision'
import { registerContentSource, unregisterContentSource, getContentSource } from '../content'
import { registerTunnelProvider, unregisterTunnelProvider, getTunnelProvider } from '../tunnels'
import { registerServerProvider, unregisterServerProvider, getProvider } from '../software'
import { createPluginLogger } from './log'
import type { PluginManifest } from './manifest'
import type { PluginContext, PluginPermission, PluginServerInfo } from './api'

/** A built context plus the teardown that undoes everything the plugin registered. */
export interface PluginContextHandle {
  ctx: PluginContext
  dispose(): void
}

function requireRoot(): string {
  const { rootPath } = getConfig()
  if (!rootPath) throw new Error('No data root selected yet')
  return rootPath
}

function requireInstance(id: string): { root: string; inst: Instance } {
  const root = requireRoot()
  const inst = readInstance(root, id)
  if (!inst) throw new Error(`No server with id "${id}"`)
  return { root, inst }
}

function toInfo(inst: Instance): PluginServerInfo {
  return {
    id: inst.id,
    name: inst.name,
    serverType: inst.serverType,
    mcVersion: inst.mcVersion,
    port: inst.port,
    status: servers.statusOf(inst.id)
  }
}

/** True when a registry lookup succeeds (they throw on unknown ids). */
function registered(get: (id: string) => unknown, id: string): boolean {
  try {
    get(id)
    return true
  } catch {
    return false
  }
}

/**
 * Build the API facade handed to one plugin's activate(). Every registration
 * (IPC handlers, event subscriptions, providers) is tracked so dispose() can
 * cleanly undo the plugin on disable/reload/quit.
 */
export function createPluginContext(manifest: PluginManifest): PluginContextHandle {
  const id = manifest.id
  const perms = new Set(manifest.permissions ?? [])
  const cleanups: Array<() => void> = []

  function need(perm: PluginPermission): void {
    if (!perms.has(perm)) {
      throw new Error(`Plugin "${id}" is missing the "${perm}" permission — declare it in plugin.json`)
    }
  }

  const dataDir = join(app.getPath('userData'), 'plugin-data')
  const storagePath = join(dataDir, `${id}.json`)
  function readStore(): Record<string, unknown> {
    try {
      return JSON.parse(readFileSync(storagePath, 'utf-8')) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  function writeStore(store: Record<string, unknown>): void {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(storagePath, JSON.stringify(store, null, 2), 'utf-8')
  }

  const ctx: PluginContext = {
    app: { version: app.getVersion() },
    plugin: { id, dir: '' }, // dir filled in by the host, which knows the folder

    servers: {
      list: async () => {
        need('servers:read')
        const root = requireRoot()
        return readIndex(root)
          .instances.map((m) => readInstance(root, m.id))
          .filter((i): i is Instance => i !== null)
          .map(toInfo)
      },
      get: async (serverId) => {
        need('servers:read')
        const inst = readInstance(requireRoot(), serverId)
        return inst ? toInfo(inst) : null
      },
      status: async (serverId) => {
        need('servers:read')
        return servers.statusOf(serverId)
      },
      readConsole: async (serverId) => {
        need('servers:read')
        return servers.bufferOf(serverId)
      },
      getPerformance: async (serverId) => {
        need('servers:read')
        const perf = perfOf(serverId)
        return perf ? { source: perf.source, tps: perf.tps, mspt: perf.mspt } : null
      },
      onEvent: (cb) => {
        need('servers:read')
        const onOutput = (e: { id: string; chunk: string }): void =>
          cb({ type: 'output', id: e.id, chunk: e.chunk })
        const onStatus = (e: { id: string; status: ServerStatus }): void =>
          cb({ type: 'status', id: e.id, status: e.status })
        const onClosed = (e: { id: string; code: number | null }): void =>
          cb({ type: 'closed', id: e.id, code: e.code })
        servers.serverEvents.on('output', onOutput)
        servers.serverEvents.on('status', onStatus)
        servers.serverEvents.on('closed', onClosed)
        const unsub = (): void => {
          servers.serverEvents.off('output', onOutput)
          servers.serverEvents.off('status', onStatus)
          servers.serverEvents.off('closed', onClosed)
        }
        cleanups.push(unsub)
        return unsub
      },
      start: async (serverId) => {
        need('servers:control')
        const { root, inst } = requireInstance(serverId)
        servers.start(ensureRcon(root, inst), instanceDir(root, serverId))
      },
      stop: async (serverId) => {
        need('servers:control')
        servers.stop(serverId)
      },
      restart: async (serverId) => {
        need('servers:control')
        const { root, inst } = requireInstance(serverId)
        servers.restart(ensureRcon(root, inst), instanceDir(root, serverId))
      },
      sendCommand: async (serverId, command) => {
        need('servers:control')
        if (!servers.isRunning(serverId)) throw new Error('Server is not running')
        servers.sendCommand(serverId, command)
      }
    },

    storage: {
      get: async <T>(key: string): Promise<T | undefined> => readStore()[key] as T | undefined,
      set: async (key, value) => {
        const store = readStore()
        store[key] = value
        writeStore(store)
      },
      delete: async (key) => {
        const store = readStore()
        delete store[key]
        writeStore(store)
      }
    },

    log: createPluginLogger(id),

    ipc: {
      handle: (verb, fn) => {
        const channel = `plugin:${id}:${verb}`
        ipcMain.handle(channel, (_e, ...args) => fn(...args))
        cleanups.push(() => ipcMain.removeHandler(channel))
      },
      broadcast: (event, payload) => {
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send(`plugin:${id}:${event}`, payload)
        }
      }
    },

    content: {
      registerSource: (provider) => {
        need('content:sources')
        if (registered(getContentSource, provider.id)) {
          throw new Error(`Content source id "${provider.id}" is already taken`)
        }
        registerContentSource(provider)
        cleanups.push(() => unregisterContentSource(provider.id))
      }
    },

    tunnels: {
      registerProvider: (provider) => {
        need('tunnels:providers')
        if (registered(getTunnelProvider, provider.id)) {
          throw new Error(`Tunnel provider id "${provider.id}" is already taken`)
        }
        registerTunnelProvider(provider)
        cleanups.push(() => unregisterTunnelProvider(provider.id))
      }
    },

    software: {
      registerProvider: (provider) => {
        need('software:providers')
        if (registered(getProvider, provider.id)) {
          throw new Error(`Server software provider id "${provider.id}" is already taken`)
        }
        registerServerProvider(provider)
        cleanups.push(() => unregisterServerProvider(provider.id))
      }
    }
  }

  return {
    ctx,
    dispose: () => {
      // Run in reverse so later registrations tear down first; keep going on errors.
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup()
        } catch {
          /* best-effort teardown */
        }
      }
      cleanups.length = 0
    }
  }
}
