import { useEffect, useState, type ReactElement } from 'react'
import { Archive, RotateCcw, Trash2, Loader2, Plus, AlertCircle, Clock, Save } from 'lucide-react'
import type { BackupInfo, BackupScheduleConfig, ServerStatus } from '@shared/types'
import { DEFAULT_BACKUP_SCHEDULE } from '@shared/types'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

const KIND_BADGE: Record<BackupInfo['kind'], { label: string; className: string } | null> = {
  manual: null,
  auto: { label: 'auto', className: 'bg-accent/15 text-accent' },
  'pre-restore': { label: 'pre-restore', className: 'bg-amber-500/15 text-amber-400' }
}

export function BackupsView({
  instanceId,
  status
}: {
  instanceId: string
  status: ServerStatus
}): ReactElement {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Automatic backup schedule (persisted on the instance).
  const [schedule, setSchedule] = useState<BackupScheduleConfig>(DEFAULT_BACKUP_SCHEDULE)
  const [savedSchedule, setSavedSchedule] = useState<BackupScheduleConfig>(DEFAULT_BACKUP_SCHEDULE)
  const [savingSchedule, setSavingSchedule] = useState(false)

  async function refresh(): Promise<void> {
    setBackups(await window.api.listBackups(instanceId))
  }

  useEffect(() => {
    void refresh()
    void window.api.getInstance(instanceId).then((inst) => {
      const s = inst?.backup ?? DEFAULT_BACKUP_SCHEDULE
      setSchedule(s)
      setSavedSchedule(s)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  const scheduleDirty = JSON.stringify(schedule) !== JSON.stringify(savedSchedule)

  async function saveSchedule(): Promise<void> {
    setSavingSchedule(true)
    try {
      const clean: BackupScheduleConfig = {
        enabled: schedule.enabled,
        intervalHours: Math.max(0.25, schedule.intervalHours || 6),
        keep: Math.max(1, Math.round(schedule.keep || 10))
      }
      await window.api.updateInstance(instanceId, { backup: clean })
      setSchedule(clean)
      setSavedSchedule(clean)
    } finally {
      setSavingSchedule(false)
    }
  }

  async function create(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      setBackups(await window.api.createBackup(instanceId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function restore(name: string): Promise<void> {
    if (!confirm(`Restore "${name}"? This replaces the current server files.`)) return
    setBusy(true)
    setError(null)
    try {
      await window.api.restoreBackup(instanceId, name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function del(name: string): Promise<void> {
    if (!confirm(`Delete backup "${name}"?`)) return
    setBackups(await window.api.deleteBackup(instanceId, name))
  }

  const running = status !== 'stopped'

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-3 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Backups</h2>
          <p className="text-xs text-fg-muted">
            Snapshots of this server&apos;s entire folder (world, config, plugins/mods).
          </p>
        </div>
        <button
          onClick={() => void create()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-brand bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Create backup
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Automatic backups */}
      <section className="rounded-brand border border-border bg-surface p-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            <Clock size={13} /> Automatic backups
          </h3>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
              className="h-4 w-4 accent-[var(--c-accent)]"
            />
            Enabled
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-muted">
          <span className="flex items-center gap-1.5">
            Every
            <input
              type="number"
              min={0.25}
              step={0.5}
              value={schedule.intervalHours}
              disabled={!schedule.enabled}
              onChange={(e) => setSchedule({ ...schedule, intervalHours: Number(e.target.value) })}
              className="w-16 rounded-md bg-input px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
            />
            hours while running
          </span>
          <span className="flex items-center gap-1.5">
            keep last
            <input
              type="number"
              min={1}
              value={schedule.keep}
              disabled={!schedule.enabled}
              onChange={(e) => setSchedule({ ...schedule, keep: Number(e.target.value) })}
              className="w-14 rounded-md bg-input px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent disabled:opacity-40"
            />
          </span>
          {scheduleDirty && (
            <button
              onClick={() => void saveSchedule()}
              disabled={savingSchedule}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-50"
            >
              {savingSchedule ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-fg-muted">
          World saves are flushed and paused during the snapshot, so archives are consistent.
          Restoring always makes a “pre-restore” safety snapshot first.
        </p>
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-brand border border-border">
        {backups === null ? (
          <div className="flex h-full items-center justify-center text-fg-muted">
            <Loader2 className="animate-spin" size={18} />
          </div>
        ) : backups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fg-muted">
            <Archive size={26} className="opacity-50" />
            <p className="text-sm">No backups yet.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {backups.map((b) => (
              <div
                key={b.name}
                className="group flex items-center gap-3 border-b border-border px-3 py-2.5 text-sm last:border-0 hover:bg-surface-2"
              >
                <Archive size={16} className="shrink-0 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{new Date(b.createdAt).toLocaleString()}</span>
                    {KIND_BADGE[b.kind] && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[b.kind]!.className}`}
                      >
                        {KIND_BADGE[b.kind]!.label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-fg-muted">{formatSize(b.size)}</div>
                </div>
                <button
                  onClick={() => void restore(b.name)}
                  disabled={running || busy}
                  title={running ? 'Stop the server to restore' : 'Restore this backup'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                >
                  <RotateCcw size={13} /> Restore
                </button>
                <button
                  onClick={() => void del(b.name)}
                  className="rounded p-1 text-fg-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  title="Delete backup"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
