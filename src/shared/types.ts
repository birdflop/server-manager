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
  /**
   * Absolute path to the server folder when it lives outside `<root>/instances/<id>` —
   * e.g. a dev server checked out next to the plugin repo it tests. Absent for the
   * normal managed layout. Because the folder isn't ours, deleting the server only
   * unlinks it from the index and leaves the files alone.
   */
  path?: string
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
  /** Args after the jar (e.g. ["nogui"]). Undefined = the per-type default. */
  gameArgs?: string[]
  /**
   * Full custom startup command, used verbatim instead of the generated one
   * (quote-aware; first token is the program). Undefined/blank = generated.
   */
  launchOverride?: string
  eulaAccepted: boolean
  createdAt: number
  /** For proxies only: the backend servers this proxy routes to. */
  backends?: ProxyBackend[]
  /** Auto-restart-on-file-change config (undefined = disabled). */
  watch?: WatchConfig
  /** Dev-project link: auto-deploy built jars from a local project (undefined = disabled). */
  devLink?: DevLinkConfig
  /** Tunnel/share preferences (undefined = never configured). */
  tunnel?: TunnelConfig
  /** Remote JVM debugging (JDWP) config (undefined = disabled). */
  debug?: DebugConfig
  /** App-managed local RCON access (auto-provisioned for TPS polling; undefined until first start). */
  rcon?: RconConfig
  /** Automatic backup schedule (undefined = disabled). */
  backup?: BackupScheduleConfig
}

