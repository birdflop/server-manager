import { useEffect, useState, type ReactElement } from 'react'
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2
} from 'lucide-react'
import type { PteroBackup } from '@shared/types'
import { friendlyError } from '../errors'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/** Panel-side backups for a remote server: list, create, restore, download, delete. */
export function PanelBackupsView({ serverId }: { serverId: string }): ReactElement {
  const [backups, setBackups] = useState<PteroBackup[] | null>(null)
  const [creating, setCreating] = useState(false)
  /** The backup a restore/delete is currently running against, if any. */
  const [rowBusy, setRowBusy] = useState<{ uuid: string; kind: 'restore' | 'delete' } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    try {
      setBackups(await window.api.pteroListBackups(serverId))
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
      setBackups((prev) => prev ?? [])
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  // While a backup is still being taken, poll until it completes.
  const inProgress = backups?.some((b) => b.completedAt === null) ?? false
  useEffect(() => {
    if (!inProgress) return
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inProgress])

  async function createBackup(): Promise<void> {
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      setBackups(await window.api.pteroCreateBackup(serverId))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setCreating(false)
    }
  }

  async function rowAction(
    uuid: string,
    kind: 'restore' | 'delete',
    action: () => Promise<PteroBackup[] | void>,
    doneNotice?: string
  ): Promise<void> {
    setRowBusy({ uuid, kind })
    setError(null)
    setNotice(null)
    try {
      const result = await action()
      if (result) setBackups(result)
      if (doneNotice) setNotice(doneNotice)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setRowBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-fg-muted">
          Backups are stored on the panel and count toward its backup limit.
        </p>
        <button
          onClick={() => void refresh()}
          title="Refresh"
          className="rounded-md border border-border p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <RefreshCw size={13} />
        </button>
        <button
          onClick={() => void createBackup()}
          disabled={creating}
          className="inline-flex items-center gap-1.5 rounded-brand bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-50"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
          backup
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-brand border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 rounded-brand border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-fg">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent" />
          {notice}
        </div>
      )}

      {backups === null ? (
        <div className="grid flex-1 place-items-center text-fg-muted">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : backups.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center text-sm text-fg-muted">
          <div>
            <Archive className="mx-auto mb-2 opacity-40" size={28} />
            No backups yet.
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {backups.map((b) => {
            const running = b.completedAt === null
            return (
              <div
                key={b.uuid}
                className="flex items-center gap-3 rounded-brand border border-border bg-surface px-3 py-2.5"
              >
                {running ? (
                  <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
                ) : (
                  <Archive
                    size={16}
                    className={`shrink-0 ${b.successful ? 'text-accent-2' : 'text-red-400'}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-sm">
                    {b.name}
                    {b.locked && (
                      <span title="Locked on the panel" className="shrink-0 text-fg-muted">
                        <Lock size={11} />
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-fg-muted">
                    {running
                      ? 'In progress…'
                      : `${formatSize(b.size)} · ${new Date(b.createdAt).toLocaleString()}${
                          b.successful ? '' : ' · failed'
                        }`}
                  </div>
                </div>
                <button
                  onClick={() =>
                    void window.api
                      .pteroDownloadBackup(serverId, b.uuid)
                      .catch((err) => setError(friendlyError(err)))
                  }
                  disabled={running || !b.successful}
                  title="Download archive"
                  className="rounded-md border border-border p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={() => {
                    if (
                      confirm(
                        `Restore "${b.name}"? This overwrites the server's current files with the backup.`
                      )
                    )
                      void rowAction(
                        b.uuid,
                        'restore',
                        () => window.api.pteroRestoreBackup(serverId, b.uuid),
                        `Restore of "${b.name}" started — the panel is applying it in the background.`
                      )
                  }}
                  disabled={rowBusy !== null || running || !b.successful}
                  title="Restore this backup"
                  className="rounded-md border border-border p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                >
                  {rowBusy?.uuid === b.uuid && rowBusy.kind === 'restore' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RotateCcw size={14} />
                  )}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete backup "${b.name}"? This can't be undone.`))
                      void rowAction(b.uuid, 'delete', () =>
                        window.api.pteroDeleteBackup(serverId, b.uuid)
                      )
                  }}
                  disabled={rowBusy !== null || running || b.locked}
                  title={b.locked ? 'Locked backups can’t be deleted' : 'Delete backup'}
                  className="rounded-md border border-border p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-red-400 disabled:opacity-40"
                >
                  {rowBusy?.uuid === b.uuid && rowBusy.kind === 'delete' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
