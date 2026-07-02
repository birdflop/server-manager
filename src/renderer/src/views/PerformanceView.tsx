import { useEffect, useState, type ReactElement } from 'react'
import {
  Cpu,
  MemoryStick,
  Activity,
  Gauge,
  Timer,
  Flame,
  Loader2,
  ExternalLink,
  Download,
  Bot,
  Play,
  Square
} from 'lucide-react'
import type { BotsStatusEvent, Instance } from '@shared/types'
import { isProxy, contentKindOf } from '@shared/software'
import { useApp } from '../store'
import { Sparkline } from '../components/Sparkline'

function ramLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

// Stable reference for the "no samples yet" case so the Zustand selector below
// doesn't return a fresh array every render (which would loop useSyncExternalStore).
const NO_HISTORY: { cpu: number; memMB: number }[] = []
const NO_PERF_HISTORY: { tps: number; mspt?: number }[] = []

/** Server types whose `tps`/`mspt` commands are built in (no spark needed). */
const BUILTIN_TPS = new Set(['paper', 'purpur', 'folia'])

const SPARK_URL_RE = /https:\/\/spark\.lucko\.me\/\S+/

function tpsColor(tps: number): string {
  return tps >= 18 ? 'text-emerald-400' : tps >= 15 ? 'text-amber-400' : 'text-red-400'
}