/** App-managed RCON credentials for silent command execution (TPS polling, etc.). */
export interface RconConfig {
  port: number
  password: string
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

/**
 * Links a server to a local plugin/mod project. The app watches the project's build
 * output folder; when a fresh jar appears it's copied into the server's plugins/mods
 * folder (replacing the previously deployed version) and the configured action runs.
 */
export interface DevLinkConfig {
  enabled: boolean
  /** Absolute path to the project root (where build.gradle / pom.xml lives). */
  projectPath: string
  /** Build output folder relative to the project root (e.g. "build/libs", "target"). */
  outputDir: string
  /** What to do after deploying while the server is running. */
  action: WatchAction
  /** For action='command': the console command to send (e.g. "reload confirm"). */
  command?: string
  /** How long to wait after the last output change before deploying, in milliseconds. */
  debounceMs: number
  /** The jar name we last deployed, so old versions are replaced instead of piling up. */
  lastDeployedJar?: string
}

/** Default dev-link config for a freshly-enabled link. */
export const DEFAULT_DEVLINK: DevLinkConfig = {
  enabled: false,
  projectPath: '',
  outputDir: '',
  action: 'restart',
  debounceMs: 1500
}

/** Result of sniffing a project folder for its build system. */
export interface BuildSystemInfo {
  system: 'gradle' | 'maven' | null
  /** Conventional build output folder for that system ('' when unknown). */
  outputDir: string
}

/** A backend server a proxy forwards players to. */
export interface ProxyBackend {
  /** Name used in the proxy config (sanitized to a valid identifier). */
  name: string
  /** host:port the proxy connects to. */
  address: string
  /** The managed instance this points at, if any (used for live status + auto-fill). */
  instanceId?: string
}

/** Resolved on-disk location of a server's folder. */
export interface InstanceLocation {
  path: string
  /** True when the folder sits outside `<root>/instances` (see `InstanceMeta.path`). */
  external: boolean
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

/**
 * Where plugins/mods can be searched + installed from. Open-ended: the built-in
 * sources are listed for autocomplete, but app plugins can register additional
 * sources under their own ids.
 */
export type ContentSource = 'modrinth' | 'hangar' | 'spigot' | (string & {})

/** A content source available for a given server, for the source picker. */
export interface ContentSourceInfo {
  id: ContentSource
  label: string
}

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

/** Recursive listing of a whole instance folder, for the file-tree viewer. */
export interface DeepFileListing {
  entries: FileEntry[]
  /** True when the walk stopped early because the instance has too many files. */
  truncated: boolean
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

/** Where a server's tick metrics come from. */
export type PerfSource = 'builtin' | 'spark' | 'none'

/** Live tick metrics for a running server (polled silently over RCON). */
export interface ServerPerfEvent {
  id: string
  source: PerfSource
  /** Ticks per second (20 = perfect). */
  tps?: number
  /** Milliseconds per tick (50+ = overloaded). */
  mspt?: number
}

/** Options for a fake-player load test. */
export interface BotsOptions {
  /** How many bots to connect (staggered joins). */
  count: number
  /** Bots wander around (random walk with jumps). */
  move: boolean
  /** Bots send an occasional chat message. */
  chat: boolean
}

/** Live state of a server's fake-player session. */
export interface BotsStatusEvent {
  id: string
  running: boolean
  /** How many bots the session is aiming for. */
  target: number
  /** How many are connected right now. */
  connected: number
  /** Last error / kick reason, when something went wrong. */
  message?: string
}

/** A best-effort explanation emitted when a server exits abnormally. */
export interface ServerDiagnosisEvent {
  id: string
  code: number | null
  title: string
  hint: string
}

/**
 * Services that can expose a local server to the public internet. Open-ended:
 * built-ins are listed for autocomplete; app plugins can register more.
 */
export type TunnelProviderId = 'birdflop' | 'bore' | 'ngrok' | (string & {})

/** A persistent Birdflop tunnel identity (one per user, owns a subdomain). */
export interface BirdflopTunnelIdentity {
  /** Public subdomain, e.g. "a3k9zq" → a3k9zq.tunnel.birdflop.com. */
  subdomain: string
  /** Secret token proving ownership. Stored locally, never shared. */
  token: string
}

/** Lifecycle state of a server's tunnel. */
export type TunnelState = 'offline' | 'starting' | 'online' | 'reconnecting' | 'error'

/** Live traffic statistics for one tunnel (pushed by the Birdflop relay). */
export interface TunnelStats {
  /** Player connections open through the tunnel right now. */
  activeConnections: number
  /** Player connections since the tunnel registered. */
  totalConnections: number
  /** Bytes proxied in both directions since the tunnel registered. */
  bytes: number
}

/** Live tunnel info for one instance. */
export interface TunnelInfo {
  provider: TunnelProviderId | null
  state: TunnelState
  /** Public address players connect to (e.g. "6.tcp.ngrok.io:18056"), when online. */
  publicAddress?: string
  /** Human-readable status / progress / error message. */
  message?: string
  /** Live traffic stats, when the provider reports them (Birdflop). */
  stats?: TunnelStats
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

/** Result of inspecting a server's auth setup before exposing it publicly. */
export interface ShareSafety {
  /**
   * Whether the check could inspect the server's config. False for proxies
   * (per-platform configs) and servers without a server.properties yet.
   */
  checked: boolean
  /** Whether online-mode (Mojang authentication) is enabled. */
  onlineMode?: boolean
  /** Whether the whitelist is enabled. */
  whitelist?: boolean
  /** True when anyone — including cracked clients — could join once shared. */
  risky: boolean
}

/** One-click remediations for a risky share. */
export type ShareSafetyFix = 'online-mode' | 'whitelist'

/** State of Bedrock crossplay (GeyserMC) for a server. */
export interface BedrockStatus {
  /** Whether Geyser publishes builds for this server type. */
  supported: boolean
  /** A Geyser jar is present in plugins/mods. */
  installed: boolean
  /** A Floodgate jar is present (Bedrock players don't need a Java account). */
  floodgate: boolean
  /** UDP port Geyser listens on for Bedrock clients. */
  port: number
  /** LAN address ("192.168.x.x:19132") phones on the same network can join, if detectable. */
  lanAddress: string | null
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

// ---- Compatibility runs (test matrix CI) ----

/** Lifecycle of one server's slot in a compatibility run. */
export type CompatCellStatus =
  | 'queued'
  | 'starting'
  | 'testing'
  | 'stopping'
  | 'pass'
  | 'warn'
  | 'fail'
  | 'skipped'

/** A notable log line found while a compat-run server was starting. */
export interface CompatIssue {
  /** 'error' = known fatal load/enable failure; 'warn' = suspicious but possibly benign. */
  severity: 'error' | 'warn'
  line: string
}

/** Outcome of one smoke command sent to a ready compat-run server. */
export interface CompatSmokeResult {
  command: string
  /** False when the output contained an unknown-command/error marker. */
  ok: boolean
  /** Console output captured in the window after the command was sent. */
  output: string
}

/** Result slot for one server in a compatibility run. */
export interface CompatCell {
  instanceId: string
  name: string
  mcVersion: string
  status: CompatCellStatus
  /** Short human summary shown in the grid row. */
  message?: string
  /** Milliseconds from launch to the ready line, when the server got there. */
  readyMs?: number
  /** Exit code when the server died during startup. */
  exitCode?: number | null
  issues: CompatIssue[]
  smoke: CompatSmokeResult[]
}

/** A whole compatibility run: boot every server in turn and grade the result. */
export interface CompatRun {
  id: string
  startedAt: number
  state: 'running' | 'done' | 'cancelled'
  readyTimeoutMs: number
  smokeCommands: string[]
  cells: CompatCell[]
}

/** Options for starting a compatibility run. */
export interface CompatRunOptions {
  /** Console commands sent to each server once it's ready (one per entry). */
  smokeCommands: string[]
  /** How long to wait for the ready line before failing the cell. */
  readyTimeoutMs?: number
}

/** A saved backup archive for an instance. */
export interface BackupInfo {
  name: string
  size: number
  createdAt: number
  /** How the backup came to be: user-made, scheduled, or the safety snapshot before a restore. */
  kind: 'manual' | 'auto' | 'pre-restore'
}

/** Per-instance automatic backup schedule (runs only while the server is running). */
export interface BackupScheduleConfig {
  enabled: boolean
  /** Hours between automatic backups. */
  intervalHours: number
  /** Keep at most this many automatic backups; the oldest are deleted first. */
  keep: number
}

/** Default schedule for a freshly-enabled automatic backup. */
export const DEFAULT_BACKUP_SCHEDULE: BackupScheduleConfig = {
  enabled: false,
  intervalHours: 6,
  keep: 10
}

/** A world folder inside a server (folder with a level.dat). */
export interface WorldInfo {
  name: string
  /** Total size in bytes, including Paper's companion dimension folders. */
  size: number
  /** Whether server.properties points at this world (level-name). */
  active: boolean
  /** Datapacks installed in this world's datapacks folder. */
  datapacks: string[]
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

/**
 * A shareable server definition: everything needed to reproduce a server environment
 * (software, version, content list, config overrides) without shipping any world data.
 * Saved as a small .bsmrecipe JSON file.
 */
export interface ServerRecipe {
  format: 1
  name: string
  serverType: ServerType
  mcVersion: string
  build: string
  ramMB: number
  jvmArgs: string[]
  /** server.properties overrides (secrets and machine-specific keys stripped). */
  properties: Record<string, string>
  /** Tracked plugins/mods, re-downloadable from their source. */
  content: { source: ContentSource; projectId: string; name: string; versionNumber?: string }[]
  /** Content files with unknown provenance — listed so the importer knows what's missing. */
  untracked: string[]
}

/** Payload for creating a server from a recipe file. */
export interface RecipeImportPayload {
  path: string
  name: string
  port: number
  ramMB: number
  javaPath: string
  eulaAccepted: boolean
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

/** The exact startup command a server would launch with right now. */
export interface LaunchPreview {
  /** Program to run (java path or the override's first token). */
  command: string
  args: string[]
  /** True when a custom startup command override is in effect. */
  overridden: boolean
  /** Forge/NeoForge only: content of the user_jvm_args.txt regenerated at every start. */
  userJvmArgs?: string
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
  /** Pterodactyl/Pelican panel URL for remote server control (null = not connected). */
  pterodactylPanelUrl: string | null
  /** Birdflop tunnel identity (one per user); null until first enrolled. */
  birdflopTunnel: BirdflopTunnelIdentity | null
  /** Reusable console command shortcuts, shown as buttons in every server's console. */
  consoleMacros: ConsoleMacro[]
  /** Saved server-creation presets offered in the create wizard. */
  templates: InstanceTemplate[]
  /** Ids of installed app plugins the user has switched off. */
  disabledPlugins: string[]
}

// ---- App plugins ----

/** Lifecycle state of an installed app plugin. */
export type PluginState = 'active' | 'disabled' | 'error'

/** How a plugin's code runs: in the main process, or in an isolated utility process. */
export type PluginIsolation = 'inline' | 'process'

/** Declarative UI contributions a plugin can make via its manifest. */
export interface PluginContributions {
  /** Extra console command buttons, shown alongside the user's own macros. */
  consoleMacros?: ConsoleMacro[]
}

/** An installed app plugin, as shown in settings. */
export interface PluginInfo {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  /** Permission ids the plugin declared in its manifest. */
  permissions: string[]
  isolation: PluginIsolation
  state: PluginState
  /** Why the plugin failed to load or activate, when state = 'error'. */
  error?: string
  /** Absolute path to the plugin's folder. */
  dir: string
  /** Absolute path to the plugin's log file. */
  logPath: string
  contributes?: PluginContributions
}

// ---- Pterodactyl panel (remote servers) ----

/** The panel account a client API key belongs to. */
export interface PteroAccount {
  username: string
  email: string
  admin: boolean
}

/** Connection state of the Pterodactyl panel integration. */
export interface PteroConnection {
  connected: boolean
  panelUrl: string | null
  /** Populated once the API key has been verified against the panel. */
  account: PteroAccount | null
}

/** Power signals the panel accepts. */
export type PteroPowerAction = 'start' | 'stop' | 'restart' | 'kill'

/** Live power state Wings reports for a remote server. */
export type PteroPowerState = 'offline' | 'starting' | 'running' | 'stopping'

/** A server the API key's panel account can access. */
export interface PteroServer {
  /** Short identifier used in every API route (e.g. "d3aac109"). */
  identifier: string
  name: string
  description: string
  /** Node the server runs on (display only). */
  node: string
  /** Primary allocation players connect to ("host:port"), when one is designated. */
  address: string | null
  suspended: boolean
  limits: {
    /** MB; 0 = unlimited. */
    memoryMB: number
    /** MB; 0 = unlimited. */
    diskMB: number
    /** Percent of one core (100 = one core); 0 = unlimited. */
    cpuPct: number
  }
}

/** Point-in-time resource usage of a remote server. */
export interface PteroResources {
  state: PteroPowerState
  cpuPct: number
  memMB: number
  diskMB: number
  uptimeMs: number
}

/** A backup stored on the panel for a remote server. */
export interface PteroBackup {
  uuid: string
  name: string
  /** Archive size in bytes (0 while the backup is still running). */
  size: number
  successful: boolean
  /** Locked backups can't be deleted until unlocked on the panel. */
  locked: boolean
  createdAt: number
  /** Null while the backup is still being taken. */
  completedAt: number | null
}

/** Prefill for the clone-locally dialog, guessed from the remote server. */
export interface PteroClonePrefill {
  name: string
  ramMB: number
  port: number
  launchKind: 'jar' | 'args-file'
  launchJar?: string
  jvmArgs: string[]
  /** Best-effort guesses from the startup command (undefined = couldn't tell). */
  serverType?: ServerType
  mcVersion?: string
}

/** Payload for cloning a remote panel server into a local instance. */
export interface PteroClonePayload {
  serverId: string
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

/** A chunk of console output streamed from a remote server's websocket. */
export interface PteroOutputEvent {
  serverId: string
  chunk: string
}

/** A power-state transition pushed over a remote server's websocket. */
export interface PteroStateEvent {
  serverId: string
  state: PteroPowerState
}

/** Live resource usage pushed over a remote server's websocket. */
export interface PteroStatsEvent extends PteroResources {
  serverId: string
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
  /**
   * Subscribe to index changes made outside the renderer — currently plugins
   * creating/deleting servers and groups. Returns an unsubscribe fn.
   */
  onIndexChanged(cb: (index: ManagerIndex) => void): () => void

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
  /** Apply editable settings (name, port, ram, java, jvm args, launch config). */
  updateInstance(
    id: string,
    patch: Partial<
      Pick<
        Instance,
        | 'name'
        | 'port'
        | 'ramMB'
        | 'javaPath'
        | 'jvmArgs'
        | 'launchJar'
        | 'gameArgs'
        | 'launchOverride'
        | 'watch'
        | 'devLink'
        | 'tunnel'
        | 'debug'
        | 'backup'
      >
    >
  ): Promise<{ instance: Instance; index: ManagerIndex } | null>
  /**
   * The exact startup command a server would launch with. `patch` previews
   * unsaved edits (RAM, Java, args, override) without persisting them.
   */
  launchPreview(id: string, patch?: Partial<Instance>): Promise<LaunchPreview>
  /** Delete a server (folder + index entry). Servers in an external folder are only unlinked. */
  deleteInstance(id: string): Promise<ManagerIndex>
  /** Open a folder inside the server (relPath, default the root) in the OS file manager. */
  openInstanceFolder(id: string, relPath?: string): Promise<void>
  /** Where a server's files live, and whether that's outside the data root. */
  instanceLocation(id: string): Promise<InstanceLocation>
  /**
   * Move a server's folder elsewhere — e.g. beside the plugin repo it tests — and remember
   * it there. Prompts for a destination when `dest` is omitted; resolves to null if the
   * picker is cancelled. The server must be stopped.
   */
  relocateInstance(
    id: string,
    dest?: string
  ): Promise<{ index: ManagerIndex; location: InstanceLocation } | null>
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

