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
import { listBackups, createBackup, restoreBackup, deleteBackup, pruneBackups } from './servers/backups'
import { resyncBackupSchedule } from './servers/backup-scheduler'
import { getProvider } from './software'
import { listJava, refreshJava, invalidateJavaCache } from './java/detect'
import { ensureJava } from './java/adoptium'
import { requiredJavaMajor } from './java/requirements'
import {
  getUpdateStatus,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  applyUpdateChannel
} from './updater'
import { installServer } from './servers/install'
import { previewLaunch } from './servers/launch'
import { importModpack } from './modpack'
import {
  writeEula,
  setServerProperties,
  readServerProperties,
  setProxyPort,
  writeProxyBackends,
  proxyServerName,
  ensureVelocityForwarding,
  enablePaperVelocity,
  supportsModernForwarding
} from './servers/properties'
import { isProxy, SERVER_TYPE_MAP } from '@shared/software'
import * as servers from './servers/registry'
import { startTunnel, stopTunnel, tunnelInfo } from './tunnels/registry'
import { listProviderStatuses } from './tunnels/index'
import type { TunnelStartOptions } from './tunnels/types'
import { applyShareSafetyFix, checkShareSafety } from './servers/share-safety'
import { startCompatRun, cancelCompatRun, getCompatRun } from './servers/compat'
import { detectBuildSystem, deployNow, syncDevLink, syncAllDevLinks, stopDevLink } from './servers/devlink'
import { getBedrockStatus, installBedrock } from './servers/geyser'
import { botsStatus, startBots, stopBots } from './servers/bots'
import type { BotsOptions } from '@shared/types'
import { writeRecipe, readRecipe, importRecipe } from './recipes'
import type { RecipeImportPayload } from '@shared/types'
import {
  listWorlds,
  setActiveWorld,
  deleteWorld,
  regenerateWorld,
  exportWorld,
  importWorld,
  addDatapacks,
  deleteDatapack
} from './servers/worlds'
import type {
  CompatRunOptions,
  ForwardingResult,
  ModpackImportPayload,
  ShareSafetyFix,
  TunnelProviderId
} from '@shared/types'
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
  listFilesDeep,
  readFile as readInstanceFile,
  writeFile as writeInstanceFile,
  detectEditors,
  openInEditor,
  instanceSubdir
} from './servers/files'
import type { ContentSource, PteroClonePayload, PteroPowerAction } from '@shared/types'
import * as ptero from './pterodactyl/api'
import { cloneServer as clonePanelServer, prepareClone } from './pterodactyl/clone'
import {
  closeAllConsoles,
  closeConsole,
  openConsole,
  sendViaConsole
} from './pterodactyl/console'

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

  ipcMain.handle('config:update', (_e, patch: Partial<AppConfig>) => {
    const next = setConfig(patch)
    // Switching update channels takes effect immediately: re-point the updater and re-check.
    if ('releaseChannel' in patch) {
      applyUpdateChannel()
      void checkForUpdates()
    }
    return next
  })

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
    syncAllDevLinks(root)
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
  ipcMain.handle('java:list', () => listJava())
  ipcMain.handle('java:refresh', () => refreshJava())
  ipcMain.handle('java:requirement', (_e, mc: string) => requiredJavaMajor(mc))
  ipcMain.handle('java:ensure', async (e, major: number) => {
    const install = await ensureJava(major, (p) => e.sender.send('java:progress', p))
    invalidateJavaCache() // a new managed runtime is now on disk
    return install
  })

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
      // Re-sync the dev-project link watcher whenever its config changes.
      if (patch.devLink !== undefined) syncDevLink(root, result.instance)
      // Re-apply the backup schedule live when it changes on a running server.
      if (patch.backup !== undefined) resyncBackupSchedule(root, result.instance)
    }
    return result
  })

  ipcMain.handle('instances:delete', (_e, id: string) => {
    const root = requireRoot()
    servers.stop(id) // ensure the process isn't holding the folder
    stopDevLink(id)
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

  ipcMain.handle('proxy:setupForwarding', (_e, id: string): ForwardingResult => {
    const root = requireRoot()
    const proxy = readInstance(root, id)
    if (!proxy) throw new Error('Server not found')
    if (proxy.serverType !== 'velocity') {
      throw new Error('Modern forwarding setup is only available for Velocity proxies.')
    }
    const proxyDir = instanceDir(root, id)
    // Ensure velocity.toml exists before editing it.
    setProxyPort(proxyDir, proxy.serverType, proxy.port)
    const secret = ensureVelocityForwarding(proxyDir)

    const wired: string[] = []
    const skipped: { name: string; reason: string }[] = []
    for (const backend of proxy.backends ?? []) {
      if (!backend.instanceId) {
        skipped.push({ name: backend.name, reason: 'External address — wire its config manually.' })
        continue
      }
      const target = readInstance(root, backend.instanceId)
      if (!target) {
        skipped.push({ name: backend.name, reason: 'Managed server no longer exists.' })
        continue
      }
      if (!supportsModernForwarding(target.serverType)) {
        skipped.push({
          name: backend.name,
          reason: `${SERVER_TYPE_MAP[target.serverType].label} needs a forwarding mod (e.g. FabricProxy-Lite).`
        })
        continue
      }
      enablePaperVelocity(instanceDir(root, backend.instanceId), secret)
      wired.push(backend.name)
    }
    return { secret, wired, skipped }
  })

  ipcMain.handle('instances:import', (_e, payload: ImportInstancePayload) =>
    importInstance(requireRoot(), payload)
  )
  ipcMain.handle('instances:listFolderJars', (_e, path: string) => listFolderJars(path))

  ipcMain.handle('instances:launchPreview', (_e, id: string, patch?: Partial<Instance>) => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    if (!inst) throw new Error('Server not found')
    return previewLaunch({ ...inst, ...patch }, instanceDir(root, id))
  })

  ipcMain.handle('dialog:pickModpack', async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Choose a Modrinth modpack',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('instances:importModpack', (e, payload: ModpackImportPayload) =>
    importModpack(requireRoot(), payload, (p) => e.sender.send('instances:createProgress', p))
  )

  // ---- Backups ----
  ipcMain.handle('backups:list', (_e, id: string) => listBackups(requireRoot(), id))
  ipcMain.handle('backups:create', (_e, id: string) => createBackup(requireRoot(), id))
  ipcMain.handle('backups:restore', (_e, id: string, name: string) => {
    if (servers.isRunning(id)) throw new Error('Stop the server before restoring a backup.')
    const root = requireRoot()
    // Safety snapshot of the current state, so a restore is always reversible.
    createBackup(root, id, 'pre-restore-')
    pruneBackups(root, id, 'pre-restore', 3)
    restoreBackup(root, id, name)
  })
  ipcMain.handle('backups:delete', (_e, id: string, name: string) =>
    deleteBackup(requireRoot(), id, name)
  )

  /**
   * Provision app-managed local RCON for a server (used for silent TPS polling).
   * Generates credentials once, then keeps server.properties in sync every start.
   */
  function ensureRcon(root: string, inst: Instance): Instance {
    if (isProxy(inst.serverType)) return inst
    let rcon = inst.rcon
    if (!rcon) {
      // Derive a port away from the game port; wrap back into range for high ports.
      let rconPort = inst.port + 10000
      if (rconPort > 65535) rconPort = inst.port - 10000
      if (rconPort < 1024) rconPort = 25575
      rcon = { port: rconPort, password: randomUUID().replace(/-/g, '') }
      updateInstance(root, inst.id, { rcon })
    }
    setServerProperties(instanceDir(root, inst.id), {
      'enable-rcon': 'true',
      'rcon.port': rcon.port,
      'rcon.password': rcon.password,
      'broadcast-rcon-to-ops': 'false'
    })
    return { ...inst, rcon }
  }

  // ---- Server lifecycle ----
  ipcMain.handle('server:start', (_e, id: string) => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    if (inst) servers.start(ensureRcon(root, inst), instanceDir(root, id))
  })
  ipcMain.handle('server:stop', (_e, id: string) => servers.stop(id))
  ipcMain.handle('server:restart', (_e, id: string) => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    if (inst) servers.restart(ensureRcon(root, inst), instanceDir(root, id))
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
  ipcMain.handle('files:listDeep', (_e, id: string) => listFilesDeep(requireRoot(), id))
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

  // ---- server.properties (visual editor) ----
  ipcMain.handle('properties:get', (_e, id: string): Record<string, string> => {
    return readServerProperties(instanceDir(requireRoot(), id))
  })
  ipcMain.handle(
    'properties:set',
    (_e, id: string, kv: Record<string, string>): Record<string, string> => {
      const dir = instanceDir(requireRoot(), id)
      setServerProperties(dir, kv)
      return readServerProperties(dir)
    }
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
    updateInstance(root, id, {
      tunnel: { provider, autoStart: inst.tunnel?.autoStart ?? false, label: inst.tunnel?.label }
    })

    // Birdflop exposes the server on its own port under the user's subdomain;
    // the provider manages the shared identity (~/.birdflop) itself.
    const opts: TunnelStartOptions | undefined =
      provider === 'birdflop'
        ? { instanceId: id, publicPort: inst.port, label: inst.tunnel?.label }
        : undefined

    return startTunnel(id, provider, inst.port, opts)
  })
  ipcMain.handle('tunnel:stop', (_e, id: string) => stopTunnel(id))
  ipcMain.handle('tunnel:safety', (_e, id: string) => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    if (!inst) throw new Error('Server not found')
    return checkShareSafety(instanceDir(root, id), inst.serverType)
  })
  ipcMain.handle('tunnel:fixSafety', (_e, id: string, fix: ShareSafetyFix) => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    if (!inst) throw new Error('Server not found')
    return applyShareSafetyFix(instanceDir(root, id), inst.serverType, fix)
  })

  // ---- Fake-player load testing ----
  ipcMain.handle('bots:get', (_e, id: string) => botsStatus(id))
  ipcMain.handle('bots:start', (_e, id: string, opts: BotsOptions) => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    if (!inst) throw new Error('Server not found')
    if (!servers.isRunning(id)) throw new Error('Start the server first.')
    return startBots(root, inst, opts)
  })
  ipcMain.handle('bots:stop', (_e, id: string) => stopBots(id))

  // ---- Server recipes ----
  ipcMain.handle('recipes:export', async (_e, id: string): Promise<string | null> => {
    const root = requireRoot()
    const inst = readInstance(root, id)
    const safeName = (inst?.name ?? 'server').replace(/[^a-z0-9_-]+/gi, '-')
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Export server recipe',
      defaultPath: `${safeName}.bsmrecipe`,
      filters: [{ name: 'Server recipe', extensions: ['bsmrecipe', 'json'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    writeRecipe(root, id, result.filePath)
    return result.filePath
  })
  ipcMain.handle('recipes:pick', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Choose a server recipe',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Server recipe', extensions: ['bsmrecipe', 'json'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    return { path, recipe: readRecipe(path) }
  })
  ipcMain.handle('recipes:import', (e, payload: RecipeImportPayload) =>
    importRecipe(requireRoot(), payload, (p) => e.sender.send('instances:createProgress', p))
  )

  // ---- Bedrock crossplay (Geyser) ----
  ipcMain.handle('bedrock:status', (_e, id: string) => getBedrockStatus(requireRoot(), id))
  ipcMain.handle('bedrock:install', (_e, id: string) => installBedrock(requireRoot(), id))

  // ---- Worlds ----
  ipcMain.handle('worlds:list', (_e, id: string) => listWorlds(requireRoot(), id))
  ipcMain.handle('worlds:setActive', (_e, id: string, name: string) =>
    setActiveWorld(requireRoot(), id, name)
  )
  ipcMain.handle('worlds:delete', (_e, id: string, name: string) => {
    if (servers.isRunning(id)) throw new Error('Stop the server before deleting a world.')
    return deleteWorld(requireRoot(), id, name)
  })
  ipcMain.handle('worlds:regenerate', (_e, id: string, name: string, seed: string) => {
    if (servers.isRunning(id)) throw new Error('Stop the server before regenerating a world.')
    return regenerateWorld(requireRoot(), id, name, seed)
  })
  ipcMain.handle('worlds:export', async (_e, id: string, name: string): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Export world',
      defaultPath: `${name}.zip`,
      filters: [{ name: 'World archive', extensions: ['zip'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    exportWorld(requireRoot(), id, name, result.filePath)
    return result.filePath
  })
  ipcMain.handle('worlds:import', async (_e, id: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Import world',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'World archive', extensions: ['zip', 'tar.gz', 'tgz'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return importWorld(requireRoot(), id, result.filePaths[0])
  })
  ipcMain.handle('worlds:addDatapacks', async (_e, id: string, world: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Add datapacks',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Datapack', extensions: ['zip'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return addDatapacks(requireRoot(), id, world, result.filePaths)
  })
  ipcMain.handle('worlds:deleteDatapack', (_e, id: string, world: string, name: string) =>
    deleteDatapack(requireRoot(), id, world, name)
  )

  // ---- Dev-project link ----
  ipcMain.handle('devlink:detect', (_e, projectPath: string) => detectBuildSystem(projectPath))
  ipcMain.handle('devlink:deploy', (_e, id: string) => deployNow(requireRoot(), id))

  // ---- Compatibility runs (test matrix CI) ----
  ipcMain.handle('compat:start', (_e, instanceIds: string[], opts: CompatRunOptions) =>
    startCompatRun(requireRoot(), instanceIds, opts)
  )
  ipcMain.handle('compat:cancel', () => cancelCompatRun())
  ipcMain.handle('compat:get', () => getCompatRun())

  // ---- Pterodactyl panel (remote servers) ----
  ipcMain.handle('ptero:status', () => ptero.status())
  ipcMain.handle('ptero:connect', (_e, panelUrl: string, apiKey: string) =>
    ptero.connect(panelUrl, apiKey)
  )
  ipcMain.handle('ptero:disconnect', () => {
    closeAllConsoles()
    ptero.disconnect()
  })
  ipcMain.handle('ptero:listServers', () => ptero.listServers())
  ipcMain.handle('ptero:resources', (_e, serverId: string) => ptero.resources(serverId))
  ipcMain.handle('ptero:power', (_e, serverId: string, action: PteroPowerAction) =>
    ptero.power(serverId, action)
  )
  ipcMain.handle('ptero:command', (_e, serverId: string, command: string) => {
    // Prefer the live socket (echoes into the console immediately); HTTP fallback.
    if (!sendViaConsole(serverId, command)) return ptero.sendCommand(serverId, command)
    return undefined
  })
  ipcMain.handle('ptero:openConsole', (_e, serverId: string) => openConsole(serverId))
  ipcMain.handle('ptero:closeConsole', (_e, serverId: string) => closeConsole(serverId))

  // Remote files
  ipcMain.handle('ptero:listFiles', (_e, serverId: string, dir: string) =>
    ptero.listFiles(serverId, dir)
  )
  ipcMain.handle('ptero:readFile', (_e, serverId: string, path: string) =>
    ptero.readFile(serverId, path)
  )
  ipcMain.handle('ptero:writeFile', (_e, serverId: string, path: string, content: string) =>
    ptero.writeFile(serverId, path, content)
  )
  ipcMain.handle('ptero:renameFile', (_e, serverId: string, dir: string, from: string, to: string) =>
    ptero.renameFile(serverId, dir, from, to)
  )
  ipcMain.handle('ptero:deleteFiles', (_e, serverId: string, dir: string, names: string[]) =>
    ptero.deleteFiles(serverId, dir, names)
  )
  ipcMain.handle('ptero:createFolder', (_e, serverId: string, dir: string, name: string) =>
    ptero.createFolder(serverId, dir, name)
  )
  ipcMain.handle('ptero:downloadFile', async (_e, serverId: string, path: string) => {
    await shell.openExternal(await ptero.fileDownloadUrl(serverId, path))
  })
  ipcMain.handle('ptero:uploadFiles', async (_e, serverId: string, dir: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Upload files to the server',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    await ptero.uploadFiles(serverId, dir, result.filePaths)
    return ptero.listFiles(serverId, dir)
  })

  // Remote backups
  ipcMain.handle('ptero:listBackups', (_e, serverId: string) => ptero.listBackups(serverId))
  ipcMain.handle('ptero:createBackup', async (_e, serverId: string) => {
    await ptero.createBackup(serverId)
    return ptero.listBackups(serverId)
  })
  ipcMain.handle('ptero:restoreBackup', (_e, serverId: string, uuid: string) =>
    ptero.restoreBackup(serverId, uuid)
  )
  ipcMain.handle('ptero:deleteBackup', async (_e, serverId: string, uuid: string) => {
    await ptero.deleteBackup(serverId, uuid)
    return ptero.listBackups(serverId)
  })
  ipcMain.handle('ptero:downloadBackup', async (_e, serverId: string, uuid: string) => {
    await shell.openExternal(await ptero.backupDownloadUrl(serverId, uuid))
  })

  // Clone a remote server into a local instance (one at a time, cancellable).
  // Progress goes over its own channel so it can't cross-talk with the create wizard.
  let cloneAbort: AbortController | null = null
  ipcMain.handle('ptero:clonePrepare', (_e, serverId: string) => prepareClone(serverId))
  ipcMain.handle('ptero:clone', async (e, payload: PteroClonePayload) => {
    const controller = new AbortController()
    cloneAbort = controller
    try {
      return await clonePanelServer(
        requireRoot(),
        payload,
        (p) => e.sender.send('ptero:cloneProgress', p),
        controller.signal
      )
    } finally {
      if (cloneAbort === controller) cloneAbort = null
    }
  })
  ipcMain.handle('ptero:cloneCancel', () => cloneAbort?.abort())

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
