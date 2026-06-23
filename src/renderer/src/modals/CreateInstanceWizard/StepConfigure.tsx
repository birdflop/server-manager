import { useEffect, useState, type ReactElement } from 'react'
import { Loader2, Download, Cpu, Check, AlertTriangle } from 'lucide-react'
import type { JavaInstall } from '@shared/types'

export interface ConfigureForm {
  name: string
  port: number
  ramMB: number
  javaPath: string
  jvmArgs: string
  eula: boolean
}

function ramLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

export function StepConfigure({
  mcVersion,
  form,
  update
}: {
  mcVersion: string
  form: ConfigureForm
  update: (patch: Partial<ConfigureForm>) => void
}): ReactElement {
  const [javas, setJavas] = useState<JavaInstall[] | null>(null)
  const [required, setRequired] = useState<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [dlPct, setDlPct] = useState(0)
  const [dlPhase, setDlPhase] = useState('')

  async function refreshJava(): Promise<JavaInstall[]> {
    const list = await window.api.listJava()
    setJavas(list)
    return list
  }

  useEffect(() => {
    void window.api.requiredJava(mcVersion).then(setRequired)
    void refreshJava().then((list) => {
      // Preselect a satisfying Java if none chosen yet.
      if (!form.javaPath && list.length > 0) {
        window.api.requiredJava(mcVersion).then((req) => {
          const best = list.find((j) => j.major >= req) ?? list[0]
          update({ javaPath: best.path })
        })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcVersion])

  const hasSatisfying =
    required !== null && (javas ?? []).some((j) => j.major >= required)

  async function downloadJava(): Promise<void> {
    if (required === null) return
    setDownloading(true)
    setDlPct(0)
    setDlPhase('Starting…')
    const unsub = window.api.onJavaProgress((p) => {
      if (p.phase === 'download' && p.total) setDlPct(Math.round((p.received! / p.total) * 100))
      setDlPhase(p.phase === 'download' ? 'Downloading' : p.phase === 'extract' ? 'Extracting' : p.phase)
    })
    try {
      const install = await window.api.ensureJava(required)
      await refreshJava()
      update({ javaPath: install.path })
    } catch {
      setDlPhase('error')
    } finally {
      unsub()
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Server name">
        <input
          value={form.name}
          onChange={(e) => update({ name: e.target.value })}
          className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Port">
          <input
            type="number"
            value={form.port}
            min={1}
            max={65535}
            onChange={(e) => update({ port: Number(e.target.value) })}
            className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
          />
        </Field>
        <Field label={`Memory — ${ramLabel(form.ramMB)}`}>
          <input
            type="range"
            min={512}
            max={16384}
            step={512}
            value={form.ramMB}
            onChange={(e) => update({ ramMB: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--c-accent)]"
          />
        </Field>
      </div>

      <Field label="Java installation">
        {javas === null ? (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="animate-spin" size={15} /> Detecting…
          </div>
        ) : (
          <>
            <div className="relative">
              <Cpu
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
              />
              <select
                value={form.javaPath}
                onChange={(e) => update({ javaPath: e.target.value })}
                className="w-full appearance-none rounded-md bg-input py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-accent"
              >
                {javas.length === 0 && <option value="">No Java detected</option>}
                {javas.map((j) => (
                  <option key={j.path} value={j.path}>
                    Java {j.major} ({j.version}){j.managed ? ' • managed' : ''}
                    {required !== null && j.major < required ? ' — too old' : ''}
                  </option>
                ))}
              </select>
            </div>
            {required !== null && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                {hasSatisfying ? (
                  <span className="flex items-center gap-1 text-fg-muted">
                    <Check size={12} className="text-accent" /> Needs Java {required}+
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-400">
                    <AlertTriangle size={12} /> Needs Java {required}+ — none installed
                  </span>
                )}
              </div>
            )}
            {!hasSatisfying && required !== null && (
              <button
                onClick={() => void downloadJava()}
                disabled={downloading}
                className="mt-2 inline-flex items-center gap-2 rounded-md bg-accent-2 px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {downloading ? (
                  <>
                    <Loader2 className="animate-spin" size={13} /> {dlPhase}{' '}
                    {dlPhase === 'Downloading' ? `${dlPct}%` : ''}
                  </>
                ) : (
                  <>
                    <Download size={13} /> Download Temurin {required}
                  </>
                )}
              </button>
            )}
          </>
        )}
      </Field>

      <Field label="Extra JVM arguments (optional)">
        <input
          value={form.jvmArgs}
          onChange={(e) => update({ jvmArgs: e.target.value })}
          placeholder="-XX:+UseG1GC -Dfile.encoding=UTF-8"
          className="w-full rounded-md bg-input px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
        />
      </Field>

      <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-3 text-sm">
        <input
          type="checkbox"
          checked={form.eula}
          onChange={(e) => update({ eula: e.target.checked })}
          className="h-4 w-4 accent-[var(--c-accent)]"
        />
        <span>
          I accept the{' '}
          <span className="text-accent">Minecraft EULA</span> (writes <code>eula=true</code>)
        </span>
      </label>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  )
}
