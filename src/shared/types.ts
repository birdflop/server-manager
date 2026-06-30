// Shared types used across main, preload, and renderer.

export type ServerType =
  | 'paper'
  | 'folia'
  | 'purpur'
  | 'fabric'
  | 'quilt'
  | 'forge'
  | 'neoforge'
  | 'vanilla'
  // Proxies (route players between backend servers; not a Minecraft server themselves).
  | 'velocity'
  | 'waterfall'
  | 'bungeecord'

/** Broad grouping of a server type: a runnable Minecraft server vs a proxy. */
export type ServerCategory = 'server' | 'proxy'

/** What the per-type content folder is called (plugins vs mods). */
export type ContentKind = 'plugins' | 'mods' | 'none'

export type ThemeName = 'dark' | 'light'

/** A reusable console command shortcut, shown as a one-click button in the console. */
export interface ConsoleMacro {
  /** Button text (e.g. "Save"). */
  label: string
  /** Command sent to the server when clicked (e.g. "save-all"). */
  command: string
}

/** A saved server-creation preset that pre-fills the create wizard. */
export interface InstanceTemplate {
  id: string
  name: string
  serverType: ServerType
  mcVersion: string
  build: string
  ramMB: number
  jvmArgs: string[]
}

/** Lightweight entry stored in the manager index for the sidebar. */
export interface InstanceMeta {
  id: string
  name: string
  groupId: string | null
  order: number
}

/** A collapsible organizational folder in the sidebar. */
export interface Group {
  id: string
  name: string
  expanded: boolean
  order: number
}

/** Full per-instance config persisted at <root>/instances/<id>/instance.json. */
export interface Instance {
  id: string
  name: string
  serverType: ServerType
  mcVersion: string
  build: string
  /** How to launch: a runnable jar, or args-files produced by an installer. */
  launchKind: 'jar' | 'args-file'
  /** For launchKind=jar: the jar filename to run (e.g. server.jar). */
  launchJar?: string
  port: number
  ramMB: number
  javaPath: string
  jvmArgs: string[]
  eulaAccepted: boolean
  createdAt: number
  /** For proxies only: the backend servers this proxy routes to. */
  backends?: ProxyBackend[]
  /** Auto-restart-on-file-change config (undefined = disabled). */
  watch?: WatchConfig
  /** Tunnel/share preferences (undefined = never configured). */
  tunnel?: TunnelConfig
  /** Remote JVM debugging (JDWP) config (undefined = disabled). */
  debug?: DebugConfig
}

/** What the file watcher does when a watched path changes. */
export type WatchAction = 'restart' | 'command'

/**
 * Per-instance auto-restart-on-file-change config. When enabled and the server is
 * running, changes to any watched path trigger the configured action (debounced).
 */
export interface WatchConfig {
  enabled: boolean
  /** Files or folders to watch, relative to the instance dir (e.g. "plugins", "server.properties"). */
  paths: string[]
  /**
   * When watching a folder, only react to files with these extensions (lowercase, no dot,
   * e.g. ["jar"]). Empty = react to any file. Ignored for directly-watched files.
   */
  extensions: string[]
  /** What to do on a change: full restart, or send a console command (e.g. "reload confirm"). */
  action: WatchAction
  /** For action='command': the console command to send. */
  command?: string
  /** How long to wait after the last change before acting, in milliseconds. */
  debounceMs: number
}

/** Default watcher config for a freshly-enabled watcher (paths/extensions filled per server type by the UI). */
export const DEFAULT_WATCH: WatchConfig = {
  enabled: false,
  paths: [],
  extensions: ['jar'],
  action: 'restart',
  debounceMs: 1000
}

/**
 * Remote JVM debugging (JDWP) config for a server. When enabled, the server is launched with a
 * `-agentlib:jdwp` agent so an IDE (IntelliJ / VS Code) can attach to `localhost:<port>`.
 */
export interface DebugConfig {
  enabled: boolean
  /** TCP port the JDWP agent listens on for debugger connections. */
  port: number
  /** Suspend the JVM at startup until a debugger attaches (for debugging early init). */
  suspend: boolean
}

/** Default remote-debug config for a freshly-enabled debugger. */
export const DEFAULT_DEBUG: DebugConfig = { enabled: false, port: 5005, suspend: false }

/** A backend server a proxy forwards players to. */
export interface ProxyBackend {
  /** Name used in the proxy config (sanitized to a valid identifier). */
  name: string
  /** host:port the proxy connects to. */
  address: string
  /** The managed instance this points at, if any (used for live status + auto-fill). */
  instanceId?: string
}

