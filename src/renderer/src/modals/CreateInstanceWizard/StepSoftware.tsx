import type { ReactElement } from 'react'
import type { ServerType } from '@shared/types'
import { SERVER_TYPES, type ServerTypeInfo } from '@shared/software'

// Each software lands in exactly one section (predicates don't overlap).
const SECTIONS: { title: string; hint: string; match: (t: ServerTypeInfo) => boolean }[] = [
  {
    title: 'Plugin servers',
    hint: 'Run Bukkit/Spigot plugins',
    match: (t) => t.category === 'server' && t.contentKind === 'plugins'
  },
  {
    title: 'Mod servers',
    hint: 'Run Fabric/Forge mods',
    match: (t) => t.category === 'server' && t.contentKind === 'mods'
  },
  {
    title: 'Vanilla',
    hint: 'Unmodified Minecraft',
    match: (t) => t.category === 'server' && t.contentKind === 'none'
  },
  {
    title: 'Proxies',
    hint: 'Route players between servers',
    match: (t) => t.category === 'proxy'
  }
]

function TypeCard({
  type,
  selected,
  onSelect
}: {
  type: ServerTypeInfo
  selected: boolean
  onSelect: (t: ServerType) => void
}): ReactElement {
  return (
    <button
      onClick={() => onSelect(type.id)}
      className={`flex flex-col gap-1 rounded-brand border p-4 text-left transition ${
        selected
          ? 'border-accent bg-accent/10'
          : 'border-border hover:border-accent/50 hover:bg-surface-2'
      }`}
    >
      <span className="text-sm font-semibold">{type.label}</span>
      <span className="text-xs leading-snug text-fg-muted">{type.blurb}</span>
      <span className="mt-1 text-[10px] uppercase tracking-wide text-accent/80">
        {type.contentKind === 'none' ? 'no add-ons' : type.contentKind}
      </span>
    </button>
  )
}

export function StepSoftware({
  value,
  onSelect
}: {
  value?: ServerType
  onSelect: (t: ServerType) => void
}): ReactElement {
  return (
    <div className="space-y-5">
      <p className="text-sm text-fg-muted">Choose the server software to run.</p>
      {SECTIONS.map(({ title, hint, match }) => {
        const types = SERVER_TYPES.filter(match)
        if (types.length === 0) return null
        return (
          <div key={title}>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {title}
              </span>
              <span className="text-[11px] text-fg-muted/70">{hint}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {types.map((t) => (
                <TypeCard key={t.id} type={t} selected={value === t.id} onSelect={onSelect} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
