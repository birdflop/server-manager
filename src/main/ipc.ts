import { app, ipcMain, dialog, shell, clipboard, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import type {
  AppConfig,
  CreateInstancePayload,
  ImportInstancePayload,
  Instance,
  InstallProgress,
  ManagerIndex,
  ProxyBackend,
  ServerType,
  ThemeName
} from '@shared/types'
import { getConfig, setConfig } from './config'
import {
  ensureRoot,
  readIndex,
  createGroup,
  renameGroup,
  deleteGroup,
  setGroupExpanded,
  moveInstance,
  addInstanceMeta,
  readInstance,
  writeInstance,
  updateInstance,
  deleteInstance,
  cloneInstance,
  importInstance,
  listFolderJars,
  instanceDir,
  type InstancePatch
} from './store/instances'
import { listBackups, createBackup, restoreBackup, deleteBackup } from './servers/backups'
import { getProvider } from './software'
import { detectJava } from './java/detect'
import { ensureJava } from './java/adoptium'
import { requiredJavaMajor } from './java/requirements'
import { getUpdateStatus, checkForUpdates, downloadUpdate, quitAndInstall } from './updater'
import { installServer } from './servers/install'
import {
  writeEula,
  setServerProperties,
  setProxyPort,
  writeProxyBackends,
  proxyServerName
} from './servers/properties'
import { isProxy } from '@shared/software'
import * as servers from './servers/registry'
import { startTunnel, stopTunnel, tunnelInfo } from './tunnels/registry'
import { listProviderStatuses } from './tunnels/index'
import type { TunnelProviderId } from '@shared/types'
import {
  listContent,
  addContentFiles,
  deleteContentFile,
  contentSearch,
  contentInstall,
  checkContentUpdates,
  updateContent
} from './servers/content'
import {
  listFiles,
  readFile as readInstanceFile,
  writeFile as writeInstanceFile,
  detectEditors,
  openInEditor,
  instanceSubdir
} from './servers/files'
import type { ContentSource } from '@shared/types'

/** Resolve the current data root or throw if it hasn't been chosen yet. */
function requireRoot(): string {
  const { rootPath } = getConfig()
  if (!rootPath) throw new Error('No data root selected')
  return rootPath
}

/** Registers every ipcMain handler. Called once on app ready. */
export function registerIpc(): void {
  ipcMain.handle('ping', () => `pong (electron ${process.versions.electron})`)

  ipcMain.handle('config:get', () => getConfig())

  ipcMain.handle('config:setTheme', (_e, theme: ThemeName) => {
    setConfig({ theme })
  })

  ipcMain.handle('config:update', (_e, patch: Partial<AppConfig>) => setConfig(patch))

  ipcMain.handle('dialog:pickDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Choose a folder for your servers',
      properties: ['openDirectory', 'createDirectory'] as const
    }
    const result = win
      ? await dialog.showOpenDialog(win, { ...opts, properties: [...opts.properties] })
      : await dialog.showOpenDialog({ ...opts, properties: [...opts.properties] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('app:setRoot', (_e, root: string): ManagerIndex => {
    const index = ensureRoot(root)
    setConfig({ rootPath: root })
    return index
  })

  ipcMain.handle('index:get', (): ManagerIndex => {
    const { rootPath } = getConfig()
    if (!rootPath) return { groups: [], instances: [] }
    return readIndex(rootPath)
  })

  // ---- Group operations ----
  ipcMain.handle('groups:create', (_e, name: string) => createGroup(requireRoot(), name))
  ipcMain.handle('groups:rename', (_e, id: string, name: string) =>
    renameGroup(requireRoot(), id, name)
  )
  ipcMain.handle('groups:delete', (_e, id: string) => deleteGroup(requireRoot(), id))
  ipcMain.handle('groups:setExpanded', (_e, id: string, expanded: boolean) =>
    setGroupExpanded(requireRoot(), id, expanded)
  )

  // ---- Instance index operations ----
  ipcMain.handle(
    'instances:move',
    (_e, id: string, groupId: string | null, beforeId?: string | null) =>
      moveInstance(requireRoot(), id, groupId, beforeId)
  )

  // ---- Software providers ----
  ipcMain.handle('software:gameVersions', (_e, type: ServerType) =>
    getProvider(type).listGameVersions()
  )
  ipcMain.handle('software:builds', (_e, type: ServerType, mc: string) =>
    getProvider(type).listBuilds(mc)
  )

  // ---- Java ----
  ipcMain.handle('java:list', () => detectJava())
  ipcMain.handle('java:requirement', (_e, mc: string) => requiredJavaMajor(mc))
  ipcMain.handle('java:ensure', (e, major: number) =>
    ensureJava(major, (p) => e.sender.send('java:progress', p))
  )

  // ---- Instances ----
  ipcMain.handle('instances:get', (_e, id: string) => readInstance(requireRoot(), id))

  ipcMain.handle('instances:listAll', () => {
    const root = getConfig().rootPath
    if (!root) return []
    return readIndex(root)
      .instances.map((m) => readInstance(root, m.id))
      .filter((i): i is NonNullable<typeof i> => i !== null)
  })

  ipcMain.handle('instances:create', async (e, payload: CreateInstancePayload) => {
    const root = requireRoot()
    const id = randomUUID()
    const dir = instanceDir(root, id)
    mkdirSync(dir, { recursive: true })

    const send = (p: InstallProgress): void => e.sender.send('instances:createProgress', p)

    send({ phase: 'resolve' })
    const spec = await getProvider(payload.serverType).resolveInstall(
      payload.mcVersion,
      payload.build
    )
    const result = await installServer(dir, spec, payload.javaPath, send)

    send({ phase: 'configure' })
    if (isProxy(payload.serverType)) {
      // Proxies have no Minecraft EULA and use their own config file for the bind port.
      setProxyPort(dir, payload.serverType, payload.port)
    } else {
      if (payload.eulaAccepted) writeEula(dir, true)
      setServerProperties(dir, { 'server-port': payload.port })
    }

    const instance: Instance = {
      id,
      name: payload.name,
      serverType: payload.serverType,
      mcVersion: payload.mcVersion,
      build: payload.build,
      launchKind: result.launchKind,
      launchJar: result.launchJar,
      port: payload.port,
      ramMB: payload.ramMB,
      javaPath: payload.javaPath,
      jvmArgs: payload.jvmArgs,
      eulaAccepted: payload.eulaAccepted,
      createdAt: Date.now()
    }
    writeInstance(root, instance)
    const index = addInstanceMeta(root, {
      id,
      name: instance.name,
      groupId: payload.groupId ?? null
    })
    send({ phase: 'done' })
    return { instance, index }
  })

  ipcMain.handle('instances:update', (_e, id: string, patch: InstancePatch) => {
    const root = requireRoot()
    const result = updateInstance(root, id, patch)
    if (result) {
      const dir = instanceDir(root, id)
      // Keep the bind port in sync when it changes (proxy config vs server.properties).
      if (patch.port) {
        if (isProxy(result.instance.serverType)) setProxyPort(dir, result.instance.serverType, patch.port)
        else setServerProperties(dir, { 'server-port': patch.port })
      }
      // Re-sync the file watcher live if its config changed and the server is running.
      if (patch.watch !== undefined) servers.refreshWatch(result.instance, dir)
    }
    return result
  })

  ipcMain.handle('instances:delete', (_e, id: string) => {
    const root = requireRoot()
    servers.stop(id) // ensure the process isn't holding the folder
    return deleteInstance(root, id)
  })

  ipcMain.handle('instances:openFolder', (_e, id: string, relPath?: string) => {
    shell.openPath(instanceSubdir(requireRoot(), id, relPath ?? ''))
  })

  ipcMain.handle('instances:clone', (_e, id: string) => cloneInstance(requireRoot(), id))

  // ---- Proxy backends ----
  ipcMain.handle('proxy:getBackends', (_e, id: string): ProxyBackend[] => {
    return readInstance(requireRoot(), id)?.backends ?? []
  })
  ipcMain.handle('proxy:setBackends', (_e, id: string, backends: ProxyBackend[]): ProxyBackend[] => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    if (!inst) throw new Error('Server not found')
    if (!isProxy(inst.serverType)) throw new Error('Only proxies have backend servers')
    // Sanitize names to valid config identifiers and drop duplicates/empties.
    const seen = new Set<string>()
    const clean: ProxyBackend[] = []
    for (const b of backends) {
      const address = (b.address ?? '').trim()
      if (!address) continue
      let name = proxyServerName(b.name ?? '')
      while (seen.has(name)) name = `${name}-2`
      seen.add(name)
      clean.push({ name, address, instanceId: b.instanceId })
    }
    const dir = instanceDir(root, id)
    // Ensure the proxy config exists, then rewrite just its server section.
    setProxyPort(dir, inst.serverType, inst.port)
    writeProxyBackends(dir, inst.serverType, clean)
    writeInstance(root, { ...inst, backends: clean })
    return clean
  })

  ipcMain.handle('instances:import', (_e, payload: ImportInstancePayload) =>
    importInstance(requireRoot(), payload)
  )
  ipcMain.handle('instances:listFolderJars', (_e, path: string) => listFolderJars(path))

  // ---- Backups ----
  ipcMain.handle('backups:list', (_e, id: string) => listBackups(requireRoot(), id))
  ipcMain.handle('backups:create', (_e, id: string) => createBackup(requireRoot(), id))
  ipcMain.handle('backups:restore', (_e, id: string, name: string) => {
    if (servers.isRunning(id)) throw new Error('Stop the server before restoring a backup.')
    restoreBackup(requireRoot(), id, name)
  })
  ipcMain.handle('backups:delete', (_e, id: string, name: string) =>
    deleteBackup(requireRoot(), id, name)
  )

  // ---- Server lifecycle ----
  ipcMain.handle('server:start', (_e, id: string) => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    if (inst) servers.start(inst, instanceDir(root, id))
  })
  ipcMain.handle('server:stop', (_e, id: string) => servers.stop(id))
  ipcMain.handle('server:restart', (_e, id: string) => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    if (inst) servers.restart(inst, instanceDir(root, id))
  })
  ipcMain.handle('server:command', (_e, id: string, command: string) =>
    servers.sendCommand(id, command)
  )
  ipcMain.handle('server:status', (_e, id: string) => servers.statusOf(id))
  ipcMain.handle('server:buffer', (_e, id: string) => servers.bufferOf(id))
  ipcMain.handle('server:running', () => servers.runningIds())

  // ---- Content (plugins / mods) ----
  ipcMain.handle('content:list', (_e, id: string) => listContent(requireRoot(), id))
  ipcMain.handle('content:add', (_e, id: string, paths: string[]) =>
    addContentFiles(requireRoot(), id, paths)
  )
  ipcMain.handle('content:delete', (_e, id: string, name: string) =>
    deleteContentFile(requireRoot(), id, name)
  )
  ipcMain.handle('content:search', (_e, id: string, source: ContentSource, query: string) =>
    contentSearch(requireRoot(), id, source, query)
  )
  ipcMain.handle('content:install', (_e, id: string, source: ContentSource, projectId: string) =>
    contentInstall(requireRoot(), id, source, projectId)
  )
  ipcMain.handle('content:checkUpdates', (_e, id: string) => checkContentUpdates(requireRoot(), id))
  ipcMain.handle('content:update', (_e, id: string, name: string) =>
    updateContent(requireRoot(), id, name)
  )
  // ---- Files (built-in viewer/editor) ----
  ipcMain.handle('files:list', (_e, id: string, relPath: string) =>
    listFiles(requireRoot(), id, relPath)
  )
  ipcMain.handle('files:read', (_e, id: string, relPath: string) =>
    readInstanceFile(requireRoot(), id, relPath)
  )
  ipcMain.handle('files:write', (_e, id: string, relPath: string, content: string) =>
    writeInstanceFile(requireRoot(), id, relPath, content)
  )
  ipcMain.handle('files:detectEditors', () => detectEditors())
  ipcMain.handle('files:openInEditor', (_e, id: string, editorId: string, relPath?: string) =>
    openInEditor(requireRoot(), id, editorId, relPath)
  )

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    shell.openExternal(url)
  })
  ipcMain.handle('clipboard:write', (_e, text: string) => {
    clipboard.writeText(text)
  })
  ipcMain.handle('server:clearBuffer', (_e, id: string) => servers.clearBuffer(id))

  ipcMain.handle('server:saveLog', async (_e, id: string): Promise<string | null> => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    // Strip ANSI escape codes so the saved log is plain text.
    // eslint-disable-next-line no-control-regex
    const text = servers.bufferOf(id).replace(/\x1b\[[0-9;]*m/g, '')
    const safeName = (inst?.name ?? 'server').replace(/[^a-z0-9_-]+/gi, '-')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Save console log',
      defaultPath: `${safeName}-${stamp}.log`,
      filters: [{ name: 'Log files', extensions: ['log', 'txt'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, text, 'utf-8')
    return result.filePath
  })

  // ---- Tunnels (share a server publicly) ----
  ipcMain.handle('tunnel:providers', () => listProviderStatuses())
  ipcMain.handle('tunnel:get', (_e, id: string) => tunnelInfo(id))
  ipcMain.handle('tunnel:start', (_e, id: string, provider: TunnelProviderId) => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    if (!inst) throw new Error('Server not found')
    // Remember the chosen provider for this instance.
    updateInstance(root, id, { tunnel: { provider, autoStart: inst.tunnel?.autoStart ?? false } })
    return startTunnel(id, provider, inst.port)
  })
  ipcMain.handle('tunnel:stop', (_e, id: string) => stopTunnel(id))

  // ---- App + updater ----
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('updater:status', () => getUpdateStatus())
  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:install', () => quitAndInstall())

  ipcMain.handle('dialog:pickFiles', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Add plugins / mods',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Jar files', extensions: ['jar'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    return result.canceled ? [] : result.filePaths
  })
}