/** Index file persisted at <root>/birdflop-manager.json. */
export interface ManagerIndex {
  groups: Group[]
  instances: InstanceMeta[]
}

/** Runtime status of a server process. */
export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping'

/** A plugin/mod file installed in a server's content folder. */
export interface ContentFile {
  name: string
  size: number
}

/** Install provenance recorded per content file so we can check for updates later. */
export interface ContentMeta {
  source: ContentSource
  projectId: string
  /** Source-specific id of the installed version. */
  versionId: string
  /** Human-readable version (e.g. "1.2.3"), when available. */
  versionNumber?: string
}

/** A content file with a newer version available from its source. */
export interface ContentUpdate {
  name: string
  source: ContentSource
  projectId: string
  currentVersion?: string
  latestVersion?: string
}

/** Where plugins/mods can be searched + installed from. */
export type ContentSource = 'modrinth' | 'hangar' | 'spigot'

/** A unified search result across content sources (Modrinth, Hangar, SpigotMC). */
export interface ContentSearchHit {
  source: ContentSource
  /** Source-specific project id: modrinth project id, hangar "owner/slug", spigot resource id. */
  id: string
  title: string
  description: string
  iconUrl?: string
  downloads: number
  author?: string
  /** SpigotMC: the file is hosted off-site and can't be downloaded directly. */
  external?: boolean
  /** Page to open when the item can't be installed directly. */
  pageUrl?: string
}

/** A single entry (file or folder) inside an instance's directory tree. */
export interface FileEntry {
  /** Base name of the entry. */
  name: string
  /** POSIX-style path relative to the instance root (e.g. "config/paper.yml"). */
  path: string
  isDir: boolean
  /** Size in bytes (0 for directories). */
  size: number
  mtimeMs: number
}

/** Result of reading a file for the built-in editor. */
export type FileReadResult =
  | { ok: true; content: string; size: number }
  | { ok: false; reason: 'binary' | 'too-large' | 'missing' | 'error'; size: number }

/** A text editor detected on the machine that can open a server folder. */
export interface DetectedEditor {
  /** Stable identifier used when launching (e.g. "vscode", "cursor"). */
  id: string
  /** Display name (e.g. "VS Code"). */
  name: string
}

/** Update channel the app follows: vetted stable releases or bleeding-edge dev builds. */
export type ReleaseChannel = 'stable' | 'dev'

/** State of the in-app auto-updater. */
export interface UpdateStatus {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'dev'
  version?: string
  percent?: number
  message?: string
}

/** A chunk of console output streamed from a running server. */
export interface ServerOutputEvent {
  id: string
  chunk: string
}

/** A status transition for a server process. */
export interface ServerStatusEvent {
  id: string
  status: ServerStatus
}

/** Live resource usage of a running server process. */
export interface ServerStatsEvent {
  id: string
  cpu: number
  memMB: number
}

/** A best-effort explanation emitted when a server exits abnormally. */
export interface ServerDiagnosisEvent {
  id: string
  code: number | null
  title: string
  hint: string
}

/** Services that can expose a local server to the public internet. */
export type TunnelProviderId = 'birdflop' | 'bore' | 'ngrok'

/** A persistent Birdflop tunnel identity (one per user, owns a subdomain). */
export interface BirdflopTunnelIdentity {
  /** Public subdomain, e.g. "a3k9zq" → a3k9zq.tunnel.birdflop.com. */
  subdomain: string
  /** Secret token proving ownership. Stored locally, never shared. */
  token: string
}

/** Lifecycle state of a server's tunnel. */
export type TunnelState = 'offline' | 'starting' | 'online' | 'error'

/** Live tunnel info for one instance. */
export interface TunnelInfo {
  provider: TunnelProviderId | null
  state: TunnelState
  /** Public address players connect to (e.g. "6.tcp.ngrok.io:18056"), when online. */
  publicAddress?: string
  /** Human-readable status / progress / error message. */
  message?: string
}

/** A tunnel status change broadcast for an instance (id = instance id). */
export interface TunnelStatusEvent extends TunnelInfo {
  id: string
}

/** Availability of a tunnel provider, for the provider picker. */
export interface TunnelProviderStatus {
  id: TunnelProviderId
  label: string
  /** Whether a tunnel can be started right now. */
  ready: boolean
  /** What's missing when not ready. */
  needs?: 'auth' | 'unavailable'
  /** Explanation shown in the UI (e.g. "Enter an ngrok auth token"). */
  message?: string
}

