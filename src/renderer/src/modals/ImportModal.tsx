import { useEffect, useState, type ReactElement } from 'react'
import { FolderOpen, Loader2, Check } from 'lucide-react'
import type { JavaInstall, ServerType } from '@shared/types'
import { SERVER_TYPES } from '@shared/software'
import { Modal } from '../components/Modal'
import { useApp } from '../store'

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? 'Imported server'
}

export default function ImportModal(): ReactElement {
  const close = useApp((s) => s.closeImport)
  const openTab = useApp((s) => s.openTab)
  const refreshIndex = useApp((s) => s.refreshIndex)
  const defaultRamMB = useApp((s) => s.config?.defaultRamMB ?? 2048)

  const [sourcePath, setSourcePath] = useState('')
  const [jars, setJars] = useState<string[]>([])
  const [javas, setJavas] = useState<JavaInstall[]>([])
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [serverType, setServerType] = useState<ServerType>('paper')
  const [mcVersion, setMcVersion] = useState('')
  const [launch, setLaunch] = useState('') // jar filename, or 'args-file'
  const [port, setPort] = useState(25565)
  const [ramMB] = useState(defaultRamMB)
  const [javaPath, setJavaPath] = useState('')

  useEffect(() => {
    void window.api.listJava().then((list) => {
      setJavas(list)
      if (list[0]) setJavaPath(list[0].path)
    })
  }, [])

  async function pickFolder(): Promise<void> {
    const dir = await window.api.pickDirectory()
    if (!dir) return
    setSourcePath(dir)
    setName(basename(dir))
    const found = await window.api.listFolderJars(dir)
    setJars(found)
    setLaunch(found.find((j) => j === 'server.jar') ?? found[0] ?? 'args-file')
  }

  const canImport = sourcePath && name.trim() && mcVersion.trim() && launch && javaPath

  async function doImport(): Promise<void> {
    if (!canImport) return
    setBusy(true)
    try {
      const result = await window.api.importInstance({
        sourcePath,
        name: name.trim(),
        serverType,
        mcVersion: mcVersion.trim(),
        launchKind: launch === 'args-file' ? 'args-file' : 'jar',
        launchJar: launch === 'args-file' ? undefined : launch,
        port,
        ramMB,
        javaPath,
        jvmArgs: [],
        groupId: null
      })
      await refreshIndex()
      openTab(result.instance.id)
      close()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Import existing server" onClose={close}>
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Server folder
          </span>
          <div className="flex gap-2">
            <input
              readOnly
              value={sourcePath}
              placeholder="No folder selected"
              className="flex-1 truncate rounded-md bg-input px-3 py-2 text-sm text-fg-muted outline-none"
            />
            <button
              onClick={() => void pickFolder()}
              className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-2 text-sm transition hover:bg-surface-2"
            >
              <FolderOpen size={15} /> Choose…
            </button>
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            The folder is copied into your servers directory.
          </p>
        </div>

        {sourcePath && (
          <>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Server type
                </span>
                <select
                  value={serverType}
                  onChange={(e) => setServerType(e.target.value as ServerType)}
                  className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                >
                  {SERVER_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Minecraft version
                </span>
                <input
                  value={mcVersion}
                  onChange={(e) => setMcVersion(e.target.value)}
                  placeholder="e.g. 1.21.4"
                  className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Launch
              </span>
              <select
                value={launch}
                onChange={(e) => setLaunch(e.target.value)}
                className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
              >
                {jars.map((j) => (
                  <option key={j} value={j}>
                    Run {j}
                  </option>
                ))}
                <option value="args-file">Forge / NeoForge (args file)</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Port
                </span>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Java
                </span>
                <select
                  value={javaPath}
                  onChange={(e) => setJavaPath(e.target.value)}
                  className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                >
                  {javas.map((j) => (
                    <option key={j.path} value={j.path}>
                      Java {j.major} ({j.version})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={() => void doImport()}
            disabled={!canImport || busy}
            className="inline-flex items-center gap-2 rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Import
          </button>
        </div>
      </div>
    </Modal>
  )
}
