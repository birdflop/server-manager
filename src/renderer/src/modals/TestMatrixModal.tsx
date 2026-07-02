import { useEffect, useState, type ReactElement } from 'react'
import {
  Loader2,
  Check,
  X,
  Grid3x3,
  Upload,
  AlertCircle,
  AlertTriangle,
  CircleDashed,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  FlaskConical,
  Square
} from 'lucide-react'
import type { CompatCell, CompatRun, JavaInstall, ServerType } from '@shared/types'
import { SERVER_TYPES, SERVER_TYPE_MAP } from '@shared/software'
import { Modal } from '../components/Modal'
import { useApp } from '../store'

/** Only real Minecraft servers make sense in a compatibility matrix (not proxies). */
const MATRIX_TYPES = SERVER_TYPES.filter((t) => t.category === 'server')

type CellStatus = 'pending' | 'working' | 'done' | 'error'
interface Cell {
  status: CellStatus
  message?: string
}

function ramLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

export default function TestMatrixModal(): ReactElement {
  const closeMatrix = useApp((s) => s.closeMatrix)
  const refreshIndex = useApp((s) => s.refreshIndex)
  const config = useApp((s) => s.config)

  const [serverType, setServerType] = useState<ServerType>('paper')
  const [versions, setVersions] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [jarPaths, setJarPaths] = useState<string[]>([])
  const [ramMB, setRamMB] = useState(config?.defaultRamMB ?? 2048)
  const [basePort, setBasePort] = useState(25565)
  const [eula, setEula] = useState(true)
  const [javaPath, setJavaPath] = useState<string>('') // '' = auto (per-version)
  const [javas, setJavas] = useState<JavaInstall[]>([])
  const [groupName, setGroupName] = useState('')
  const [smokeText, setSmokeText] = useState('')

  const [creating, setCreating] = useState(false)
  const [cells, setCells] = useState<Record<string, Cell>>({})
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** version → created instance id, for the compat run. */
  const [createdIds, setCreatedIds] = useState<Record<string, string>>({})

  const [run, setRun] = useState<CompatRun | null>(null)
  const [startingRun, setStartingRun] = useState(false)
  const [copied, setCopied] = useState(false)

  // Fetch versions whenever the software changes.
  useEffect(() => {
    setVersions(null)
    setSelected(new Set())
    void window.api
      .getGameVersions(serverType)
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [serverType])

  useEffect(() => {
    void window.api.listJava().then(setJavas)
  }, [])

  // Live compat-run progress.
  useEffect(() => window.api.onCompatProgress(setRun), [])

  // Default the group name to the chosen software.
  useEffect(() => {
    if (!groupName.trim()) setGroupName(`${SERVER_TYPE_MAP[serverType].label} matrix`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverType])

  function toggle(v: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }

  function selectLatest(n: number): void {
    if (!versions) return
    setSelected(new Set(versions.slice(0, n)))
  }

  async function pickJars(): Promise<void> {
    const paths = await window.api.pickFiles()
    if (paths.length) setJarPaths(paths)
  }

  const orderedSelection = (versions ?? []).filter((v) => selected.has(v))
  const canCreate = orderedSelection.length > 0 && !!groupName.trim() && eula

  async function create(): Promise<void> {
    if (orderedSelection.length === 0) return
    setCreating(true)
    setError(null)
    setDone(false)
    setCells(Object.fromEntries(orderedSelection.map((v) => [v, { status: 'pending' } as Cell])))

    try {
      // Make a dedicated group to hold the matrix.
      const before = new Set((await window.api.getIndex()).groups.map((g) => g.id))
      const index = await window.api.createGroup(groupName.trim())
      const newGroup = index.groups.find((g) => !before.has(g.id))
      const groupId = newGroup?.id ?? null

      const ids: Record<string, string> = {}
      for (let i = 0; i < orderedSelection.length; i++) {
        const version = orderedSelection[i]
        setCells((c) => ({ ...c, [version]: { status: 'working' } }))
        try {
          const builds = await window.api.getBuilds(serverType, version)
          if (!builds.length) throw new Error('No build available for this version')

          // Resolve a fitting Java runtime — auto mode picks (and downloads) the right major per version.
          let java = javaPath
          if (!java) {
            const major = await window.api.requiredJava(version)
            java = (await window.api.ensureJava(major)).path
          }

          const { instance } = await window.api.createInstance({
            name: `${SERVER_TYPE_MAP[serverType].label} ${version}`,
            serverType,
            mcVersion: version,
            build: builds[0].id,
            port: basePort + i,
            ramMB,
            javaPath: java,
            jvmArgs: [],
            eulaAccepted: eula,
            groupId
          })

          if (jarPaths.length) await window.api.addContentFiles(instance.id, jarPaths)
          ids[version] = instance.id
          setCells((c) => ({ ...c, [version]: { status: 'done' } }))
        } catch (e) {
          setCells((c) => ({
            ...c,
            [version]: { status: 'error', message: e instanceof Error ? e.message : String(e) }
          }))
        }
      }
      setCreatedIds(ids)
      await refreshIndex()
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  async function startCompat(): Promise<void> {
    const ids = orderedSelection.map((v) => createdIds[v]).filter(Boolean)
    if (!ids.length) return
    setStartingRun(true)
    setError(null)
    try {
      const smokeCommands = smokeText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      setRun(await window.api.startCompatRun(ids, { smokeCommands }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStartingRun(false)
    }
  }

  async function copyReport(): Promise<void> {
    if (!run) return
    await window.api.copyText(
      buildReport(run, groupName.trim(), SERVER_TYPE_MAP[serverType].label, jarPaths)
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const javaOptions = javas.some((j) => j.path === javaPath)
    ? javas
    : javaPath
      ? [{ path: javaPath, version: '?', major: 0 } as JavaInstall, ...javas]
      : javas

  const runActive = run?.state === 'running'
  const createdCount = orderedSelection.filter((v) => createdIds[v]).length
  const locked = creating || runActive || startingRun

  const footer = runActive ? (
    <>
      <span className="flex-1 text-sm text-fg-muted">
        Testing {run.cells.filter((c) => isFinal(c.status)).length}/{run.cells.length}…
      </span>
      <button
        onClick={() => void window.api.cancelCompatRun()}
        className="inline-flex items-center gap-2 rounded-brand border border-border px-4 py-2 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
      >
        <Square size={14} /> Cancel run
      </button>
    </>
  ) : run ? (
    <>
      <span className="flex-1 text-sm text-fg-muted">{summarize(run)}</span>
      <button
        onClick={() => void copyReport()}
        className="inline-flex items-center gap-2 rounded-brand border border-border px-4 py-2 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
      >
        <Copy size={14} /> {copied ? 'Copied!' : 'Copy report'}
      </button>
      <button
        onClick={closeMatrix}
        className="rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110"
      >
        Done
      </button>
    </>
  ) : done ? (
    <>
      <div className="flex-1" />
      <button
        onClick={closeMatrix}
        className="rounded-brand px-3 py-2 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
      >
        Done
      </button>
      {createdCount > 0 && (
        <button
          disabled={startingRun}
          onClick={() => void startCompat()}
          className="inline-flex items-center gap-2 rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
        >
          {startingRun ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
          Run compatibility test
        </button>
      )}
    </>
  ) : creating ? (
    <span className="text-sm text-fg-muted">Building servers…</span>
  ) : (
    <>
      <div className="flex-1 text-xs text-fg-muted">
        {orderedSelection.length} version{orderedSelection.length === 1 ? '' : 's'} ·{' '}
        {jarPaths.length
          ? `${jarPaths.length} jar${jarPaths.length === 1 ? '' : 's'}`
          : 'no jar selected'}
      </div>
      <button
        onClick={closeMatrix}
        className="rounded-brand px-3 py-2 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
      >
        Cancel
      </button>
      <button
        disabled={!canCreate}
        onClick={() => void create()}
        className="inline-flex items-center gap-2 rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
      >
        <Check size={16} /> Create {orderedSelection.length || ''} server
        {orderedSelection.length === 1 ? '' : 's'}
      </button>
    </>
  )

  return (
    <Modal
      title="Test matrix — same setup across versions"
      onClose={locked ? () => {} : closeMatrix}
      wide
      footer={footer}
    >
      {run ? (
        <CompatGrid run={run} />
      ) : creating || done ? (
        <div className="space-y-4">
          <ResultsView cells={cells} order={orderedSelection} />
          {done && createdCount > 0 && (
            <p className="flex items-start gap-2 rounded-brand bg-surface-2 px-3 py-2 text-xs text-fg-muted">
              <FlaskConical size={14} className="mt-0.5 shrink-0" />
              Run the compatibility test to boot each server in turn, check that your
              plugins/mods load cleanly, and get a pass/fail report per version. Servers are
              stopped again afterwards.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <p className="flex items-start gap-2 rounded-brand bg-surface-2 px-3 py-2 text-xs text-fg-muted">
            <Grid3x3 size={14} className="mt-0.5 shrink-0" />
            Spin up one server per Minecraft version — same software, RAM, and plugins/mods — to test
            compatibility across versions. Each becomes a normal instance you can start and inspect.
          </p>

          {/* Software */}
          <Labeled label="Software">
            <select
              value={serverType}
              onChange={(e) => setServerType(e.target.value as ServerType)}
              className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
            >
              {MATRIX_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Labeled>

          {/* Versions */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Minecraft versions
              </span>
              {versions && versions.length > 0 && (
                <div className="flex items-center gap-1 text-xs">
                  <button
                    onClick={() => selectLatest(3)}
                    className="rounded border border-border px-2 py-0.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                  >
                    Latest 3
                  </button>
                  <button
                    onClick={() => selectLatest(5)}
                    className="rounded border border-border px-2 py-0.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                  >
                    Latest 5
                  </button>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="rounded border border-border px-2 py-0.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <div className="max-h-44 overflow-y-auto rounded-brand border border-border p-1">
              {versions === null ? (
                <div className="grid place-items-center py-6 text-fg-muted">
                  <Loader2 className="animate-spin" size={18} />
                </div>
              ) : versions.length === 0 ? (
                <div className="py-6 text-center text-sm text-fg-muted">No versions found.</div>
              ) : (
                <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
                  {versions.map((v) => {
                    const on = selected.has(v)
                    return (
                      <button
                        key={v}
                        onClick={() => toggle(v)}
                        className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition ${
                          on
                            ? 'bg-accent/15 text-accent ring-1 ring-accent/40'
                            : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                        }`}
                      >
                        <span
                          className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border ${
                            on ? 'border-accent bg-accent text-accent-fg' : 'border-border'
                          }`}
                        >
                          {on && <Check size={10} />}
                        </span>
                        <span className="truncate">{v}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Plugin/mod jars */}
          <Labeled label="Plugins / mods to test (optional)">
            <div className="flex items-center gap-2">
              <button
                onClick={() => void pickJars()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              >
                <Upload size={14} /> Choose .jar files
              </button>
              <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                {jarPaths.length
                  ? jarPaths.map((p) => p.split(/[\\/]/).pop()).join(', ')
                  : 'Same jars installed into every server.'}
              </span>
              {jarPaths.length > 0 && (
                <button
                  onClick={() => setJarPaths([])}
                  className="rounded p-1 text-fg-muted transition hover:text-red-400"
                  title="Clear"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </Labeled>

          {/* Smoke commands for the compat run */}
          <Labeled label="Smoke test commands (optional, one per line)">
            <textarea
              value={smokeText}
              onChange={(e) => setSmokeText(e.target.value)}
              rows={2}
              placeholder={'e.g. myplugin reload\nversion MyPlugin'}
              className="w-full resize-y rounded-md bg-input px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
            />
            <span className="mt-1 block text-[11px] text-fg-muted">
              Sent to each server once it's ready during the compatibility test. An “Unknown
              command” reply fails the version.
            </span>
          </Labeled>

          <div className="grid grid-cols-2 gap-4">
            <Labeled label={`Memory each — ${ramLabel(ramMB)}`}>
              <input
                type="range"
                min={512}
                max={16384}
                step={512}
                value={ramMB}
                onChange={(e) => setRamMB(Number(e.target.value))}
                className="mt-2 w-full accent-[var(--c-accent)]"
              />
            </Labeled>
            <Labeled label="Starting port">
              <input
                type="number"
                min={1}
                max={65535}
                value={basePort}
                onChange={(e) => setBasePort(Number(e.target.value))}
                className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="mt-1 block text-[11px] text-fg-muted">
                Each server gets the next port up.
              </span>
            </Labeled>
          </div>

          <Labeled label="Java runtime">
            <select
              value={javaPath}
              onChange={(e) => setJavaPath(e.target.value)}
              className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Auto — correct version per Minecraft version (recommended)</option>
              {javaOptions.map((j) => (
                <option key={j.path} value={j.path}>
                  {j.major ? `Java ${j.major} (${j.version})` : j.path}
                  {j.managed ? ' • managed' : ''}
                </option>
              ))}
            </select>
          </Labeled>

          <div className="grid grid-cols-2 items-end gap-4">
            <Labeled label="Group name">
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
              />
            </Labeled>
            <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={eula}
                onChange={(e) => setEula(e.target.checked)}
                className="h-4 w-4 accent-[var(--c-accent)]"
              />
              Accept the Minecraft EULA
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-brand border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertCircle size={14} /> {error}
            </div>
          )}
        </div>
      )}
      {run && error && (
        <div className="mt-3 flex items-center gap-2 rounded-brand border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} /> {error}
        </div>
      )}
    </Modal>
  )
}

// ---- Compatibility run UI ----

function isFinal(status: CompatCell['status']): boolean {
  return status === 'pass' || status === 'warn' || status === 'fail' || status === 'skipped'
}

function summarize(run: CompatRun): string {
  const n = (s: CompatCell['status']): number => run.cells.filter((c) => c.status === s).length
  const parts = [
    n('pass') ? `${n('pass')} passed` : null,
    n('warn') ? `${n('warn')} with warnings` : null,
    n('fail') ? `${n('fail')} failed` : null,
    n('skipped') ? `${n('skipped')} skipped` : null
  ].filter(Boolean)
  return `${run.state === 'cancelled' ? 'Cancelled — ' : ''}${parts.join(' · ') || 'No results'}`
}

function CompatGrid({ run }: { run: CompatRun }): ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-1.5">
      {run.cells.map((cell) => {
        const open = expanded.has(cell.instanceId)
        const hasDetails = cell.issues.length > 0 || cell.smoke.length > 0
        return (
          <div key={cell.instanceId} className="rounded-md border border-border">
            <button
              onClick={() => hasDetails && toggle(cell.instanceId)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${
                hasDetails ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default'
              }`}
            >
              <CompatStatusIcon status={cell.status} />
              <span className="font-medium">{cell.mcVersion}</span>
              {cell.readyMs !== undefined && (
                <span className="text-xs text-fg-muted">{(cell.readyMs / 1000).toFixed(1)}s</span>
              )}
              <span className="ml-auto truncate text-xs text-fg-muted">
                {statusLabel(cell)}
              </span>
              {hasDetails &&
                (open ? (
                  <ChevronDown size={14} className="shrink-0 text-fg-muted" />
                ) : (
                  <ChevronRight size={14} className="shrink-0 text-fg-muted" />
                ))}
            </button>
            {open && hasDetails && (
              <div className="space-y-2 border-t border-border px-3 py-2">
                {cell.issues.length > 0 && (
                  <div className="space-y-1">
                    {cell.issues.map((issue, i) => (
                      <div
                        key={i}
                        className={`break-all font-mono text-[11px] ${
                          issue.severity === 'error' ? 'text-red-300' : 'text-amber-300'
                        }`}
                      >
                        {issue.line}
                      </div>
                    ))}
                  </div>
                )}
                {cell.smoke.map((s, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      {s.ok ? (
                        <CheckCircle2 size={12} className="shrink-0 text-emerald-400" />
                      ) : (
                        <XCircle size={12} className="shrink-0 text-red-400" />
                      )}
                      <code className="text-fg">/{s.command}</code>
                    </div>
                    {s.output && (
                      <pre className="max-h-36 overflow-auto rounded bg-surface-2 px-2 py-1.5 text-[11px] text-fg-muted">
                        {s.output}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function statusLabel(cell: CompatCell): string {
  switch (cell.status) {
    case 'queued':
      return 'Queued'
    case 'starting':
      return 'Starting…'
    case 'testing':
      return 'Running smoke commands…'
    case 'stopping':
      return 'Stopping…'
    default:
      return cell.message ?? cell.status
  }
}

function CompatStatusIcon({ status }: { status: CompatCell['status'] }): ReactElement {
  if (status === 'pass') return <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
  if (status === 'warn') return <AlertTriangle size={16} className="shrink-0 text-amber-400" />
  if (status === 'fail') return <XCircle size={16} className="shrink-0 text-red-400" />
  if (status === 'skipped') return <CircleDashed size={16} className="shrink-0 text-fg-muted" />
  if (status === 'queued') return <CircleDashed size={16} className="shrink-0 text-fg-muted" />
  return <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
}

/** Render a finished run as a shareable Markdown report. */
function buildReport(run: CompatRun, group: string, software: string, jarPaths: string[]): string {
  const jars = jarPaths.map((p) => p.split(/[\\/]/).pop()).join(', ')
  const icon = (c: CompatCell): string =>
    c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : c.status === 'fail' ? '❌' : '⏭️'
  const lines: string[] = [
    `# Compatibility report — ${group || software}`,
    '',
    `${software}${jars ? ` · ${jars}` : ''} · ${new Date(run.startedAt).toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    '| Version | Result | Ready | Notes |',
    '| --- | --- | --- | --- |',
    ...run.cells.map(
      (c) =>
        `| ${c.mcVersion} | ${icon(c)} ${c.status} | ${
          c.readyMs !== undefined ? (c.readyMs / 1000).toFixed(1) + 's' : '—'
        } | ${(c.message ?? '').replace(/\|/g, '\\|')} |`
    )
  ]
  const detailed = run.cells.filter((c) => c.issues.length || c.smoke.some((s) => !s.ok))
  if (detailed.length) {
    lines.push('', '## Details')
    for (const c of detailed) {
      lines.push('', `### ${c.mcVersion} — ${c.status.toUpperCase()}`)
      for (const issue of c.issues) lines.push(`- \`${issue.severity}\` ${issue.line}`)
      for (const s of c.smoke.filter((s) => !s.ok)) {
        lines.push('', `**\`/${s.command}\` failed:**`, '', '```', s.output, '```')
      }
    }
  }
  return lines.join('\n')
}

function ResultsView({
  cells,
  order
}: {
  cells: Record<string, Cell>
  order: string[]
}): ReactElement {
  return (
    <div className="space-y-1.5">
      {order.map((v) => {
        const cell = cells[v] ?? { status: 'pending' }
        return (
          <div
            key={v}
            className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
          >
            <StatusIcon status={cell.status} />
            <span className="font-medium">{v}</span>
            <span className="ml-auto truncate text-xs text-fg-muted">
              {cell.status === 'error'
                ? cell.message
                : cell.status === 'done'
                  ? 'Ready'
                  : cell.status === 'working'
                    ? 'Installing…'
                    : 'Queued'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function StatusIcon({ status }: { status: CellStatus }): ReactElement {
  if (status === 'done') return <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
  if (status === 'error') return <XCircle size={16} className="shrink-0 text-red-400" />
  if (status === 'working') return <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
  return <CircleDashed size={16} className="shrink-0 text-fg-muted" />
}

function Labeled({ label, children }: { label: string; children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  )
}
