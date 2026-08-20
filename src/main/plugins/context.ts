import { app, ipcMain, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Instance, ManagerIndex, ServerStatus } from '@shared/types'
import { getConfig } from '../config'
import {
  createGroup,
  deleteGroup,
  deleteInstance,
  instanceDir,
  moveInstance,
  readIndex,
  readInstance,
  renameGroup,
  updateInstance
} from '../store/instances'
import * as servers from '../servers/registry'
import { perfOf } from '../servers/perf'
import { ensureRcon } from '../servers/rcon-provision'
import { createInstance, resolveCreateDefaults } from '../servers/create'
import { stopDevLink } from '../servers/devlink'
import { registerContentSource, unregisterContentSource, getContentSource } from '../content'
import { registerTunnelProvider, unregisterTunnelProvider, getTunnelProvider } from '../tunnels'
import {
  registerServerProvider,
  unregisterServerProvider,
  getProvider,
  listServerProviders
} from '../software'
import { createPluginLogger } from './log'
import type { PluginManifest } from './manifest'
import type {
  PluginContext,
  PluginGroupInfo,
  PluginPermission,
  PluginServerInfo
} from './api'

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

function toInfo(inst: Instance, groupId: string | null): PluginServerInfo {
  return {
    id: inst.id,
    name: inst.name,
    serverType: inst.serverType,
    mcVersion: inst.mcVersion,
    port: inst.port,
    status: servers.statusOf(inst.id),
    groupId
  }
}

function groupIdOf(root: string, id: string): string | null {
  return readIndex(root).instances.find((m) => m.id === id)?.groupId ?? null
}

/**
 * Tell open windows the index changed. The renderer refreshes itself after its
 * own mutations, but a plugin creating or deleting servers happens behind its
 * back — without this the sidebar would go stale until the next reload.
 */
function announceIndex(index: ManagerIndex): ManagerIndex {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('index:changed', index)
  return index
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
          .instances.map((m) => {
            const inst = readInstance(root, m.id)
            return inst ? toInfo(inst, m.groupId) : null
          })
          .filter((i): i is PluginServerInfo => i !== null)
      },
      get: async (serverId) => {
        need('servers:read')
        const root = requireRoot()
        const inst = readInstance(root, serverId)
        return inst ? toInfo(inst, groupIdOf(root, serverId)) : null
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
      },
      create: async (options) => {
        need('servers:manage')
        const root = requireRoot()
        if (!options?.name?.trim()) throw new Error('A server needs a name')
        const payload = await resolveCreateDefaults(root, { ...options, name: options.name.trim() })
        const { instance, index } = await createInstance(root, payload)
        announceIndex(index)
        return toInfo(instance, payload.groupId)
      },
      delete: async (serverId) => {
        need('servers:manage')
        const root = requireRoot()
        if (!readInstance(root, serverId)) throw new Error(`No server with id "${serverId}"`)
        servers.stop(serverId) // don't delete a folder the JVM still holds open
        stopDevLink(serverId)
        announceIndex(deleteInstance(root, serverId))
      },
      rename: async (serverId, name) => {
        need('servers:manage')
        if (!name?.trim()) throw new Error('A server needs a name')
        const result = updateInstance(requireRoot(), serverId, { name: name.trim() })
        if (!result) throw new Error(`No server with id "${serverId}"`)
        announceIndex(result.index)
      },
      move: async (serverId, groupId, beforeId) => {
        need('servers:manage')
        const root = requireRoot()
        const index = readIndex(root)
        if (!index.instances.some((m) => m.id === serverId)) {
          throw new Error(`No server with id "${serverId}"`)
        }
        if (groupId && !index.groups.some((g) => g.id === groupId)) {
          throw new Error(`No group with id "${groupId}"`)
        }
        announceIndex(moveInstance(root, serverId, groupId, beforeId))
      }
    },

    groups: {
      list: async () => {
        need('servers:read')
        const index = readIndex(requireRoot())
        return index.groups.map(
          (g): PluginGroupInfo => ({
            id: g.id,
            name: g.name,
            serverIds: index.instances.filter((m) => m.groupId === g.id).map((m) => m.id)
          })
        )
      },
      create: async (name) => {
        need('servers:manage')
        if (!name?.trim()) throw new Error('A group needs a name')
        const before = new Set(readIndex(requireRoot()).groups.map((g) => g.id))
        const index = announceIndex(createGroup(requireRoot(), name))
        const created = index.groups.find((g) => !before.has(g.id))
        if (!created) throw new Error('Group creation failed')
        return { id: created.id, name: created.name, serverIds: [] }
      },
      rename: async (groupId, name) => {
        need('servers:manage')
        const root = requireRoot()
        if (!name?.trim()) throw new Error('A group needs a name')
        if (!readIndex(root).groups.some((g) => g.id === groupId)) {
          throw new Error(`No group with id "${groupId}"`)
        }
        announceIndex(renameGroup(root, groupId, name))
      },
      delete: async (groupId) => {
        need('servers:manage')
        const root = requireRoot()
        if (!readIndex(root).groups.some((g) => g.id === groupId)) {
          throw new Error(`No group with id "${groupId}"`)
        }
        announceIndex(deleteGroup(root, groupId))
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
      },
      listTypes: async () => {
        need('servers:read')
        return listServerProviders().map((p) => p.id)
      },
      listVersions: async (serverType) => {
        need('servers:read')
        return getProvider(serverType).listGameVersions()
      },
      listBuilds: async (serverType, mcVersion) => {
        need('servers:read')
        return getProvider(serverType).listBuilds(mcVersion)
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
