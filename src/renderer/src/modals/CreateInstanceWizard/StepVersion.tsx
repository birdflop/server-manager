import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Loader2, AlertCircle, Check } from 'lucide-react'
import type { Build, ServerType } from '@shared/types'
import { isProxy } from '@shared/software'

export function StepVersion({
  serverType,
  mcVersion,
  build,
  onPickVersion,
  onPickBuild
}: {
  serverType: ServerType
  mcVersion?: string
  build?: string
  onPickVersion: (v: string) => void
  onPickBuild: (b: string) => void
}): ReactElement {
  const [versions, setVersions] = useState<string[] | null>(null)
  const [builds, setBuilds] = useState<Build[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let active = true
    setVersions(null)
    setError(null)
    window.api
      .getGameVersions(serverType)
      .then((v) => active && setVersions(v))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      active = false
    }
  }, [serverType])

  useEffect(() => {
    if (!mcVersion) {
      setBuilds(null)
      return
    }
    let active = true
    setBuilds(null)
    window.api
      .getBuilds(serverType, mcVersion)
      .then((b) => {
        if (!active) return
        setBuilds(b)
        if (b.length > 0) onPickBuild(b[0].id)
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverType, mcVersion])

  const filtered = useMemo(
    () => (versions ?? []).filter((v) => v.toLowerCase().includes(filter.toLowerCase())),
    [versions, filter]
  )

  const versionLabel = isProxy(serverType) ? 'Version' : 'Minecraft version'

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-brand border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
        <AlertCircle size={16} /> Failed to load versions: {error}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Versions */}
      <div className="flex min-h-0 flex-col">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {versionLabel}
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="mb-2 w-full rounded-md bg-input px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="h-64 overflow-y-auto rounded-md border border-border">
          {versions === null ? (
            <div className="flex h-full items-center justify-center text-fg-muted">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : (
            filtered.map((v) => (
              <button
                key={v}
                onClick={() => onPickVersion(v)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition ${
                  mcVersion === v ? 'bg-accent/15 text-accent' : 'hover:bg-surface-2'
                }`}
              >
                {v}
                {mcVersion === v && <Check size={14} />}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Builds */}
      <div className="flex min-h-0 flex-col">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Build</div>
        <div className="mt-[2.375rem] h-64 overflow-y-auto rounded-md border border-border">
          {!mcVersion ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-sm text-fg-muted">
              Pick a version first
            </div>
          ) : builds === null ? (
            <div className="flex h-full items-center justify-center text-fg-muted">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : (
            builds.map((b) => (
              <button
                key={b.id}
                onClick={() => onPickBuild(b.id)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition ${
                  build === b.id ? 'bg-accent/15 text-accent' : 'hover:bg-surface-2'
                }`}
              >
                <span>{b.label}</span>
                {b.channel && b.channel !== 'stable' && (
                  <span className="text-[10px] uppercase text-amber-400">{b.channel}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
