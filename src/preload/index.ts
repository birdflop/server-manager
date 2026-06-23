import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  BirdflopApi,
  InstallProgress,
  JavaProgress,
  ServerDiagnosisEvent,
  ServerOutputEvent,
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
  createGroup: (name) => ipcRenderer.invoke('groups:create', name),
  renameGroup: (id, name) => ipcRenderer.invoke('groups:rename', id, name),
  deleteGroup: (id) => ipcRenderer.invoke('groups:delete', id),
  setGroupExpanded: (id, expanded) => ipcRenderer.invoke('groups:setExpanded', id, expanded),
  moveInstance: (id, groupId, beforeId) =>
    ipcRenderer.invoke('instances:move', id, groupId, beforeId),

  getGameVersions: (type) => ipcRenderer.invoke('software:gameVersions', type),
  getBuilds: (type, mc) => ipcRenderer.invoke('software:builds', type, mc),

  listJava: () => ipcRenderer.invoke('java:list'),
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
  openInstanceFolder: (id) => ipcRenderer.invoke('instances:openFolder', id),
  cloneInstance: (id) => ipcRenderer.invoke('instances:clone', id),
  getProxyBackends: (id) => ipcRenderer.invoke('proxy:getBackends', id),
  setProxyBackends: (id, backends) => ipcRenderer.invoke('proxy:setBackends', id, backends),
  importInstance: (payload) => ipcRenderer.invoke('instances:import', payload),
  listFolderJars: (path) => ipcRenderer.invoke('instances:listFolderJars', path),
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
  readFile: (id, relPath) => ipcRenderer.invoke('files:read', id, relPath),
  writeFile: (id, relPath, content) => ipcRenderer.invoke('files:write', id, relPath, content),
  detectEditors: () => ipcRenderer.invoke('files:detectEditors'),
  openInEditor: (id, editorId, relPath) =>
    ipcRenderer.invoke('files:openInEditor', id, editorId, relPath),

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