  // Server recipes (shareable environment definitions)
  /** Export a server as a .bsmrecipe file (opens a save dialog). Returns the path or null. */
  exportRecipe(id: string): Promise<string | null>
  /** Pick + parse a .bsmrecipe file for preview. Null if cancelled. */
  pickRecipe(): Promise<{ path: string; recipe: ServerRecipe } | null>
  /** Create a server from a recipe. Progress via onInstallProgress; returns install warnings. */
  importRecipe(
    payload: RecipeImportPayload
  ): Promise<{ instance: Instance; index: ManagerIndex; warnings: string[] }>

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
  /** Subscribe to live TPS/MSPT samples for running servers. Returns an unsubscribe fn. */
  onServerPerf(cb: (e: ServerPerfEvent) => void): () => void

  // Fake-player load testing
  /** Current bot session state for a server. */
  getBots(id: string): Promise<BotsStatusEvent>
  /** Connect N test bots to a running offline-mode server. */
  startBots(id: string, opts: BotsOptions): Promise<void>
  /** Disconnect all test bots from a server. */
  stopBots(id: string): Promise<void>
  /** Subscribe to bot session changes. Returns an unsubscribe fn. */
  onBotsStatus(cb: (e: BotsStatusEvent) => void): () => void

  // Content (plugins / mods)
  /** Sources available for this server (built-ins + plugin-registered). */
  listContentSources(id: string): Promise<ContentSourceInfo[]>
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
  /** Recursively list everything inside an instance for the file-tree viewer. */
  listFilesDeep(id: string): Promise<DeepFileListing>
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
  /** Inspect a server's auth setup (online-mode/whitelist) before sharing. */
  getShareSafety(id: string): Promise<ShareSafety>
  /** Apply a one-click share-safety fix to server.properties. */
  applyShareSafetyFix(id: string, fix: ShareSafetyFix): Promise<ShareSafety>
  /** State of Bedrock crossplay (Geyser) for a server. */
  getBedrockStatus(id: string): Promise<BedrockStatus>
  /** Install Geyser (+ Floodgate where available) for Bedrock crossplay. */
  installBedrock(id: string): Promise<{ status: BedrockStatus; warning?: string }>

