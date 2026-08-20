import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  BirdflopApi,
  BotsStatusEvent,
  CompatRun,
  InstallProgress,
  JavaProgress,
  ManagerIndex,
  PluginInfo,
  PteroOutputEvent,
  PteroStateEvent,
  PteroStatsEvent,
  ServerDiagnosisEvent,
  ServerOutputEvent,
  ServerPerfEvent,
  ServerStatsEvent,
  ServerStatusEvent,
  TunnelStatusEvent,
  UpdateStatus
} from '@shared/types'

/**
 * The typed API surface exposed to the renderer as `window.api`.
 * Grows as features are added in later phases.
 */
const api: BirdflopApi = {
  ping: () => ipcRenderer.invoke('ping'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setTheme: (theme) => ipcRenderer.invoke('config:setTheme', theme),
  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  setRoot: (path) => ipcRenderer.invoke('app:setRoot', path),
  getIndex: () => ipcRenderer.invoke('index:get'),
  onIndexChanged: (cb) => {
    const listener = (_e: unknown, index: ManagerIndex): void => cb(index)
    ipcRenderer.on('index:changed', listener)
    return () => ipcRenderer.removeListener('index:changed', listener)
  },
  createGroup: (name) => ipcRenderer.invoke('groups:create', name),
  renameGroup: (id, name) => ipcRenderer.invoke('groups:rename', id, name),
  deleteGroup: (id) => ipcRenderer.invoke('groups:delete', id),
  setGroupExpanded: (id, expanded) => ipcRenderer.invoke('groups:setExpanded', id, expanded),
  moveInstance: (id, groupId, beforeId) =>
    ipcRenderer.invoke('instances:move', id, groupId, beforeId),

  getGameVersions: (type) => ipcRenderer.invoke('software:gameVersions', type),
  getBuilds: (type, mc) => ipcRenderer.invoke('software:builds', type, mc),

  listJava: () => ipcRenderer.invoke('java:list'),
  refreshJava: () => ipcRenderer.invoke('java:refresh'),
  requiredJava: (mc) => ipcRenderer.invoke('java:requirement', mc),
  ensureJava: (major) => ipcRenderer.invoke('java:ensure', major),
  onJavaProgress: (cb) => {
    const listener = (_e: unknown, p: JavaProgress): void => cb(p)
    ipcRenderer.on('java:progress', listener)
    return () => ipcRenderer.removeListener('java:progress', listener)
  },

  createInstance: (payload) => ipcRenderer.invoke('instances:create', payload),
  onInstallProgress: (cb) => {
    const listener = (_e: unknown, p: InstallProgress): void => cb(p)
    ipcRenderer.on('instances:createProgress', listener)
    return () => ipcRenderer.removeListener('instances:createProgress', listener)
  },
  getInstance: (id) => ipcRenderer.invoke('instances:get', id),
  listInstances: () => ipcRenderer.invoke('instances:listAll'),
  updateInstance: (id, patch) => ipcRenderer.invoke('instances:update', id, patch),
  deleteInstance: (id) => ipcRenderer.invoke('instances:delete', id),
  openInstanceFolder: (id, relPath) => ipcRenderer.invoke('instances:openFolder', id, relPath),
  instanceLocation: (id) => ipcRenderer.invoke('instances:location', id),
  relocateInstance: (id, dest) => ipcRenderer.invoke('instances:relocate', id, dest),
  cloneInstance: (id) => ipcRenderer.invoke('instances:clone', id),
  getProxyBackends: (id) => ipcRenderer.invoke('proxy:getBackends', id),
  setProxyBackends: (id, backends) => ipcRenderer.invoke('proxy:setBackends', id, backends),
  importInstance: (payload) => ipcRenderer.invoke('instances:import', payload),
  listFolderJars: (path) => ipcRenderer.invoke('instances:listFolderJars', path),
  launchPreview: (id, patch) => ipcRenderer.invoke('instances:launchPreview', id, patch),
  pickModpack: () => ipcRenderer.invoke('dialog:pickModpack'),
  importModpack: (payload) => ipcRenderer.invoke('instances:importModpack', payload),
  setupVelocityForwarding: (id) => ipcRenderer.invoke('proxy:setupForwarding', id),
  exportRecipe: (id) => ipcRenderer.invoke('recipes:export', id),
  pickRecipe: () => ipcRenderer.invoke('recipes:pick'),
  importRecipe: (payload) => ipcRenderer.invoke('recipes:import', payload),
  listBackups: (id) => ipcRenderer.invoke('backups:list', id),
  createBackup: (id) => ipcRenderer.invoke('backups:create', id),
  restoreBackup: (id, name) => ipcRenderer.invoke('backups:restore', id, name),
  deleteBackup: (id, name) => ipcRenderer.invoke('backups:delete', id, name),

  startServer: (id) => ipcRenderer.invoke('server:start', id),
  stopServer: (id) => ipcRenderer.invoke('server:stop', id),
  restartServer: (id) => ipcRenderer.invoke('server:restart', id),
  sendCommand: (id, command) => ipcRenderer.invoke('server:command', id, command),
  serverStatus: (id) => ipcRenderer.invoke('server:status', id),
  serverBuffer: (id) => ipcRenderer.invoke('server:buffer', id),
  runningServers: () => ipcRenderer.invoke('server:running'),
  onServerOutput: (cb) => {
    const listener = (_e: unknown, ev: ServerOutputEvent): void => cb(ev)
    ipcRenderer.on('server:output', listener)
    return () => ipcRenderer.removeListener('server:output', listener)
  },
  onServerStatus: (cb) => {
    const listener = (_e: unknown, ev: ServerStatusEvent): void => cb(ev)
    ipcRenderer.on('server:status', listener)
    return () => ipcRenderer.removeListener('server:status', listener)
  },
  onServerStats: (cb) => {
    const listener = (_e: unknown, ev: ServerStatsEvent): void => cb(ev)
    ipcRenderer.on('server:stats', listener)
    return () => ipcRenderer.removeListener('server:stats', listener)
  },
  onServerPerf: (cb) => {
    const listener = (_e: unknown, ev: ServerPerfEvent): void => cb(ev)
    ipcRenderer.on('server:perf', listener)
    return () => ipcRenderer.removeListener('server:perf', listener)
  },
  getBots: (id) => ipcRenderer.invoke('bots:get', id),
  startBots: (id, opts) => ipcRenderer.invoke('bots:start', id, opts),
  stopBots: (id) => ipcRenderer.invoke('bots:stop', id),
  onBotsStatus: (cb) => {
    const listener = (_e: unknown, ev: BotsStatusEvent): void => cb(ev)
    ipcRenderer.on('bots:status', listener)
    return () => ipcRenderer.removeListener('bots:status', listener)
  },

  listContentSources: (id) => ipcRenderer.invoke('content:sources', id),
  listContent: (id) => ipcRenderer.invoke('content:list', id),
  addContentFiles: (id, paths) => ipcRenderer.invoke('content:add', id, paths),
  deleteContentFile: (id, name) => ipcRenderer.invoke('content:delete', id, name),
  searchContent: (id, source, query) => ipcRenderer.invoke('content:search', id, source, query),
  installContent: (id, source, projectId) =>
    ipcRenderer.invoke('content:install', id, source, projectId),
  checkContentUpdates: (id) => ipcRenderer.invoke('content:checkUpdates', id),
  updateContent: (id, name) => ipcRenderer.invoke('content:update', id, name),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  listFiles: (id, relPath) => ipcRenderer.invoke('files:list', id, relPath),
  listFilesDeep: (id) => ipcRenderer.invoke('files:listDeep', id),
  readFile: (id, relPath) => ipcRenderer.invoke('files:read', id, relPath),
  writeFile: (id, relPath, content) => ipcRenderer.invoke('files:write', id, relPath, content),
  detectEditors: () => ipcRenderer.invoke('files:detectEditors'),
  openInEditor: (id, editorId, relPath) =>
    ipcRenderer.invoke('files:openInEditor', id, editorId, relPath),
  getServerProperties: (id) => ipcRenderer.invoke('properties:get', id),
  setServerProperties: (id, kv) => ipcRenderer.invoke('properties:set', id, kv),

  clearServerBuffer: (id) => ipcRenderer.invoke('server:clearBuffer', id),
  saveServerLog: (id) => ipcRenderer.invoke('server:saveLog', id),
  onServerDiagnosis: (cb) => {
    const listener = (_e: unknown, ev: ServerDiagnosisEvent): void => cb(ev)
    ipcRenderer.on('server:diagnosis', listener)
    return () => ipcRenderer.removeListener('server:diagnosis', listener)
  },
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),

  listTunnelProviders: () => ipcRenderer.invoke('tunnel:providers'),
  getTunnel: (id) => ipcRenderer.invoke('tunnel:get', id),
  startTunnel: (id, provider) => ipcRenderer.invoke('tunnel:start', id, provider),
  stopTunnel: (id) => ipcRenderer.invoke('tunnel:stop', id),
  onTunnelStatus: (cb) => {
    const listener = (_e: unknown, ev: TunnelStatusEvent): void => cb(ev)
    ipcRenderer.on('tunnel:status', listener)
    return () => ipcRenderer.removeListener('tunnel:status', listener)
  },
  getShareSafety: (id) => ipcRenderer.invoke('tunnel:safety', id),
  applyShareSafetyFix: (id, fix) => ipcRenderer.invoke('tunnel:fixSafety', id, fix),
  getBedrockStatus: (id) => ipcRenderer.invoke('bedrock:status', id),
  installBedrock: (id) => ipcRenderer.invoke('bedrock:install', id),

  listWorlds: (id) => ipcRenderer.invoke('worlds:list', id),
  setActiveWorld: (id, name) => ipcRenderer.invoke('worlds:setActive', id, name),
  deleteWorld: (id, name) => ipcRenderer.invoke('worlds:delete', id, name),
  regenerateWorld: (id, name, seed) => ipcRenderer.invoke('worlds:regenerate', id, name, seed),
  exportWorld: (id, name) => ipcRenderer.invoke('worlds:export', id, name),
  importWorld: (id) => ipcRenderer.invoke('worlds:import', id),
  addDatapacks: (id, world) => ipcRenderer.invoke('worlds:addDatapacks', id, world),
  deleteDatapack: (id, world, name) => ipcRenderer.invoke('worlds:deleteDatapack', id, world, name),

  detectBuildSystem: (projectPath) => ipcRenderer.invoke('devlink:detect', projectPath),
  deployDevLink: (id) => ipcRenderer.invoke('devlink:deploy', id),

  startCompatRun: (instanceIds, opts) => ipcRenderer.invoke('compat:start', instanceIds, opts),
  cancelCompatRun: () => ipcRenderer.invoke('compat:cancel'),
  getCompatRun: () => ipcRenderer.invoke('compat:get'),
  onCompatProgress: (cb) => {
    const listener = (_e: unknown, run: CompatRun): void => cb(run)
    ipcRenderer.on('compat:progress', listener)
    return () => ipcRenderer.removeListener('compat:progress', listener)
  },

  pteroStatus: () => ipcRenderer.invoke('ptero:status'),
  pteroConnect: (panelUrl, apiKey) => ipcRenderer.invoke('ptero:connect', panelUrl, apiKey),
  pteroDisconnect: () => ipcRenderer.invoke('ptero:disconnect'),
  pteroListServers: () => ipcRenderer.invoke('ptero:listServers'),
  pteroResources: (serverId) => ipcRenderer.invoke('ptero:resources', serverId),
  pteroPower: (serverId, action) => ipcRenderer.invoke('ptero:power', serverId, action),
  pteroSendCommand: (serverId, command) => ipcRenderer.invoke('ptero:command', serverId, command),
  pteroOpenConsole: (serverId) => ipcRenderer.invoke('ptero:openConsole', serverId),
  pteroCloseConsole: (serverId) => ipcRenderer.invoke('ptero:closeConsole', serverId),
  onPteroOutput: (cb) => {
    const listener = (_e: unknown, ev: PteroOutputEvent): void => cb(ev)
    ipcRenderer.on('ptero:output', listener)
    return () => ipcRenderer.removeListener('ptero:output', listener)
  },
  onPteroState: (cb) => {
    const listener = (_e: unknown, ev: PteroStateEvent): void => cb(ev)
    ipcRenderer.on('ptero:state', listener)
    return () => ipcRenderer.removeListener('ptero:state', listener)
  },
  onPteroStats: (cb) => {
    const listener = (_e: unknown, ev: PteroStatsEvent): void => cb(ev)
    ipcRenderer.on('ptero:stats', listener)
    return () => ipcRenderer.removeListener('ptero:stats', listener)
  },
  pteroListFiles: (serverId, dir) => ipcRenderer.invoke('ptero:listFiles', serverId, dir),
  pteroReadFile: (serverId, path) => ipcRenderer.invoke('ptero:readFile', serverId, path),
  pteroWriteFile: (serverId, path, content) =>
    ipcRenderer.invoke('ptero:writeFile', serverId, path, content),
  pteroRenameFile: (serverId, dir, from, to) =>
    ipcRenderer.invoke('ptero:renameFile', serverId, dir, from, to),
  pteroDeleteFiles: (serverId, dir, names) =>
    ipcRenderer.invoke('ptero:deleteFiles', serverId, dir, names),
  pteroCreateFolder: (serverId, dir, name) =>
    ipcRenderer.invoke('ptero:createFolder', serverId, dir, name),
  pteroDownloadFile: (serverId, path) => ipcRenderer.invoke('ptero:downloadFile', serverId, path),
  pteroUploadFiles: (serverId, dir) => ipcRenderer.invoke('ptero:uploadFiles', serverId, dir),
  pteroListBackups: (serverId) => ipcRenderer.invoke('ptero:listBackups', serverId),
  pteroCreateBackup: (serverId) => ipcRenderer.invoke('ptero:createBackup', serverId),
  pteroRestoreBackup: (serverId, uuid) => ipcRenderer.invoke('ptero:restoreBackup', serverId, uuid),
  pteroDeleteBackup: (serverId, uuid) => ipcRenderer.invoke('ptero:deleteBackup', serverId, uuid),
  pteroDownloadBackup: (serverId, uuid) =>
    ipcRenderer.invoke('ptero:downloadBackup', serverId, uuid),
  pteroClonePrepare: (serverId) => ipcRenderer.invoke('ptero:clonePrepare', serverId),
  pteroCloneServer: (payload) => ipcRenderer.invoke('ptero:clone', payload),
  pteroCloneCancel: () => ipcRenderer.invoke('ptero:cloneCancel'),
  onPteroCloneProgress: (cb) => {
    const listener = (_e: unknown, p: InstallProgress): void => cb(p)
    ipcRenderer.on('ptero:cloneProgress', listener)
    return () => ipcRenderer.removeListener('ptero:cloneProgress', listener)
  },

  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', id, enabled),
  reloadPlugins: () => ipcRenderer.invoke('plugins:reload'),
  openPluginsFolder: () => ipcRenderer.invoke('plugins:openFolder'),
  openPluginLog: (id) => ipcRenderer.invoke('plugins:openLog', id),
  onPluginsChanged: (cb) => {
    const listener = (_e: unknown, plugins: PluginInfo[]): void => cb(plugins)
    ipcRenderer.on('plugins:changed', listener)
    return () => ipcRenderer.removeListener('plugins:changed', listener)
  },
  invokePlugin: (id, verb, ...args) => ipcRenderer.invoke(`plugin:${id}:${verb}`, ...args),
  onPluginEvent: (id, event, cb) => {
    const channel = `plugin:${id}:${event}`
    const listener = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getUpdateStatus: () => ipcRenderer.invoke('updater:status'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateStatus: (cb) => {
    const listener = (_e: unknown, s: UpdateStatus): void => cb(s)
    ipcRenderer.on('updater:status', listener)
    return () => ipcRenderer.removeListener('updater:status', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[preload] failed to expose api', error)
  }
} else {
  // Fallback for the (unused) non-isolated case.
  // @ts-expect-error attach to window directly
  window.api = api
}