/** Per-instance tunnel preferences. */
export interface TunnelConfig {
  provider: TunnelProviderId
  /** Start the tunnel automatically when the server becomes ready (wired in a later phase). */
  autoStart: boolean
  /**
   * Optional Birdflop sub-label, e.g. "survival" → survival.<you>.tunnel.birdflop.com.
   * When unset, the server is exposed at the bare subdomain (distinguished by its port).
   */
  label?: string
}

/** A saved backup archive for an instance. */
export interface BackupInfo {
  name: string
  size: number
  createdAt: number
}

/** Payload for importing an existing server folder as a new instance. */
export interface ImportInstancePayload {
  sourcePath: string
  name: string
  serverType: ServerType
  mcVersion: string
  launchKind: 'jar' | 'args-file'
  launchJar?: string
  port: number
  ramMB: number
  javaPath: string
  jvmArgs: string[]
  groupId: string | null
}

/** Payload for importing a Modrinth modpack (.mrpack) as a new instance. */
export interface ModpackImportPayload {
  /** Absolute path to the .mrpack file on disk. */
  mrpackPath: string
  name: string
  ramMB: number
  javaPath: string
  eulaAccepted: boolean
  groupId: string | null
}

/** Outcome of wiring Velocity modern forwarding across a proxy's backends. */
export interface ForwardingResult {
  /** The shared forwarding secret that was written. */
  secret: string
  /** Managed backends that were configured for modern forwarding. */
  wired: string[]
  /** Backends that couldn't be auto-wired, with a reason. */
  skipped: { name: string; reason: string }[]
}

/** A selectable build/version of a given server software. */
export interface Build {
  id: string
  label: string
  channel?: string
}

/** A discovered Java runtime on the machine (or a managed download). */
export interface JavaInstall {
  path: string
  version: string
  major: number
  /** True if this JRE was downloaded + managed by the app. */
  managed?: boolean
}

/** Progress events emitted while downloading/extracting a managed Java runtime. */
export interface JavaProgress {
  major: number
  phase: 'download' | 'extract' | 'done' | 'error'
  received?: number
  total?: number
  message?: string
}

/** Payload sent from the create-instance wizard to actually build a server. */
export interface CreateInstancePayload {
  name: string
  serverType: ServerType
  mcVersion: string
  build: string
  port: number
  ramMB: number
  javaPath: string
  jvmArgs: string[]
  eulaAccepted: boolean
  groupId: string | null
}

/** Progress events emitted while creating/installing a server. */
export interface InstallProgress {
  phase: 'resolve' | 'download' | 'install' | 'configure' | 'done' | 'error'
  received?: number
  total?: number
  message?: string
}

/** App-wide configuration persisted in Electron userData (not the data root). */
export interface AppConfig {
  /** Root folder where all instances + the manager index live. Null until chosen. */
  rootPath: string | null
  theme: ThemeName
  /** Default memory (MB) prefilled in the create wizard. */
  defaultRamMB: number
  /** Default Java path prefilled in the create wizard (null = auto). */
  defaultJavaPath: string | null
  /** Whether to check for updates automatically on launch. */
  autoUpdate: boolean
  /** Which update channel to follow: 'stable' releases or 'dev' nightly prereleases. */
  releaseChannel: ReleaseChannel
  /** Show desktop notifications when a server becomes ready or crashes. */
  notifications: boolean
  /** Automatically restart a server that exits unexpectedly. */
  autoRestartOnCrash: boolean
  /** Hide to the system tray instead of quitting when the window is closed. */
  minimizeToTray: boolean
  /** ngrok auth token used by the tunnel/share feature (null = not set). */
  ngrokAuthToken: string | null
  /** Birdflop tunnel identity (one per user); null until first enrolled. */
  birdflopTunnel: BirdflopTunnelIdentity | null
  /** Reusable console command shortcuts, shown as buttons in every server's console. */
  consoleMacros: ConsoleMacro[]
  /** Saved server-creation presets offered in the create wizard. */
  templates: InstanceTemplate[]
}

/**
 * The API surface exposed to the renderer via the preload bridge as `window.api`.
 * Implemented in src/preload/index.ts and grows as features land.
 */
