import { useEffect, useState, type ReactElement } from 'react'
import { FolderOpen, Save, Trash2, AlertTriangle, Loader2, Copy } from 'lucide-react'
import type { Instance, JavaInstall, ServerStatus } from '@shared/types'
import { SERVER_TYPE_MAP } from '@shared/software'
import { useApp } from '../store'

function ramLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
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
  const [saving, setSaving] = useState(false)
  const cloneInstance = useApp((s) => s.cloneInstance)

  useEffect(() => {
    void window.api.listJava().then(setJavas)
  }, [])

  const dirty =
    name !== instance.name ||
    port !== instance.port ||
    ramMB !== instance.ramMB ||
    javaPath !== instance.javaPath ||
    jvmArgs !== instance.jvmArgs.join(' ')

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await window.api.updateInstance(instance.id, {
        name: name.trim() || instance.name,
        port,
        ramMB,
        javaPath,
        jvmArgs: jvmArgs.split(/\s+/).filter(Boolean)
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
    <div className="mx-auto max-w-2xl space-y-6 overflow-y-auto p-6">
      {/* Server info */}
      <section className="rounded-brand border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Server information</h2>
          <button
            onClick={() => void cloneInstance(instance.id)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
            title="Duplicate this server"
          >
            <Copy size={13} /> Duplicate
          </button>
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
          </Labeled>

          <Labeled label="Extra JVM arguments">
            <input
              value={jvmArgs}
              onChange={(e) => setJvmArgs(e.target.value)}
              placeholder="-XX:+UseG1GC"
              className="w-full rounded-md bg-input px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
            />
          </Labeled>

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
        </div>
      </section>

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