  // Worlds
  /** Worlds inside a server (folders with a level.dat), active first. */
  listWorlds(id: string): Promise<WorldInfo[]>
  /** Point level-name at another world (takes effect on next start). */
  setActiveWorld(id: string, name: string): Promise<WorldInfo[]>
  /** Delete a non-active world's files (including dimension companions). */
  deleteWorld(id: string, name: string): Promise<WorldInfo[]>
  /** Delete a world's files + set level-seed so it regenerates on next start. */
  regenerateWorld(id: string, name: string, seed: string): Promise<WorldInfo[]>
  /** Export a world as a zip (opens a save dialog). Returns the path or null if cancelled. */
  exportWorld(id: string, name: string): Promise<string | null>
  /** Import a world zip as a new world (opens a file picker). Null if cancelled. */
  importWorld(id: string): Promise<WorldInfo[] | null>
  /** Add datapack zips to a world (opens a file picker). Null if cancelled. */
  addDatapacks(id: string, world: string): Promise<WorldInfo[] | null>
  /** Remove a datapack from a world. */
  deleteDatapack(id: string, world: string, name: string): Promise<WorldInfo[]>

  // Dev-project link
  /** Sniff a project folder for its build system (Gradle/Maven) + conventional output dir. */
  detectBuildSystem(projectPath: string): Promise<BuildSystemInfo>
  /** Deploy the newest built jar from a server's linked project right now. Returns the jar name. */
  deployDevLink(id: string): Promise<string>