export interface BirdflopApi {
  ping(): Promise<string>
  /** Read the current app config (root path + theme). */
  getConfig(): Promise<AppConfig>
  /** Persist the chosen theme. */
  setTheme(theme: ThemeName): Promise<void>
  /** Merge + persist arbitrary app-config fields. */
  updateConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  /** Open a native directory picker; returns the chosen absolute path or null if cancelled. */
  pickDirectory(): Promise<string | null>
  /**
   * Set (and persist) the data root, initializing the folder + index if needed.
   * Returns the manager index for that root.
   */
  setRoot(path: string): Promise<ManagerIndex>
  /** Read the manager index (groups + instance list) from the current root. */
  getIndex(): Promise<ManagerIndex>

  // Groups
  createGroup(name: string): Promise<ManagerIndex>
  renameGroup(id: string, name: string): Promise<ManagerIndex>
  deleteGroup(id: string): Promise<ManagerIndex>
  setGroupExpanded(id: string, expanded: boolean): Promise<ManagerIndex>

  // Instance index
  /** Move an instance to a group (null = ungrouped), optionally before another instance. */
  moveInstance(id: string, groupId: string | null, beforeId?: string | null): Promise<ManagerIndex>

  // Software providers
  /** Supported Minecraft versions for a server type, newest first. */
  getGameVersions(type: ServerType): Promise<string[]>
  /** Builds available for a (type, version), newest first. */
  getBuilds(type: ServerType, mc: string): Promise<Build[]>

  // Java
  /** Detect Java runtimes installed on the machine (plus managed downloads). Cached per session. */
  listJava(): Promise<JavaInstall[]>
  /** Force a fresh Java rescan, bypassing the cache. */
  refreshJava(): Promise<JavaInstall[]>
  /** Recommended Java major version for a Minecraft version. */
  requiredJava(mc: string): Promise<number>
  /** Ensure a managed Temurin JRE for `major` exists (download if missing). */
  ensureJava(major: number): Promise<JavaInstall>
  /** Subscribe to Java download/extract progress. Returns an unsubscribe fn. */
  onJavaProgress(cb: (p: JavaProgress) => void): () => void

  // Instances
  /** Create + install a new server. Resolves once installed. */
  createInstance(payload: CreateInstancePayload): Promise<{ instance: Instance; index: ManagerIndex }>
  /** Subscribe to create/install progress. Returns an unsubscribe fn. */
  onInstallProgress(cb: (p: InstallProgress) => void): () => void
  /** Read a full instance's config (instance.json). */
  getInstance(id: string): Promise<Instance | null>
  /** Read every instance's full config (for the dashboard). */
  listInstances(): Promise<Instance[]>
  /** Apply editable settings (name, port, ram, java, jvm args). */
  updateInstance(
    id: string,
    patch: Partial<
      Pick<Instance, 'name' | 'port' | 'ramMB' | 'javaPath' | 'jvmArgs' | 'watch' | 'tunnel' | 'debug'>
    >
  ): Promise<{ instance: Instance; index: ManagerIndex } | null>
  /** Delete a server (folder + index entry). */
  deleteInstance(id: string): Promise<ManagerIndex>
  /** Open a folder inside the server (relPath, default the root) in the OS file manager. */
  openInstanceFolder(id: string, relPath?: string): Promise<void>
  /** Duplicate an instance (copies files, new id + bumped port). */
  cloneInstance(id: string): Promise<{ instance: Instance; index: ManagerIndex }>
  /** Read a proxy's configured backend servers. */
  getProxyBackends(id: string): Promise<ProxyBackend[]>
  /** Replace a proxy's backend servers (rewrites the proxy config). */
  setProxyBackends(id: string, backends: ProxyBackend[]): Promise<ProxyBackend[]>
  /** Import an existing server folder as a new managed instance. */
  importInstance(
    payload: ImportInstancePayload
  ): Promise<{ instance: Instance; index: ManagerIndex }>
  /** List .jar files in a folder (for the import launch-jar picker). */
  listFolderJars(path: string): Promise<string[]>
  /** Open a native picker for a .mrpack modpack; returns the chosen path or null. */
  pickModpack(): Promise<string | null>
  /** Import a Modrinth modpack (.mrpack) as a new managed instance. Reports via onInstallProgress. */
  importModpack(payload: ModpackImportPayload): Promise<{ instance: Instance; index: ManagerIndex }>
  /** Wire Velocity modern forwarding across a proxy's managed backends. */
  setupVelocityForwarding(id: string): Promise<ForwardingResult>

  // Backups
  listBackups(id: string): Promise<BackupInfo[]>
  createBackup(id: string): Promise<BackupInfo[]>
  restoreBackup(id: string, name: string): Promise<void>
  deleteBackup(id: string, name: string): Promise<BackupInfo[]>

