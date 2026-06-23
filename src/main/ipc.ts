import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import type {
  AppConfig,
  CreateInstancePayload,
  ImportInstancePayload,
  Instance,
  InstallProgress,
  ManagerIndex,
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
import { writeEula, setServerProperties, setProxyPort } from './servers/properties'
import { isProxy } from '@shared/software'
import * as servers from './servers/registry'
import {
  listContent,
  addContentFiles,
  deleteContentFile,
  contentSearch,
  contentInstall
} from './servers/content'
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
    // Keep the bind port in sync when it changes (proxy config vs server.properties).
    if (result && patch.port) {
      const dir = instanceDir(root, id)
      if (isProxy(result.instance.serverType)) setProxyPort(dir, result.instance.serverType, patch.port)
      else setServerProperties(dir, { 'server-port': patch.port })
    }
    return result
  })

  ipcMain.handle('instances:delete', (_e, id: string) => {
    const root = requireRoot()
    servers.stop(id) // ensure the process isn't holding the folder
    return deleteInstance(root, id)
  })

  ipcMain.handle('instances:openFolder', (_e, id: string) => {
    shell.openPath(instanceDir(requireRoot(), id))
  })

  ipcMain.handle('instances:clone', (_e, id: string) => cloneInstance(requireRoot(), id))
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
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    shell.openExternal(url)
  })
  ipcMain.handle('server:clearBuffer', (_e, id: string) => servers.clearBuffer(id))

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
