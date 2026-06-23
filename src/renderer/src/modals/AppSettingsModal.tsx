import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { FolderOpen, RefreshCw, ExternalLink, Code2 } from 'lucide-react'
import type { JavaInstall } from '@shared/types'
import { Modal } from '../components/Modal'
import { useApp } from '../store'

function Switch({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): ReactElement {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${
        checked ? 'bg-accent' : 'bg-surface-2'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
          checked ? 'left-[1.125rem]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-fg-muted">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function ramLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

export default function AppSettingsModal(): ReactElement {
  const config = useApp((s) => s.config)
  const version = useApp((s) => s.appVersion)
  const close = useApp((s) => s.closeSettings)
  const updateConfig = useApp((s) => s.updateConfig)
  const chooseRoot = useApp((s) => s.chooseRoot)
  const openUpdateModal = useApp((s) => s.openUpdateModal)
  const [javas, setJavas] = useState<JavaInstall[]>([])

  useEffect(() => {
    void window.api.listJava().then(setJavas)
  }, [])

  if (!config) return <></>

  return (
    <Modal title="Settings" onClose={close}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Appearance
          </h3>
          <Row label="Theme" hint="Light or dark, matching the Birdflop brand.">
            <div className="flex rounded-brand bg-surface-2 p-0.5 text-sm">
              {(['dark', 'light'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => void updateConfig({ theme: t })}
                  className={`rounded-md px-3 py-1 capitalize transition ${
                    config.theme === t ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Row>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            New server defaults
          </h3>
          <Row label={`Default memory — ${ramLabel(config.defaultRamMB)}`}>
            <input
              type="range"
              min={512}
              max={16384}
              step={512}
              value={config.defaultRamMB}
              onChange={(e) => void updateConfig({ defaultRamMB: Number(e.target.value) })}
              className="w-40 accent-[var(--c-accent)]"
            />
          </Row>
          <Row label="Default Java">
            <select
              value={config.defaultJavaPath ?? ''}
              onChange={(e) => void updateConfig({ defaultJavaPath: e.target.value || null })}
              className="max-w-[16rem] rounded-md bg-input px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Auto (match version)</option>
              {javas.map((j) => (
                <option key={j.path} value={j.path}>
                  Java {j.major} ({j.version})
                </option>
              ))}
            </select>
          </Row>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Behavior
          </h3>
          <Row label="Desktop notifications" hint="Notify when a server is ready or crashes.">
            <Switch
              checked={config.notifications}
              onChange={(v) => void updateConfig({ notifications: v })}
            />
          </Row>
          <Row label="Auto-restart on crash" hint="Restart servers that exit unexpectedly.">
            <Switch
              checked={config.autoRestartOnCrash}
              onChange={(v) => void updateConfig({ autoRestartOnCrash: v })}
            />
          </Row>
          <Row label="Minimize to tray" hint="Keep servers running when you close the window.">
            <Switch
              checked={config.minimizeToTray}
              onChange={(v) => void updateConfig({ minimizeToTray: v })}
            />
          </Row>
          <Row label="Auto-check for updates" hint="Check on launch.">
            <Switch
              checked={config.autoUpdate}
              onChange={(v) => void updateConfig({ autoUpdate: v })}
            />
          </Row>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Storage
          </h3>
          <Row label="Servers folder" hint={config.rootPath ?? ''}>
            <button
              onClick={() => void chooseRoot()}
              className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
            >
              <FolderOpen size={14} /> Change…
            </button>
          </Row>
        </section>

        <section className="border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <div className="font-medium">Birdflop Server Manager</div>
              <div className="text-xs text-fg-muted">Version v{version}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={openUpdateModal}
                className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              >
                <RefreshCw size={14} /> Updates
              </button>
              <button
                onClick={() => void window.api.openExternal('https://birdflop.com')}
                className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              >
                <ExternalLink size={14} /> birdflop.com
              </button>
              <button
                onClick={() => void window.api.openExternal('https://github.com/birdflop')}
                className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              >
                <Code2 size={14} /> GitHub
              </button>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  )
}