  // Compatibility runs (test matrix CI)
  /** Boot each server in turn, grade startup + smoke commands. Progress via onCompatProgress. */
  startCompatRun(instanceIds: string[], opts: CompatRunOptions): Promise<CompatRun>
  /** Cancel the in-flight compatibility run (finishes the current server, skips the rest). */
  cancelCompatRun(): Promise<void>
  /** The current (or last finished) compatibility run, if any. */
  getCompatRun(): Promise<CompatRun | null>
  /** Subscribe to compatibility-run progress snapshots. Returns an unsubscribe fn. */
  onCompatProgress(cb: (run: CompatRun) => void): () => void

  // Pterodactyl panel (remote servers)
  /** Current panel connection state (verifies the key lazily when needed). */
  pteroStatus(): Promise<PteroConnection>
  /** Verify + save a panel URL and client API key. Throws with a friendly message on failure. */
  pteroConnect(panelUrl: string, apiKey: string): Promise<PteroConnection>
  /** Forget the saved panel URL + API key and close any open consoles. */
  pteroDisconnect(): Promise<void>
  /** Servers the connected account can access. */
  pteroListServers(): Promise<PteroServer[]>
  /** Point-in-time state + resource usage for one remote server. */
  pteroResources(serverId: string): Promise<PteroResources>
  /** Send a power signal (start/stop/restart/kill) to a remote server. */
  pteroPower(serverId: string, action: PteroPowerAction): Promise<void>
  /** Send a console command to a running remote server. */
  pteroSendCommand(serverId: string, command: string): Promise<void>
  /** Open (or reuse) a live console session; resolves with buffered scrollback. */
  pteroOpenConsole(serverId: string): Promise<string>
  /** Close a live console session. */
  pteroCloseConsole(serverId: string): Promise<void>
  /** Subscribe to remote console output. Returns an unsubscribe fn. */
  onPteroOutput(cb: (e: PteroOutputEvent) => void): () => void
  /** Subscribe to remote power-state changes. Returns an unsubscribe fn. */
  onPteroState(cb: (e: PteroStateEvent) => void): () => void
  /** Subscribe to remote resource-usage samples. Returns an unsubscribe fn. */
  onPteroStats(cb: (e: PteroStatsEvent) => void): () => void

