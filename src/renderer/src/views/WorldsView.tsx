import { useEffect, useState, type ReactElement } from 'react'
import {
  Globe,
  Loader2,
  AlertCircle,
  Upload,
  Download,
  Trash2,
  Check,
  Sprout,
  Package,
  Plus,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import type { ServerStatus, WorldInfo } from '@shared/types'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function WorldsView({
  instanceId,
  status
}: {
  instanceId: string
  status: ServerStatus
}): ReactElement {
  const [worlds, setWorlds] = useState<WorldInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [regenFor, setRegenFor] = useState<string | null>(null)
  const [regenSeed, setRegenSeed] = useState('')
  const [exportedTo, setExportedTo] = useState<string | null>(null)

  const running = status !== 'stopped'

  useEffect(() => {
    setWorlds(null)
    setError(null)
    void window.api.listWorlds(instanceId).then(setWorlds)
  }, [instanceId])

  async function act(fn: () => Promise<WorldInfo[] | null>): Promise<void> {
    setBusy(true)
    setError(null)
    setExportedTo(null)
    try {
      const next = await fn()
      if (next) setWorlds(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function toggleExpanded(name: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function exportWorld(name: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const path = await window.api.exportWorld(instanceId, name)
      if (path) setExportedTo(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-3 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Worlds</h2>
          <p className="text-xs text-fg-muted">
            Switch, import, export, or regenerate this server&apos;s worlds. Changes to the active
            world apply on the next start.
          </p>
        </div>
        <button
          onClick={() => void act(() => window.api.importWorld(instanceId))}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-brand bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />} Import world
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      {exportedTo && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          Exported to {exportedTo}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-brand border border-border">
        {worlds === null ? (
          <div className="flex h-full items-center justify-center text-fg-muted">
            <Loader2 className="animate-spin" size={18} />
          </div>
        ) : worlds.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fg-muted">
            <Globe size={26} className="opacity-50" />
            <p className="text-sm">No worlds yet — start the server once to generate one.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {worlds.map((w) => {
              const open = expanded.has(w.name)
              return (
                <div key={w.name} className="border-b border-border last:border-0">
                  <div className="group flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-surface-2">
                    <button
                      onClick={() => toggleExpanded(w.name)}
                      className="shrink-0 text-fg-muted"
                      title="Datapacks"
                    >
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <Globe size={16} className="shrink-0 text-fg-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{w.name}</span>
                        {w.active && (
                          <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                            active
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-fg-muted">
                        {formatSize(w.size)}
                        {w.datapacks.length > 0 &&
                          ` · ${w.datapacks.length} datapack${w.datapacks.length === 1 ? '' : 's'}`}
                      </div>
                    </div>
                    {!w.active && (
                      <button
                        onClick={() => void act(() => window.api.setActiveWorld(instanceId, w.name))}
                        disabled={busy}
                        title="Use this world (applies on next start)"
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                      >
                        <Check size={13} /> Activate
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setRegenFor(regenFor === w.name ? null : w.name)
                        setRegenSeed('')
                      }}
                      disabled={busy || running}
                      title={running ? 'Stop the server first' : 'Delete and regenerate with a seed'}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                    >
                      <Sprout size={13} /> Regenerate
                    </button>
                    <button
                      onClick={() => void exportWorld(w.name)}
                      disabled={busy}
                      title="Export as zip"
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                    >
                      <Download size={13} /> Export
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete world "${w.name}"? This cannot be undone.`)) {
                          void act(() => window.api.deleteWorld(instanceId, w.name))
                        }
                      }}
                      disabled={busy || running || w.active}
                      title={
                        w.active
                          ? 'Switch to another world first'
                          : running
                            ? 'Stop the server first'
                            : 'Delete this world'
                      }
                      className="rounded p-1 text-fg-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100 disabled:opacity-0"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {regenFor === w.name && (
                    <div className="flex items-center gap-2 border-t border-border bg-surface-2/50 px-9 py-2 text-xs">
                      <span className="text-fg-muted">Seed (blank = random):</span>
                      <input
                        value={regenSeed}
                        onChange={(e) => setRegenSeed(e.target.value)}
                        placeholder="e.g. 8675309"
                        className="w-48 rounded-md bg-input px-2 py-1 font-mono outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Regenerate "${w.name}"? Its current files are deleted and a fresh world generates on next start.`
                            )
                          ) {
                            setRegenFor(null)
                            void act(() => window.api.regenerateWorld(instanceId, w.name, regenSeed))
                          }
                        }}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-50"
                      >
                        <Sprout size={12} /> Regenerate
                      </button>
                      <button
                        onClick={() => setRegenFor(null)}
                        className="rounded-md px-2 py-1 text-fg-muted transition hover:text-fg"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {open && (
                    <div className="space-y-1 border-t border-border bg-surface-2/30 px-9 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                          Datapacks
                        </span>
                        <button
                          onClick={() => void act(() => window.api.addDatapacks(instanceId, w.name))}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                        >
                          <Plus size={11} /> Add
                        </button>
                      </div>
                      {w.datapacks.length === 0 ? (
                        <p className="text-xs text-fg-muted">No datapacks in this world.</p>
                      ) : (
                        w.datapacks.map((d) => (
                          <div key={d} className="flex items-center gap-2 text-xs">
                            <Package size={12} className="shrink-0 text-fg-muted" />
                            <span className="min-w-0 flex-1 truncate">{d}</span>
                            <button
                              onClick={() => {
                                if (confirm(`Remove datapack "${d}"?`)) {
                                  void act(() => window.api.deleteDatapack(instanceId, w.name, d))
                                }
                              }}
                              className="rounded p-0.5 text-fg-muted transition hover:text-red-400"
                              title="Remove datapack"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))
                      )}
                      <p className="pt-1 text-[11px] text-fg-muted">
                        Datapack changes need a restart (or <code>/reload</code>) to apply.
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
