import { create } from 'zustand'
import type {
  AppConfig,
  ManagerIndex,
  ServerStatus,
  ThemeName,
  UpdateStatus
} from '@shared/types'

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
}

interface AppState {
  loading: boolean
  config: AppConfig | null
  index: ManagerIndex

  /** Instance ids currently open as tabs, in display order. */
  openTabs: string[]
  /** Active tab instance id, or null to show the dashboard. */
  activeTabId: string | null
  /** Live run status per instance id. */
  status: Record<string, ServerStatus>
  /** Live CPU/RAM per running instance id. */
  stats: Record<string, { cpu: number; memMB: number }>

  // lifecycle
  init: () => Promise<void>
  setTheme: (theme: ThemeName) => Promise<void>
  toggleTheme: () => Promise<void>
  chooseRoot: () => Promise<boolean>
  refreshIndex: () => Promise<void>

  // groups
  createGroup: (name: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  toggleGroup: (id: string, expanded: boolean) => Promise<void>
  moveInstance: (id: string, groupId: string | null, beforeId?: string | null) => Promise<void>

  // tabs
  openTab: (id: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string | null) => void

  // create-instance wizard
  wizardOpen: boolean
  openWizard: () => void
  closeWizard: () => void

  // import + app settings modals
  importOpen: boolean
  openImport: () => void
  closeImport: () => void
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void

  /** Merge + persist app config (applies theme immediately if changed). */
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>
  /** Duplicate an instance and open it as a tab. */
  cloneInstance: (id: string) => Promise<void>
  /** Rename an instance (updates instance.json + index). */
  renameInstance: (id: string, name: string) => Promise<void>
  /** Delete an instance (folder + index) and close its tab. */
  removeInstance: (id: string) => Promise<void>

  // app + updater
  appVersion: string
  update: UpdateStatus
  updateModalOpen: boolean
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  openUpdateModal: () => void
  closeUpdateModal: () => void
}

export const useApp = create<AppState>((set, get) => ({
  loading: true,
  config: null,
  index: { groups: [], instances: [] },
  openTabs: [],
  activeTabId: null,
  status: {},
  stats: {},

  init: async () => {
    const config = await window.api.getConfig()
    applyTheme(config.theme)
    const index = config.rootPath ? await window.api.getIndex() : { groups: [], instances: [] }
    const status: Record<string, ServerStatus> = {}
    if (config.rootPath) {
      for (const id of await window.api.runningServers()) status[id] = 'running'
    }
    // Keep status + stats live for the app lifetime.
    window.api.onServerStatus((e) =>
      set((s) => {
        const stats = { ...s.stats }
        if (e.status === 'stopped') delete stats[e.id]
        return { status: { ...s.status, [e.id]: e.status }, stats }
      })
    )
    window.api.onServerStats((e) =>
      set((s) => ({ stats: { ...s.stats, [e.id]: { cpu: e.cpu, memMB: e.memMB } } }))
    )
    // Auto-update status + app version.
    window.api.onUpdateStatus((u) =>
      set((s) => ({ update: u, updateModalOpen: u.state === 'downloaded' ? true : s.updateModalOpen }))
    )
    const [appVersion, update] = await Promise.all([
      window.api.getAppVersion(),
      window.api.getUpdateStatus()
    ])
    set({ config, index, status, appVersion, update, loading: false })
  },

  setTheme: async (theme) => {
    applyTheme(theme)
    set((s) => ({ config: s.config ? { ...s.config, theme } : s.config }))
    await window.api.setTheme(theme)
  },

  toggleTheme: async () => {
    const current = get().config?.theme ?? 'dark'
    await get().setTheme(current === 'dark' ? 'light' : 'dark')
  },

  chooseRoot: async () => {
    const dir = await window.api.pickDirectory()
    if (!dir) return false
    const index = await window.api.setRoot(dir)
    set((s) => ({ config: s.config ? { ...s.config, rootPath: dir } : s.config, index }))
    return true
  },

  refreshIndex: async () => {
    set({ index: await window.api.getIndex() })
  },

  createGroup: async (name) => set({ index: await window.api.createGroup(name) }),
  renameGroup: async (id, name) => set({ index: await window.api.renameGroup(id, name) }),
  deleteGroup: async (id) => set({ index: await window.api.deleteGroup(id) }),
  toggleGroup: async (id, expanded) =>
    set({ index: await window.api.setGroupExpanded(id, expanded) }),
  moveInstance: async (id, groupId, beforeId) =>
    set({ index: await window.api.moveInstance(id, groupId, beforeId) }),

  openTab: (id) =>
    set((s) => ({
      openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
      activeTabId: id
    })),

  closeTab: (id) =>
    set((s) => {
      const openTabs = s.openTabs.filter((t) => t !== id)
      let activeTabId = s.activeTabId
      if (activeTabId === id) {
        const idx = s.openTabs.indexOf(id)
        activeTabId = openTabs[idx] ?? openTabs[idx - 1] ?? null
      }
      return { openTabs, activeTabId }
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  wizardOpen: false,
  openWizard: () => set({ wizardOpen: true }),
  closeWizard: () => set({ wizardOpen: false }),

  importOpen: false,
  openImport: () => set({ importOpen: true }),
  closeImport: () => set({ importOpen: false }),
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  updateConfig: async (patch) => {
    const config = await window.api.updateConfig(patch)
    if (patch.theme) applyTheme(patch.theme)
    set({ config })
  },

  cloneInstance: async (id) => {
    const result = await window.api.cloneInstance(id)
    if (result) {
      set({ index: result.index })
      get().openTab(result.instance.id)
    }
  },

  renameInstance: async (id, name) => {
    await window.api.updateInstance(id, { name })
    await get().refreshIndex()
  },

  removeInstance: async (id) => {
    const index = await window.api.deleteInstance(id)
    set({ index })
    get().closeTab(id)
  },

  appVersion: '',
  update: { state: 'idle' },
  updateModalOpen: false,
  checkForUpdates: async () => {
    await window.api.checkForUpdates()
  },
  downloadUpdate: async () => {
    await window.api.downloadUpdate()
  },
  installUpdate: async () => {
    await window.api.installUpdate()
  },
  openUpdateModal: () => set({ updateModalOpen: true }),
  closeUpdateModal: () => set({ updateModalOpen: false })
}))

// Exposed for dev tooling / screenshot automation.
;(window as unknown as { __bsmStore?: typeof useApp }).__bsmStore = useApp
