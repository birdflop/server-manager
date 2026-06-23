import type { ReactElement } from 'react'
import { Download, RefreshCw, RotateCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { Modal } from '../components/Modal'
import { useApp } from '../store'

export default function UpdateModal(): ReactElement {
  const version = useApp((s) => s.appVersion)
  const update = useApp((s) => s.update)
  const close = useApp((s) => s.closeUpdateModal)
  const check = useApp((s) => s.checkForUpdates)
  const download = useApp((s) => s.downloadUpdate)
  const install = useApp((s) => s.installUpdate)

  return (
    <Modal title="Updates" onClose={close}>
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="text-sm text-fg-muted">
          Current version <span className="font-mono text-fg">v{version || '…'}</span>
        </div>

        {update.state === 'checking' && (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="animate-spin" size={16} /> Checking for updates…
          </div>
        )}

        {(update.state === 'idle' || update.state === 'not-available') && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle size={16} className="text-emerald-400" /> You’re on the latest version.
            </div>
            <CheckButton onClick={() => void check()} />
          </>
        )}

        {update.state === 'available' && (
          <>
            <div className="text-sm">
              Version <span className="font-semibold text-accent">v{update.version}</span> is
              available.
            </div>
            <button
              onClick={() => void download()}
              className="inline-flex items-center gap-2 rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110"
            >
              <Download size={16} /> Download update
            </button>
          </>
        )}

        {update.state === 'downloading' && (
          <div className="w-full max-w-xs">
            <div className="mb-2 text-sm text-fg-muted">Downloading… {update.percent ?? 0}%</div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${update.percent ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {update.state === 'downloaded' && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle size={16} className="text-emerald-400" /> Version v{update.version} is
              ready to install.
            </div>
            <button
              onClick={() => void install()}
              className="inline-flex items-center gap-2 rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110"
            >
              <RotateCw size={16} /> Restart &amp; install
            </button>
          </>
        )}

        {update.state === 'error' && (
          <>
            <div className="flex items-center gap-2 text-sm text-red-300">
              <AlertCircle size={16} /> {update.message || 'Update check failed.'}
            </div>
            <CheckButton onClick={() => void check()} />
          </>
        )}

        {update.state === 'dev' && (
          <div className="text-sm text-fg-muted">
            Auto-updates are only available in packaged (installed) builds.
          </div>
        )}
      </div>
    </Modal>
  )
}

function CheckButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-brand border border-border px-4 py-2 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
    >
      <RefreshCw size={15} /> Check for updates
    </button>
  )
}
