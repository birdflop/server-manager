import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { AlertCircle, Check, Download, HardDriveDownload, Loader2, RotateCw } from 'lucide-react'
import type {
  InstallProgress,
  JavaInstall,
  PteroClonePrefill,
  ServerType
} from '@shared/types'
import { SERVER_TYPES } from '@shared/software'
import { Modal } from '../components/Modal'
import { friendlyError } from '../errors'
import { useApp } from '../store'

/** Java to download when the MC version is unknown (current LTS used by modern servers). */
const FALLBACK_JAVA_MAJOR = 21

function ramLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

/** Clone a remote panel server 1:1 into a local test instance. */
export function ClonePanelServerModal({
  serverId,
  onClose
}: {
  serverId: string
  onClose: () => void
}): ReactElement {
  const openTab = useApp((s) => s.openTab)
  const refreshIndex = useApp((s) => s.refreshIndex)

  const [prefill, setPrefill] = useState<PteroClonePrefill | null>(null)
  const [prepError, setPrepError] = useState<string | null>(null)
  const [javas, setJavas] = useState<JavaInstall[]>([])

  const [name, setName] = useState('')
  const [serverType, setServerType] = useState<ServerType>('paper')
  const [mcVersion, setMcVersion] = useState('')
  const [launchKind, setLaunchKind] = useState<'jar' | 'args-file'>('jar')
  const [launchJar, setLaunchJar] = useState('server.jar')
  const [port, setPort] = useState(25565)
  const [ramMB, setRamMB] = useState(2048)
  const [javaPath, setJavaPath] = useState('')

  const [cloning, setCloning] = useState(false)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [javaBusy, setJavaBusy] = useState(false)
  const [javaPhase, setJavaPhase] = useState<string | null>(null)

  // Inspect the remote server and prefill everything we can guess.
  const prepare = useCallback(async (): Promise<void> => {
    setPrepError(null)
    try {
      const [p, javaList, instances] = await Promise.all([
        window.api.pteroClonePrepare(serverId),
        window.api.listJava(),
        window.api.listInstances()
      ])
      setJavas(javaList)
      setPrefill(p)
      setName(p.name)
      if (p.serverType) setServerType(p.serverType)
      setMcVersion(p.mcVersion ?? '')
      setLaunchKind(p.launchKind)
      if (p.launchJar) setLaunchJar(p.launchJar)
      setRamMB(p.ramMB)
      // Avoid colliding with an existing local server's port.
      const used = new Set(instances.map((i) => i.port))
      let candidate = p.port
      while (used.has(candidate)) candidate++
      setPort(candidate)
      // Prefer a Java matching the guessed MC version.
      let chosen = javaList[0]?.path ?? ''
      if (p.mcVersion) {
        const major = await window.api.requiredJava(p.mcVersion).catch(() => null)
        const match = major !== null ? javaList.find((j) => j.major === major) : undefined
        if (match) chosen = match.path
      }
      setJavaPath(chosen)
    } catch (err) {
      setPrepError(friendlyError(err))
    }
  }, [serverId])

  useEffect(() => {
    void prepare()
  }, [prepare])

  /** Fetch a Temurin runtime when no local Java was detected. */
  async function downloadJava(): Promise<void> {
    setJavaBusy(true)
    setJavaPhase('Starting…')
    setError(null)
    const unsub = window.api.onJavaProgress((p) => {
      if (p.phase === 'download' && p.total) {
        setJavaPhase(`Downloading… ${Math.round(((p.received ?? 0) / p.total) * 100)}%`)
      } else if (p.phase === 'extract') {
        setJavaPhase('Extracting…')
      }
    })
    try {
      const major = mcVersion.trim()
        ? await window.api.requiredJava(mcVersion.trim()).catch(() => FALLBACK_JAVA_MAJOR)
        : FALLBACK_JAVA_MAJOR
      const install = await window.api.ensureJava(major)
      setJavas(await window.api.listJava())
      setJavaPath(install.path)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      unsub()
      setJavaBusy(false)
      setJavaPhase(null)
    }
  }

  const canClone =
    prefill &&
    name.trim() &&
    mcVersion.trim() &&
    javaPath &&
    (launchKind === 'args-file' || launchJar.trim()) &&
    !cloning

  async function doClone(): Promise<void> {
    if (!canClone) return
    setCloning(true)
    setError(null)
    setProgress({ phase: 'resolve' })
    const unsub = window.api.onPteroCloneProgress(setProgress)
    try {
      const result = await window.api.pteroCloneServer({
        serverId,
        name: name.trim(),
        serverType,
        mcVersion: mcVersion.trim(),
        launchKind,
        launchJar: launchKind === 'jar' ? launchJar.trim() : undefined,
        port,
        ramMB,
        javaPath,
        jvmArgs: prefill?.jvmArgs ?? [],
        groupId: null
      })
      await refreshIndex()
      openTab(result.instance.id)
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      unsub()
      setCloning(false)
      setProgress(null)
    }
  }

  const progressText = progress
    ? progress.phase === 'download' && progress.received
      ? `Downloading server archive… ${mb(progress.received)}${progress.total ? ` / ${mb(progress.total)}` : ''}`
      : (progress.message ??
        {
          resolve: 'Creating archive on the panel…',
          download: 'Downloading server archive…',
          install: 'Extracting server files…',
          configure: 'Configuring the local copy…',
          done: 'Done!',
          error: 'Error'
        }[progress.phase])
    : null

  const inputCls =
    'w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent'
  const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted'

  return (
    <Modal
      title="Clone server locally"
      onClose={
        cloning
          ? () => {
              // The clone call rejects with "Clone canceled"; the modal stays open to show it.
              if (confirm('Cancel the clone?')) void window.api.pteroCloneCancel()
            }
          : onClose
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-fg-muted">
          Copies every file from the panel server into a new local instance — worlds, plugins, and
          configs included — so you can test changes without touching production.
        </p>

        {prepError ? (
          <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertCircle size={14} className="shrink-0" />
            <span className="min-w-0 flex-1">{prepError}</span>
            <button
              onClick={() => void prepare()}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-red-500/40 px-2 py-1 transition hover:bg-red-500/20"
            >
              <RotateCw size={12} /> Try again
            </button>
          </div>
        ) : !prefill ? (
          <div className="flex items-center gap-2 py-4 text-sm text-fg-muted">
            <Loader2 size={15} className="animate-spin" /> Inspecting the remote server…
          </div>
        ) : (
          <>
            <label className="block">
              <span className={labelCls}>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className={labelCls}>Server type</span>
                <select
                  value={serverType}
                  onChange={(e) => setServerType(e.target.value as ServerType)}
                  className={inputCls}
                >
                  {SERVER_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>Minecraft version</span>
                <input
                  value={mcVersion}
                  onChange={(e) => setMcVersion(e.target.value)}
                  placeholder="e.g. 1.21.4"
                  className={inputCls}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className={labelCls}>Launch</span>
                <select
                  value={launchKind}
                  onChange={(e) => setLaunchKind(e.target.value as 'jar' | 'args-file')}
                  className={inputCls}
                >
                  <option value="jar">Run a jar</option>
                  <option value="args-file">Forge / NeoForge (args file)</option>
                </select>
              </label>
              {launchKind === 'jar' ? (
                <label className="block">
                  <span className={labelCls}>Jar file</span>
                  <input
                    value={launchJar}
                    onChange={(e) => setLaunchJar(e.target.value)}
                    placeholder="server.jar"
                    className={`${inputCls} font-mono`}
                  />
                </label>
              ) : (
                <div />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className={labelCls}>Port</span>
                <input
                  type="number"
                  value={port}
                  min={1}
                  max={65535}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Memory — {ramLabel(ramMB)}</span>
                <input
                  type="range"
                  min={512}
                  max={16384}
                  step={512}
                  value={ramMB}
                  onChange={(e) => setRamMB(Number(e.target.value))}
                  className="mt-3 w-full accent-[var(--c-accent)]"
                />
              </label>
            </div>

            <label className="block">
              <span className={labelCls}>Java</span>
              <select value={javaPath} onChange={(e) => setJavaPath(e.target.value)} className={inputCls}>
                {javas.length === 0 && <option value="">No Java detected</option>}
                {javas.map((j) => (
                  <option key={j.path} value={j.path}>
                    Java {j.major} ({j.version})
                  </option>
                ))}
              </select>
              {javas.length === 0 && (
                <button
                  type="button"
                  onClick={() => void downloadJava()}
                  disabled={javaBusy}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-accent hover:underline disabled:opacity-50"
                >
                  {javaBusy ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Download size={12} />
                  )}
                  {javaBusy ? (javaPhase ?? 'Downloading…') : 'Download a Java runtime automatically'}
                </button>
              )}
            </label>
          </>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {cloning && progressText && (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="animate-spin" size={15} />
            <span className="min-w-0 flex-1">{progressText}</span>
            <button
              onClick={() => void window.api.pteroCloneCancel()}
              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs transition hover:bg-surface-2 hover:text-fg"
            >
              Cancel
            </button>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={() => void doClone()}
            disabled={!canClone}
            className="inline-flex items-center gap-2 rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
          >
            {cloning ? (
              <Loader2 className="animate-spin" size={15} />
            ) : prefill ? (
              <Check size={15} />
            ) : (
              <HardDriveDownload size={15} />
            )}
            Clone locally
          </button>
        </div>
      </div>
    </Modal>
  )
}