export function PerformanceView({ instance }: { instance: Instance }): ReactElement {
  const status = useApp((s) => s.status[instance.id] ?? 'stopped')
  const history = useApp((s) => s.statsHistory[instance.id] ?? NO_HISTORY)
  const live = useApp((s) => s.stats[instance.id])
  const perf = useApp((s) => s.perf[instance.id])
  const perfHistory = useApp((s) => s.perfHistory[instance.id] ?? NO_PERF_HISTORY)

  const [profileUrl, setProfileUrl] = useState<string | null>(null)
  const [profiling, setProfiling] = useState(false)

  // Fake-player load test session.
  const [bots, setBots] = useState<BotsStatusEvent | null>(null)
  const [botCount, setBotCount] = useState(10)
  const [botMove, setBotMove] = useState(true)
  const [botChat, setBotChat] = useState(false)
  const [botsBusy, setBotsBusy] = useState(false)
  const [botsError, setBotsError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.getBots(instance.id).then(setBots)
    return window.api.onBotsStatus((e) => {
      if (e.id === instance.id) setBots(e)
    })
  }, [instance.id])

  async function startLoadTest(): Promise<void> {
    setBotsBusy(true)
    setBotsError(null)
    try {
      await window.api.startBots(instance.id, { count: botCount, move: botMove, chat: botChat })
    } catch (e) {
      setBotsError(e instanceof Error ? e.message : String(e))
    } finally {
      setBotsBusy(false)
    }
  }

  async function allowBots(): Promise<void> {
    setBotsError(null)
    await window.api.setServerProperties(instance.id, { 'online-mode': 'false' })
    setBotsError('online-mode is now false — restart the server, then start the bots.')
  }

  // Capture spark viewer links from the console (printed when a profile finishes).
  useEffect(() => {
    return window.api.onServerOutput((e) => {
      if (e.id !== instance.id) return
      const m = e.chunk.match(SPARK_URL_RE)
      if (m) {
        // eslint-disable-next-line no-control-regex
        setProfileUrl(m[0].replace(/\x1b\[[0-9;]*m/g, ''))
        setProfiling(false)
      }
    })
  }, [instance.id])

  const cpuData = history.map((h) => h.cpu)
  const memData = history.map((h) => h.memMB)
  const cpuPeak = cpuData.length ? Math.max(...cpuData) : 0
  const memPeak = memData.length ? Math.max(...memData) : 0
  const cpuNow = live?.cpu ?? 0
  const memNow = live?.memMB ?? 0
  const memPct = Math.min(100, Math.round((memNow / instance.ramMB) * 100))

  const tpsData = perfHistory.map((h) => h.tps)
  const msptData = perfHistory.map((h) => h.mspt ?? 0)
  const tpsNow = perf?.tps
  const msptNow = perf?.mspt
  const tpsMin = tpsData.length ? Math.min(...tpsData) : 0
  const msptPeak = msptData.length ? Math.max(...msptData) : 0

  const server = !isProxy(instance.serverType)
  const builtin = BUILTIN_TPS.has(instance.serverType)
  const canInstallSpark = contentKindOf(instance.serverType) !== 'none' && !builtin
  const sparkKnown = builtin || perf?.source === 'spark'
  const showTps = server && (perfHistory.length > 0 || tpsNow !== undefined)
  const showSparkPrompt =
    server && status === 'running' && perf?.source === 'none' && canInstallSpark

  const [installingSpark, setInstallingSpark] = useState(false)
  const [sparkInstalled, setSparkInstalled] = useState(false)
  const [sparkError, setSparkError] = useState<string | null>(null)

  async function installSpark(): Promise<void> {
    setInstallingSpark(true)
    setSparkError(null)
    try {
      await window.api.installContent(instance.id, 'modrinth', 'spark')
      setSparkInstalled(true)
    } catch (e) {
      setSparkError(e instanceof Error ? e.message : String(e))
    } finally {
      setInstallingSpark(false)
    }
  }

  async function startProfile(): Promise<void> {
    setProfileUrl(null)
    setProfiling(true)
    await window.api.sendCommand(instance.id, 'spark profiler start --timeout 30')
  }

  if (status === 'stopped' && history.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fg-muted">
        <Activity size={28} className="opacity-50" />
        <p className="text-sm">Start the server to see live CPU &amp; memory usage.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
      {/* TPS / MSPT */}
      {showTps && (
        <div className="grid grid-cols-2 gap-4">
          <section className="rounded-brand border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Gauge size={15} /> TPS
              </h2>
              <div className="flex items-center gap-4 text-xs text-fg-muted">
                <span>
                  Now{' '}
                  <span className={`font-mono ${tpsNow !== undefined ? tpsColor(tpsNow) : 'text-fg'}`}>
                    {tpsNow !== undefined ? tpsNow.toFixed(1) : '—'}
                  </span>
                </span>
                <span>
                  Min <span className="font-mono text-fg">{tpsMin ? tpsMin.toFixed(1) : '—'}</span>
                </span>
              </div>
            </div>
            <Sparkline data={tpsData} max={20} color="var(--c-accent)" height={64} />
          </section>

          <section className="rounded-brand border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Timer size={15} /> Tick time
              </h2>
              <div className="flex items-center gap-4 text-xs text-fg-muted">
                <span>
                  Now{' '}
                  <span className="font-mono text-fg">
                    {msptNow !== undefined ? `${msptNow.toFixed(1)} ms` : '—'}
                  </span>
                </span>
                <span>
                  Peak <span className="font-mono text-fg">{msptPeak ? `${msptPeak.toFixed(1)} ms` : '—'}</span>
                </span>
              </div>
            </div>
            <Sparkline data={msptData} max={50} color="var(--c-accent-2)" height={64} />
          </section>
        </div>
      )}

      {/* Spark install prompt (tick metrics need the spark mod on non-Paper servers) */}
      {showSparkPrompt && (
        <section className="rounded-brand border border-border bg-surface p-4">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Gauge size={15} /> TPS &amp; tick time
          </h2>
          {sparkInstalled ? (
            <p className="text-xs text-emerald-400">
              spark installed — restart the server to start collecting TPS metrics.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-fg-muted">
                Tick metrics for {instance.serverType} servers come from the{' '}
                <span className="font-medium text-fg">spark</span> profiler mod. Install it and
                restart to see TPS here.
              </p>
              <button
                onClick={() => void installSpark()}
                disabled={installingSpark}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
              >
                {installingSpark ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Download size={13} />
                )}
                Install spark
              </button>
            </div>
          )}
          {sparkError && <p className="mt-1 text-xs text-red-400">{sparkError}</p>}
        </section>
      )}

      <section className="rounded-brand border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Cpu size={15} /> CPU
          </h2>
          <div className="flex items-center gap-4 text-xs text-fg-muted">
            <span>
              Now <span className="font-mono text-fg">{cpuNow}%</span>
            </span>
            <span>
              Peak <span className="font-mono text-fg">{cpuPeak}%</span>
            </span>
          </div>
        </div>
        <Sparkline data={cpuData} color="var(--c-accent)" height={64} />
      </section>

      <section className="rounded-brand border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <MemoryStick size={15} /> Memory
          </h2>
          <div className="flex items-center gap-4 text-xs text-fg-muted">
            <span>
              Now <span className="font-mono text-fg">{ramLabel(memNow)}</span> ({memPct}%)
            </span>
            <span>
              Peak <span className="font-mono text-fg">{ramLabel(memPeak)}</span>
            </span>
            <span>
              Limit <span className="font-mono text-fg">{ramLabel(instance.ramMB)}</span>
            </span>
          </div>
        </div>
        <Sparkline data={memData} max={instance.ramMB} color="var(--c-accent-2)" height={64} />
      </section>

      {/* Spark profiler */}
      {server && sparkKnown && status === 'running' && (
        <section className="rounded-brand border border-border bg-surface p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Flame size={15} /> Profiler
            </h2>
            <button
              onClick={() => void startProfile()}
              disabled={profiling}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            >
              {profiling ? <Loader2 size={13} className="animate-spin" /> : <Flame size={13} />}
              {profiling ? 'Profiling (30s)…' : 'Profile for 30s'}
            </button>
          </div>
          <p className="text-xs text-fg-muted">
            Runs the spark profiler for 30 seconds and links the interactive flamegraph — the
            fastest way to answer “which plugin/mod is eating my tick?”.
            {builtin && ' Requires spark (bundled with recent Paper builds).'}
          </p>
          {profileUrl && (
            <button
              onClick={() => void window.api.openExternal(profileUrl)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent/15 px-3 py-1.5 text-xs text-accent ring-1 ring-accent/40 transition hover:bg-accent/25"
            >
              <ExternalLink size={13} /> Open profile — {profileUrl}
            </button>
          )}
        </section>
      )}

      {/* Fake-player load test */}
      {server && (
        <section className="rounded-brand border border-border bg-surface p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Bot size={15} /> Load test
              {bots?.running && (
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  {bots.connected}/{bots.target} connected
                </span>
              )}
            </h2>
            {bots?.running ? (
              <button
                onClick={() => void window.api.stopBots(instance.id)}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110"
              >
                <Square size={12} /> Disconnect bots
              </button>
            ) : (
              <button
                onClick={() => void startLoadTest()}
                disabled={botsBusy || status !== 'running'}
                title={status !== 'running' ? 'Start the server first' : 'Connect test bots'}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
              >
                {botsBusy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Connect {botCount} bots
              </button>
            )}
          </div>
          <p className="mb-3 text-xs text-fg-muted">
            Connect fake players that walk around and chat, to see how your plugins/mods behave
            under load — watch TPS above while they join. Needs{' '}
            <code className="rounded bg-input px-1 font-mono">online-mode=false</code>.
          </p>

          {!bots?.running && (
            <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
              <label className="flex items-center gap-2">
                Bots
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={botCount}
                  onChange={(e) => setBotCount(Number(e.target.value))}
                  className="w-36 accent-[var(--c-accent)]"
                />
                <span className="w-6 font-mono text-fg">{botCount}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={botMove}
                  onChange={(e) => setBotMove(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--c-accent)]"
                />
                Wander
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={botChat}
                  onChange={(e) => setBotChat(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--c-accent)]"
                />
                Chat
              </label>
            </div>
          )}

          {bots?.message && <p className="mt-2 text-xs text-amber-300">{bots.message}</p>}
          {botsError && (
            <div className="mt-2 space-y-1.5 text-xs text-amber-300">
              <p>{botsError}</p>
              {botsError.includes('online-mode') && !botsError.includes('now false') && (
                <button
                  onClick={() => void allowBots()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 px-2.5 py-1 font-medium transition hover:bg-amber-500/10"
                >
                  Set online-mode=false
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <p className="text-center text-xs text-fg-muted">
        CPU/RAM sampled every 2 seconds{showTps ? ' · TPS every 5 seconds via RCON' : ''} · last{' '}
        {history.length} sample{history.length === 1 ? '' : 's'}
      </p>
    </div>
  )
}
