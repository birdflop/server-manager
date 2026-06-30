import { useEffect, useState, type ReactElement } from 'react'
import {
  FolderOpen,
  Save,
  Trash2,
  AlertTriangle,
  Loader2,
  Copy,
  Eye,
  BookmarkPlus,
  RefreshCw,
  Bug,
  ClipboardCopy
} from 'lucide-react'
import type {
  DebugConfig,
  Instance,
  InstanceTemplate,
  JavaInstall,
  ServerStatus,
  WatchAction,
  WatchConfig
} from '@shared/types'
import { DEFAULT_DEBUG, DEFAULT_WATCH } from '@shared/types'
import { SERVER_TYPE_MAP, contentDirOf, contentKindOf } from '@shared/software'
import { useApp } from '../store'

function ramLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

/** Stable, field-ordered serialization of a watch config for change detection. */
function watchKey(w: WatchConfig): string {
  return JSON.stringify({
    enabled: w.enabled,
    paths: w.paths,
    extensions: w.extensions,
    action: w.action,
    command: w.command || '',
    debounceMs: w.debounceMs
  })
}

export function SettingsView({
  instance,
  status,
  reload,
  onDeleted
}: {
  instance: Instance
  status: ServerStatus
  reload: () => Promise<void>
  onDeleted: () => void
}): ReactElement {
  const [name, setName] = useState(instance.name)
  const [port, setPort] = useState(instance.port)
  const [ramMB, setRamMB] = useState(instance.ramMB)
  const [javaPath, setJavaPath] = useState(instance.javaPath)
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs.join(' '))
  const [javas, setJavas] = useState<JavaInstall[]>([])
  const [rescanningJava, setRescanningJava] = useState(false)
  const [saving, setSaving] = useState(false)
  const cloneInstance = useApp((s) => s.cloneInstance)
  const updateConfig = useApp((s) => s.updateConfig)
  const templates = useApp((s) => s.config?.templates ?? [])
  const [savedTpl, setSavedTpl] = useState(false)

  async function saveAsTemplate(): Promise<void> {
    const tpl: InstanceTemplate = {
      id: crypto.randomUUID(),
      name: instance.name,
      serverType: instance.serverType,
      mcVersion: instance.mcVersion,
      build: instance.build,
      ramMB: instance.ramMB,
      jvmArgs: instance.jvmArgs
    }
    await updateConfig({ templates: [...templates, tpl] })
    setSavedTpl(true)
    setTimeout(() => setSavedTpl(false), 2000)
  }

  // ---- File watcher state ----
  const initialWatch = instance.watch ?? DEFAULT_WATCH
  const [watchEnabled, setWatchEnabled] = useState(initialWatch.enabled)
  const [watchPaths, setWatchPaths] = useState(initialWatch.paths.join('\n'))
  const [watchExts, setWatchExts] = useState(initialWatch.extensions.join(', '))
  const [watchAction, setWatchAction] = useState<WatchAction>(initialWatch.action)
  const [watchCommand, setWatchCommand] = useState(initialWatch.command ?? '')
  const [watchDebounce, setWatchDebounce] = useState(initialWatch.debounceMs)

  function buildWatch(): WatchConfig {
    return {
      enabled: watchEnabled,
      paths: watchPaths
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      extensions: watchExts
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean),
      action: watchAction,
      command: watchCommand.trim() || undefined,
      debounceMs: Math.max(100, watchDebounce || 1000)
    }
  }

  /** Enabling for the first time on a server with a content folder pre-fills sensible defaults. */
  function toggleWatch(on: boolean): void {
    setWatchEnabled(on)
    if (on && watchPaths.trim() === '' && contentKindOf(instance.serverType) !== 'none') {
      setWatchPaths(contentDirOf(instance.serverType))
      setWatchExts('jar')
    }
  }

  // ---- Remote debugging (JDWP) state ----
  const initialDebug = instance.debug ?? DEFAULT_DEBUG
  const [debugEnabled, setDebugEnabled] = useState(initialDebug.enabled)
  const [debugPort, setDebugPort] = useState(initialDebug.port)
  const [debugSuspend, setDebugSuspend] = useState(initialDebug.suspend)
  const [copiedDebug, setCopiedDebug] = useState(false)

  function buildDebug(): DebugConfig {
    return {
      enabled: debugEnabled,
      port: Math.min(65535, Math.max(1, debugPort || 5005)),
      suspend: debugSuspend
    }
  }

  const debugDirty =
    debugEnabled !== initialDebug.enabled ||
    debugPort !== initialDebug.port ||
    debugSuspend !== initialDebug.suspend

  async function copyDebugAddress(): Promise<void> {
    await window.api.copyText(`localhost:${buildDebug().port}`)
    setCopiedDebug(true)
    setTimeout(() => setCopiedDebug(false), 1500)
  }

  useEffect(() => {
    void window.api.listJava().then(setJavas)
  }, [])

  async function rescanJava(): Promise<void> {
    setRescanningJava(true)
    try {
      setJavas(await window.api.refreshJava())
    } finally {
      setRescanningJava(false)
    }
  }

  const watchDirty = watchKey(buildWatch()) !== watchKey(initialWatch)
  const dirty =
    name !== instance.name ||
    port !== instance.port ||
    ramMB !== instance.ramMB ||
    javaPath !== instance.javaPath ||
    jvmArgs !== instance.jvmArgs.join(' ') ||
    watchDirty ||
    debugDirty

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await window.api.updateInstance(instance.id, {
        name: name.trim() || instance.name,
        port,
        ramMB,
        javaPath,
        jvmArgs: jvmArgs.split(/\s+/).filter(Boolean),
        ...(watchDirty ? { watch: buildWatch() } : {}),
        ...(debugDirty ? { debug: buildDebug() } : {})
      })
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    if (!confirm(`Delete "${instance.name}"? This permanently removes the server folder.`)) return
    await window.api.deleteInstance(instance.id)
    onDeleted()
  }

  // Show the stored Java even if detection didn't surface it.
  const javaOptions = javas.some((j) => j.path === javaPath)
    ? javas
    : [{ path: javaPath, version: '?', major: 0 } as JavaInstall, ...javas]

  return (
    <div className="mx-auto h-full max-w-2xl space-y-6 overflow-y-auto p-6">
      {/* Server info */}
      <section className="rounded-brand border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Server information</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void saveAsTemplate()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              title="Save these settings as a reusable template"
            >
              <BookmarkPlus size={13} /> {savedTpl ? 'Saved!' : 'Save as template'}
            </button>
            <button
              onClick={() => void cloneInstance(instance.id)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              title="Duplicate this server"
            >
              <Copy size={13} /> Duplicate
            </button>
          </div>
        </div>
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-fg-muted">Software</dt>
          <dd>{SERVER_TYPE_MAP[instance.serverType].label}</dd>
          <dt className="text-fg-muted">Minecraft</dt>
          <dd>{instance.mcVersion}</dd>
          <dt className="text-fg-muted">Build</dt>
          <dd>{instance.build}</dd>
          <dt className="text-fg-muted">Created</dt>
          <dd>{instance.createdAt ? new Date(instance.createdAt).toLocaleString() : '—'}</dd>
          <dt className="text-fg-muted">Directory</dt>
          <dd className="flex items-center gap-2">
            <button
              onClick={() => void window.api.openInstanceFolder(instance.id)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
            >
              <FolderOpen size={13} /> Open folder
            </button>
          </dd>
        </dl>
      </section>

      {/* Runtime settings */}
      <section className="rounded-brand border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Runtime settings</h2>
          {status !== 'stopped' && (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <AlertTriangle size={12} /> Restart to apply
            </span>
          )}
        </div>

        <div className="space-y-4">
          <Labeled label="Server name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
            />
          </Labeled>

          <div className="grid grid-cols-2 gap-4">
            <Labeled label="Port">
              <input
                type="number"
                value={port}
                min={1}
                max={65535}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
              />
            </Labeled>
            <Labeled label={`Memory — ${ramLabel(ramMB)}`}>
              <input
                type="range"
                min={512}
                max={16384}
                step={512}
                value={ramMB}
                onChange={(e) => setRamMB(Number(e.target.value))}
                className="mt-2 w-full accent-[var(--c-accent)]"
              />
            </Labeled>
          </div>

          <Labeled label="Java installation">
            <div className="flex items-center gap-2">
              <select
                value={javaPath}
                onChange={(e) => setJavaPath(e.target.value)}
                className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
              >
                {javaOptions.map((j) => (
                  <option key={j.path} value={j.path}>
                    {j.major ? `Java ${j.major} (${j.version})` : j.path}
                    {j.managed ? ' • managed' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void rescanJava()}
                disabled={rescanningJava}
                title="Rescan for Java installations"
                className="shrink-0 rounded-md border border-border p-2 text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
              >
                <RefreshCw size={15} className={rescanningJava ? 'animate-spin' : ''} />
              </button>
            </div>
          </Labeled>

          <Labeled label="Extra JVM arguments">
            <input
              value={jvmArgs}
              onChange={(e) => setJvmArgs(e.target.value)}
              placeholder="-XX:+UseG1GC"
              className="w-full rounded-md bg-input px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
            />
          </Labeled>
        </div>
      </section>

      {/* File watcher */}
      <section className="rounded-brand border border-border bg-surface p-4">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Eye size={15} /> File watcher
          </h2>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={watchEnabled}
              onChange={(e) => toggleWatch(e.target.checked)}
              className="h-4 w-4 accent-[var(--c-accent)]"
            />
            Enabled
          </label>
        </div>
        <p className="mb-3 text-xs text-fg-muted">
          Automatically react when watched files change — ideal for plugin/mod development. Only
          acts while the server is running.
        </p>

        {watchEnabled && (
          <div className="space-y-4">
            <Labeled label="Watched paths (one per line, relative to server folder)">
              <textarea
                value={watchPaths}
                onChange={(e) => setWatchPaths(e.target.value)}
                rows={3}
                placeholder={'plugins\nserver.properties'}
                className="w-full resize-y rounded-md bg-input px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
              />
            </Labeled>

            <Labeled label="File extensions (folders only; blank = any file)">
              <input
                value={watchExts}
                onChange={(e) => setWatchExts(e.target.value)}
                placeholder="jar"
                className="w-full rounded-md bg-input px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
              />
            </Labeled>

            <div className="grid grid-cols-2 gap-4">
              <Labeled label="On change">
                <select
                  value={watchAction}
                  onChange={(e) => setWatchAction(e.target.value as WatchAction)}
                  className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="restart">Restart the server</option>
                  <option value="command">Run a console command</option>
                </select>
              </Labeled>
              <Labeled label="Debounce (ms)">
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={watchDebounce}
                  onChange={(e) => setWatchDebounce(Number(e.target.value))}
                  className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                />
              </Labeled>
            </div>

            {watchAction === 'command' && (
              <Labeled label="Console command">
                <input
                  value={watchCommand}
                  onChange={(e) => setWatchCommand(e.target.value)}
                  placeholder="reload confirm"
                  className="w-full rounded-md bg-input px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
                />
              </Labeled>
            )}
          </div>
        )}
      </section>

      {/* Remote debugging (JDWP) */}
      <section className="rounded-brand border border-border bg-surface p-4">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Bug size={15} /> Remote debugging (JDWP)
          </h2>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={debugEnabled}
              onChange={(e) => setDebugEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--c-accent)]"
            />
            Enabled
          </label>
        </div>
        <p className="mb-3 text-xs text-fg-muted">
          Launches the server with a JDWP agent so you can attach a debugger (IntelliJ / VS Code) and
          set breakpoints in your plugin or mod. Restart the server after changing these.
        </p>

        {debugEnabled && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Labeled label="Debug port">
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={debugPort}
                  onChange={(e) => setDebugPort(Number(e.target.value))}
                  className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                />
              </Labeled>
              <Labeled label="Suspend until attached">
                <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
                  <input
                    type="checkbox"
                    checked={debugSuspend}
                    onChange={(e) => setDebugSuspend(e.target.checked)}
                    className="h-4 w-4 accent-[var(--c-accent)]"
                  />
                  Pause startup for the debugger
                </label>
              </Labeled>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-muted">
              <span>
                Attach a “Remote JVM Debug” run config to{' '}
                <code className="rounded bg-input px-1 py-0.5 font-mono text-fg">
                  localhost:{buildDebug().port}
                </code>
              </span>
              <button
                type="button"
                onClick={() => void copyDebugAddress()}
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-fg-muted transition hover:bg-surface hover:text-fg"
              >
                <ClipboardCopy size={12} /> {copiedDebug ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Save (applies runtime + watcher changes) */}
      <div className="flex justify-end">
        <button
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
        >
          {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
          Save changes
        </button>
      </div>

      {/* Danger zone */}
      <section className="rounded-brand border border-red-500/30 bg-red-500/5 p-4">
        <h2 className="mb-1 text-sm font-semibold text-red-300">Danger zone</h2>
        <p className="mb-3 text-xs text-fg-muted">
          Permanently delete this server and all of its files. This cannot be undone.
        </p>
        <button
          onClick={() => void remove()}
          className="inline-flex items-center gap-2 rounded-brand border border-red-500/50 px-3 py-1.5 text-sm text-red-300 transition hover:bg-red-500/15"
        >
          <Trash2 size={15} /> Delete server
        </button>
      </section>
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  )
}