  // Server lifecycle
  startServer(id: string): Promise<void>
  stopServer(id: string): Promise<void>
  restartServer(id: string): Promise<void>
  /** Send a console command (e.g. "say hi", "stop") to a running server. */
  sendCommand(id: string, command: string): Promise<void>
  serverStatus(id: string): Promise<ServerStatus>
  /** Buffered console scrollback so reopening a tab restores history. */
  serverBuffer(id: string): Promise<string>
  /** Ids of all currently-running servers. */
  runningServers(): Promise<string[]>
  onServerOutput(cb: (e: ServerOutputEvent) => void): () => void
  onServerStatus(cb: (e: ServerStatusEvent) => void): () => void
  onServerStats(cb: (e: ServerStatsEvent) => void): () => void

  // Content (plugins / mods)
  listContent(id: string): Promise<ContentFile[]>
  addContentFiles(id: string, paths: string[]): Promise<ContentFile[]>
  deleteContentFile(id: string, name: string): Promise<ContentFile[]>
  /** Search a content source (modrinth/hangar/spigot) for this server. */
  searchContent(id: string, source: ContentSource, query: string): Promise<ContentSearchHit[]>
  /** Download + install a project from a content source into this server. */
  installContent(id: string, source: ContentSource, projectId: string): Promise<ContentFile[]>
  /** Check tracked (app-installed) content for newer versions. */
  checkContentUpdates(id: string): Promise<ContentUpdate[]>
  /** Update one tracked content file to its latest version. */
  updateContent(id: string, name: string): Promise<ContentFile[]>
  /** Open a URL in the user's default browser. */
  openExternal(url: string): Promise<void>
  /** Open a native file picker for jars; returns chosen absolute paths. */
  pickFiles(): Promise<string[]>
  /** Resolve the absolute path of a dropped/selected File (Electron webUtils). */
  pathForFile(file: File): string

  // Files (built-in viewer/editor)
  /** List the entries of a directory within an instance (relPath "" = instance root). */
  listFiles(id: string, relPath: string): Promise<FileEntry[]>
  /** Read a text file for the editor; reports binary/too-large/missing instead of throwing. */
  readFile(id: string, relPath: string): Promise<FileReadResult>
  /** Write text content to a file within an instance (creates parent dirs if needed). */
  writeFile(id: string, relPath: string, content: string): Promise<void>
  /** Text editors detected on this machine (VS Code, Cursor, etc.). */
  detectEditors(): Promise<DetectedEditor[]>
  /** Open an instance's folder (or a file within it) in a detected external editor. */
  openInEditor(id: string, editorId: string, relPath?: string): Promise<void>

  // server.properties (visual editor)
  /** Read a server's server.properties as a key→value map ({} if it doesn't exist yet). */
  getServerProperties(id: string): Promise<Record<string, string>>
  /** Merge + persist keys into a server's server.properties; returns the updated map. */
  setServerProperties(id: string, kv: Record<string, string>): Promise<Record<string, string>>

  /** Clear a server's buffered console scrollback. */
  clearServerBuffer(id: string): Promise<void>
  /** Save a server's console scrollback to a file (opens a save dialog). Returns the path or null. */
  saveServerLog(id: string): Promise<string | null>
  /** Subscribe to crash diagnoses. Returns an unsubscribe fn. */
  onServerDiagnosis(cb: (e: ServerDiagnosisEvent) => void): () => void
  /** Copy text to the system clipboard. */
  copyText(text: string): Promise<void>

  // Tunnels (share a server publicly)
  /** Availability of each tunnel provider (binary/token presence). */
  listTunnelProviders(): Promise<TunnelProviderStatus[]>
  /** Current tunnel state for an instance. */
  getTunnel(id: string): Promise<TunnelInfo>
  /** Start a tunnel for an instance using the given provider. */
  startTunnel(id: string, provider: TunnelProviderId): Promise<void>
  /** Stop an instance's tunnel. */
  stopTunnel(id: string): Promise<void>
  /** Subscribe to tunnel status changes. Returns an unsubscribe fn. */
  onTunnelStatus(cb: (e: TunnelStatusEvent) => void): () => void

  // App + updater
  /** The running app's version (from package.json). */
  getAppVersion(): Promise<string>
  /** Current updater state. */
  getUpdateStatus(): Promise<UpdateStatus>
  /** Manually check for updates. */
  checkForUpdates(): Promise<void>
  /** Begin downloading an available update. */
  downloadUpdate(): Promise<void>
  /** Quit and install a downloaded update. */
  installUpdate(): Promise<void>
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
}
