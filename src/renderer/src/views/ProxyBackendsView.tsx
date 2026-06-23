import { useEffect, useState, type ReactElement } from 'react'
import { Plus, Trash2, Save, Loader2, Network, Server, AlertTriangle } from 'lucide-react'
import type { Instance, ProxyBackend, ServerStatus } from '@shared/types'
import { isProxy } from '@shared/software'
import { useApp } from '../store'
import { StatusDot } from '../components/StatusDot'

export function ProxyBackendsView({
  instance,
  status
}: {
  instance: Instance
  status: ServerStatus
}): ReactElement {
  const allStatus = useApp((s) => s.status)
  const [backends, setBackends] = useState<ProxyBackend[]>([])
  const [candidates, setCandidates] = useState<Instance[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let live = true
    void Promise.all([
      window.api.getProxyBackends(instance.id),
      window.api.listInstances()
    ]).then(([b, list]) => {
      if (!live) return
      setBackends(b)
      // Candidate backends: other managed Minecraft servers (not proxies).
      setCandidates(list.filter((i) => i.id !== instance.id && !isProxy(i.serverType)))
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [instance.id])

  function addFromInstance(inst: Instance): void {
    setBackends((b) => [
      ...b,
      { name: inst.name, address: `127.0.0.1:${inst.port}`, instanceId: inst.id }
    ])
    setDirty(true)
  }

  function addManual(): void {
    setBackends((b) => [...b, { name: `server-${b.length + 1}`, address: '127.0.0.1:25565' }])
    setDirty(true)
  }

  function update(idx: number, patch: Partial<ProxyBackend>): void {
    setBackends((b) => b.map((x, i) => (i === idx ? { ...x, ...patch } : x)))
    setDirty(true)
  }

  function remove(idx: number): void {
    setBackends((b) => b.filter((_, i) => i !== idx))
    setDirty(true)
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      const saved = await window.api.setProxyBackends(instance.id, backends)
      setBackends(saved)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  // Instances not already added, for the quick-add list.
  const addedIds = new Set(backends.map((b) => b.instanceId).filter(Boolean))
  const available = candidates.filter((c) => !addedIds.has(c.id))

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-fg-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Network size={15} /> Backend servers
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Servers this proxy routes players to. Saved into the proxy&apos;s config file.
          </p>
        </div>
        <button
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
        >
          {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
          Save
        </button>
      </div>

      {status !== 'stopped' && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={14} /> Restart the proxy to apply backend changes.
        </div>
      )}

      {/* Current backends */}
      <section className="rounded-brand border border-border bg-surface p-3">
        {backends.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-fg-muted">
            No backends yet. Add a server below.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {backends.map((b, i) => {
              const linked = b.instanceId ? allStatus[b.instanceId] ?? 'stopped' : null
              return (
                <div key={i} className="flex items-center gap-2">
                  {linked ? <StatusDot status={linked} size={8} /> : <Server size={14} className="text-fg-muted" />}
                  <input
                    value={b.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="name"
                    className="w-40 rounded-md bg-input px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
                  />
                  <input
                    value={b.address}
                    onChange={(e) => update(i, { address: e.target.value })}
                    placeholder="host:port"
                    className="flex-1 rounded-md bg-input px-2 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={() => remove(i)}
                    className="rounded p-1.5 text-fg-muted transition hover:text-red-400"
                    title="Remove"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Quick-add managed servers */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Add a managed server
        </h3>
        {available.length === 0 ? (
          <p className="text-xs text-fg-muted">
            All your other servers are already added. Use “Add custom” for an external address.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((c) => (
              <button
                key={c.id}
                onClick={() => addFromInstance(c)}
                className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-1.5 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              >
                <Plus size={13} /> {c.name}
                <span className="text-fg-muted/60">:{c.port}</span>
              </button>
            ))}
          </div>
        )}
        <button
          onClick={addManual}
          className="mt-2 inline-flex items-center gap-1.5 rounded-brand border border-dashed border-border px-3 py-1.5 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <Plus size={13} /> Add custom address
        </button>
      </section>
    </div>
  )
}
