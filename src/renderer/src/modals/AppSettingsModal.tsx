import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { FolderOpen, RefreshCw, ExternalLink, Code2, Plus, Trash2, Zap, LayoutTemplate } from 'lucide-react'
import type { ConsoleMacro, JavaInstall } from '@shared/types'
import { SERVER_TYPE_MAP } from '@shared/software'
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
  const [rescanningJava, setRescanningJava] = useState(false)

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
            <div className="flex items-center gap-2">
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
              <button
                type="button"
                onClick={() => void rescanJava()}
                disabled={rescanningJava}
                title="Rescan for Java installations"
                className="shrink-0 rounded-md border border-border p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
              >
                <RefreshCw size={14} className={rescanningJava ? 'animate-spin' : ''} />
              </button>
            </div>
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
          <Row
            label="Release channel"
            hint={
              config.releaseChannel === 'dev'
                ? 'Dev builds ship the latest from main and may be unstable.'
                : 'Stable, vetted releases.'
            }
          >
            <div className="flex rounded-brand bg-surface-2 p-0.5 text-sm">
              {(['stable', 'dev'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => void updateConfig({ releaseChannel: c })}
                  className={`rounded-md px-3 py-1 capitalize transition ${
                    config.releaseChannel === c
                      ? 'bg-accent text-accent-fg'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </Row>
        </section>

        <MacrosSection />

        <TemplatesSection />

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

/** Edit the reusable console command shortcuts shown in every server's console. */
function MacrosSection(): ReactElement {
  const initial = useApp((s) => s.config?.consoleMacros ?? [])
  const updateConfig = useApp((s) => s.updateConfig)
  const [macros, setMacros] = useState<ConsoleMacro[]>(initial)

  function persist(next: ConsoleMacro[]): void {
    setMacros(next)
    void updateConfig({ consoleMacros: next })
  }

  return (
    <section>
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        <Zap size={12} /> Console macros
      </h3>
      <p className="mb-2 text-xs text-fg-muted">
        One-click command buttons shown above every server&apos;s console input.
      </p>
      <div className="space-y-2">
        {macros.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={m.label}
              placeholder="Label"
              onChange={(e) => setMacros((arr) => arr.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              onBlur={() => persist(macros)}
              className="w-32 rounded-md bg-input px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
            />
            <input
              value={m.command}
              placeholder="Command (e.g. save-all)"
              onChange={(e) =>
                setMacros((arr) => arr.map((x, j) => (j === i ? { ...x, command: e.target.value } : x)))
              }
              onBlur={() => persist(macros)}
              className="flex-1 rounded-md bg-input px-2 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={() => persist(macros.filter((_, j) => j !== i))}
              className="rounded p-1.5 text-fg-muted transition hover:text-red-400"
              title="Remove"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => persist([...macros, { label: '', command: '' }])}
        className="mt-2 inline-flex items-center gap-1.5 rounded-brand border border-dashed border-border px-3 py-1.5 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
      >
        <Plus size={13} /> Add macro
      </button>
    </section>
  )
}

/** Manage saved server-creation templates. */
function TemplatesSection(): ReactElement {
  const templates = useApp((s) => s.config?.templates ?? [])
  const updateConfig = useApp((s) => s.updateConfig)

  return (
    <section>
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        <LayoutTemplate size={12} /> Templates
      </h3>
      {templates.length === 0 ? (
        <p className="text-xs text-fg-muted">
          Save a server&apos;s settings as a template from its Settings tab to reuse them in the
          create wizard.
        </p>
      ) : (
        <div className="space-y-1.5">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <span className="shrink-0 text-xs text-fg-muted">
                {SERVER_TYPE_MAP[t.serverType].label} {t.mcVersion}
              </span>
              <button
                onClick={() => void updateConfig({ templates: templates.filter((x) => x.id !== t.id) })}
                className="rounded p-1 text-fg-muted transition hover:text-red-400"
                title="Delete template"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