  // Pterodactyl panel — remote files
  /** List a directory on a remote server ("" = server root). Dirs first. */
  pteroListFiles(serverId: string, dir: string): Promise<FileEntry[]>
  /** Read a remote text file for the editor; reports binary/too-large instead of throwing. */
  pteroReadFile(serverId: string, path: string): Promise<FileReadResult>
  /** Write text content to a remote file. */
  pteroWriteFile(serverId: string, path: string, content: string): Promise<void>
  /** Rename a file/folder within a remote directory. */
  pteroRenameFile(serverId: string, dir: string, from: string, to: string): Promise<void>
  /** Delete files/folders within a remote directory. */
  pteroDeleteFiles(serverId: string, dir: string, names: string[]): Promise<void>
  /** Create a folder within a remote directory. */
  pteroCreateFolder(serverId: string, dir: string, name: string): Promise<void>
  /** Download a remote file via the browser (signed panel URL). */
  pteroDownloadFile(serverId: string, path: string): Promise<void>
  /** Pick local files and upload them to a remote directory. Null if cancelled. */
  pteroUploadFiles(serverId: string, dir: string): Promise<FileEntry[] | null>

  // Pterodactyl panel — remote backups
  pteroListBackups(serverId: string): Promise<PteroBackup[]>
  /** Start a backup; returns the refreshed list (the new entry may still be running). */
  pteroCreateBackup(serverId: string): Promise<PteroBackup[]>
  /** Restore a backup over the server's current files. */
  pteroRestoreBackup(serverId: string, uuid: string): Promise<void>
  pteroDeleteBackup(serverId: string, uuid: string): Promise<PteroBackup[]>
  /** Download a backup archive via the browser (signed panel URL). */
  pteroDownloadBackup(serverId: string, uuid: string): Promise<void>

