import type { ReactElement } from 'react'
import type { ServerType } from '@shared/types'
import { SERVER_TYPES } from '@shared/software'

export function StepSoftware({
  value,
  onSelect
}: {
  value?: ServerType
  onSelect: (t: ServerType) => void
}): ReactElement {
  return (
    <div>
      <p className="mb-4 text-sm text-fg-muted">Choose the server software to run.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SERVER_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`flex flex-col gap-1 rounded-brand border p-4 text-left transition ${
              value === t.id
                ? 'border-accent bg-accent/10'
                : 'border-border hover:border-accent/50 hover:bg-surface-2'
            }`}
          >
            <span className="text-sm font-semibold">{t.label}</span>
            <span className="text-xs leading-snug text-fg-muted">{t.blurb}</span>
            <span className="mt-1 text-[10px] uppercase tracking-wide text-accent/80">
              {t.contentKind === 'none' ? 'no add-ons' : t.contentKind}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
