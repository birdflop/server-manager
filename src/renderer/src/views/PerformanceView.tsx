import type { ReactElement } from 'react'
import { Cpu, MemoryStick, Activity } from 'lucide-react'
import type { Instance } from '@shared/types'
import { useApp } from '../store'
import { Sparkline } from '../components/Sparkline'

function ramLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`
}

export function PerformanceView({ instance }: { instance: Instance }): ReactElement {
  const status = useApp((s) => s.status[instance.id] ?? 'stopped')
  const history = useApp((s) => s.statsHistory[instance.id] ?? [])
  const live = useApp((s) => s.stats[instance.id])

  const cpuData = history.map((h) => h.cpu)
  const memData = history.map((h) => h.memMB)
  const cpuPeak = cpuData.length ? Math.max(...cpuData) : 0
  const memPeak = memData.length ? Math.max(...memData) : 0
  const cpuNow = live?.cpu ?? 0
  const memNow = live?.memMB ?? 0
  const memPct = Math.min(100, Math.round((memNow / instance.ramMB) * 100))

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

      <p className="text-center text-xs text-fg-muted">
        Sampled every 2 seconds · last {history.length} sample{history.length === 1 ? '' : 's'}
      </p>
    </div>
  )
}