  // Pterodactyl panel — clone to local
  /** Inspect a remote server and suggest local clone settings. */
  pteroClonePrepare(serverId: string): Promise<PteroClonePrefill>
  /** Copy a remote server 1:1 into a new local instance. Progress via onPteroCloneProgress. */
  pteroCloneServer(payload: PteroClonePayload): Promise<{ instance: Instance; index: ManagerIndex }>
  /** Abort the in-flight clone, if any (the clone call rejects with "Clone canceled"). */
  pteroCloneCancel(): Promise<void>
  /** Progress events for the in-flight clone. */
  onPteroCloneProgress(cb: (p: InstallProgress) => void): () => void

  // App plugins
  /** Installed plugins and their states. */
  listPlugins(): Promise<PluginInfo[]>
  /** Enable/disable a plugin (takes effect immediately). Returns the refreshed list. */
  setPluginEnabled(id: string, enabled: boolean): Promise<PluginInfo[]>
  /** Rescan the plugins folder and reload everything. Returns the refreshed list. */
  reloadPlugins(): Promise<PluginInfo[]>
  /** Open the plugins folder in the OS file manager (created if missing). */
  openPluginsFolder(): Promise<void>
  /** Open a plugin's log file in the OS default editor. */
  openPluginLog(id: string): Promise<void>
  /** Subscribe to plugin list changes (load/enable/disable/reload). Returns an unsubscribe fn. */
  onPluginsChanged(cb: (plugins: PluginInfo[]) => void): () => void
  /** Invoke a handler a plugin registered via ctx.ipc.handle (channel plugin:<id>:<verb>). */
  invokePlugin(id: string, verb: string, ...args: unknown[]): Promise<unknown>
  /** Subscribe to a plugin's broadcasts (channel plugin:<id>:<event>). Returns an unsubscribe fn. */
  onPluginEvent(id: string, event: string, cb: (payload: unknown) => void): () => void

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
