import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Save, Loader2, AlertTriangle, SlidersHorizontal } from 'lucide-react'
import type { ServerStatus } from '@shared/types'

type FieldType = 'bool' | 'number' | 'text' | 'enum'

interface PropField {
  key: string
  label: string
  type: FieldType
  /** For enum fields. */
  options?: string[]
  hint?: string
}

interface PropGroup {
  title: string
  fields: PropField[]
}

/** Curated, friendly view over the most-used server.properties keys. */
const GROUPS: PropGroup[] = [
  {
    title: 'Gameplay',
    fields: [
      { key: 'motd', label: 'MOTD', type: 'text', hint: 'Server list description' },
      {
        key: 'gamemode',
        label: 'Default game mode',
        type: 'enum',
        options: ['survival', 'creative', 'adventure', 'spectator']
      },
      {
        key: 'difficulty',
        label: 'Difficulty',
        type: 'enum',
        options: ['peaceful', 'easy', 'normal', 'hard']
      },
      { key: 'hardcore', label: 'Hardcore', type: 'bool' },
      { key: 'pvp', label: 'PvP', type: 'bool' },
      { key: 'force-gamemode', label: 'Force game mode', type: 'bool' },
      { key: 'enable-command-block', label: 'Command blocks', type: 'bool' }
    ]
  },
  {
    title: 'Players',
    fields: [
      { key: 'max-players', label: 'Max players', type: 'number' },
      { key: 'online-mode', label: 'Online mode (Mojang auth)', type: 'bool' },
      { key: 'white-list', label: 'Whitelist', type: 'bool' },
      { key: 'enforce-whitelist', label: 'Enforce whitelist', type: 'bool' },
      { key: 'allow-flight', label: 'Allow flight', type: 'bool' },
      { key: 'spawn-protection', label: 'Spawn protection (blocks)', type: 'number' }
    ]
  },
  {
    title: 'World',
    fields: [
      { key: 'level-name', label: 'World folder', type: 'text' },
      { key: 'level-seed', label: 'Seed', type: 'text', hint: 'Blank = random' },
      { key: 'level-type', label: 'World type', type: 'text', hint: 'e.g. minecraft:normal' },
      { key: 'allow-nether', label: 'Allow Nether', type: 'bool' },
      { key: 'spawn-monsters', label: 'Spawn monsters', type: 'bool' },
      { key: 'spawn-animals', label: 'Spawn animals', type: 'bool' },
      { key: 'spawn-npcs', label: 'Spawn villagers', type: 'bool' },
      { key: 'generate-structures', label: 'Generate structures', type: 'bool' },
      { key: 'max-world-size', label: 'Max world size (blocks)', type: 'number' }
    ]
  },
  {
    title: 'Performance',
    fields: [
      { key: 'view-distance', label: 'View distance (chunks)', type: 'number' },
      { key: 'simulation-distance', label: 'Simulation distance (chunks)', type: 'number' }
    ]
  }
]

/** Keys covered by curated fields above (so we don't show them twice in "Other"). */
const KNOWN_KEYS = new Set(GROUPS.flatMap((g) => g.fields.map((f) => f.key)))
// server-port is managed from the Settings tab (kept in sync with the instance config).
const HIDDEN_KEYS = new Set(['server-port'])

export function PropertiesView({
  instanceId,
  status
}: {
  instanceId: string
  status: ServerStatus
}): ReactElement {
  const [original, setOriginal] = useState<Record<string, string> | null>(null)
  const [props, setProps] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setOriginal(null)
    void window.api.getServerProperties(instanceId).then((p) => {
      setOriginal(p)
      setProps(p)
    })
  }, [instanceId])

  const otherKeys = useMemo(
    () =>
      Object.keys(props)
        .filter((k) => !KNOWN_KEYS.has(k) && !HIDDEN_KEYS.has(k))
        .sort(),
    [props]
  )

  const dirty = useMemo(() => {
    if (!original) return false
    const keys = new Set([...Object.keys(original), ...Object.keys(props)])
    for (const k of keys) if ((original[k] ?? '') !== (props[k] ?? '')) return true
    return false
  }, [original, props])

  function set(key: string, value: string): void {
    setProps((p) => ({ ...p, [key]: value }))
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      const updated = await window.api.setServerProperties(instanceId, props)
      setOriginal(updated)
      setProps(updated)
    } finally {
      setSaving(false)
    }
  }

  if (!original) {
    return (
      <div className="grid h-full place-items-center text-fg-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  return (
    <div className="mx-auto h-full max-w-3xl space-y-6 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal size={15} /> server.properties
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Friendly editor for the server config. The port is set on the Settings tab.
          </p>
        </div>
        {status !== 'stopped' && (
          <span className="flex items-center gap-1 text-xs text-amber-400">
            <AlertTriangle size={12} /> Restart to apply
          </span>
        )}
      </div>

      {GROUPS.map((group) => (
        <section key={group.title} className="rounded-brand border border-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold">{group.title}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {group.fields.map((f) => (
              <Field key={f.key} field={f} value={props[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        </section>
      ))}

      {otherKeys.length > 0 && (
        <section className="rounded-brand border border-border bg-surface p-4">
          <h3 className="mb-1 text-sm font-semibold">Other properties</h3>
          <p className="mb-3 text-xs text-fg-muted">
            Everything else found in this file. Edit raw values directly.
          </p>
          <div className="space-y-2">
            {otherKeys.map((k) => (
              <div key={k} className="grid grid-cols-[1fr_1.2fr] items-center gap-3">
                <code className="truncate font-mono text-xs text-fg-muted" title={k}>
                  {k}
                </code>
                <input
                  value={props[k] ?? ''}
                  onChange={(e) => set(k, e.target.value)}
                  className="w-full rounded-md bg-input px-3 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex justify-end pb-2">
        <button
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
        >
          {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
          Save changes
        </button>
      </div>
    </div>
  )
}

function Field({
  field,
  value,
  onChange
}: {
  field: PropField
  value: string | undefined
  onChange: (value: string) => void
}): ReactElement {
  if (field.type === 'bool') {
    return (
      <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
        <span className="min-w-0 truncate">{field.label}</span>
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          className="h-4 w-4 shrink-0 accent-[var(--c-accent)]"
        />
      </label>
    )
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {field.label}
      </span>
      {field.type === 'enum' ? (
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
        >
          {value === undefined && <option value="">— default —</option>}
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : 'text'}
          value={value ?? ''}
          placeholder={field.hint}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
        />
      )}
    </label>
  )
}
