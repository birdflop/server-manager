import {
  useEffect,
  useState,
  type DragEvent,
  type Dispatch,
  type ReactElement,
  type SetStateAction
} from 'react'
import {
  Upload,
  Trash2,
  Search,
  Download,
  Loader2,
  FileBox,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  ArrowUpCircle,
  Check
} from 'lucide-react'
import type { ContentFile, ContentSearchHit, ContentSource, ContentUpdate } from '@shared/types'

const SOURCE_LABEL: Record<ContentSource, string> = {
  modrinth: 'Modrinth',
  hangar: 'Hangar',
  spigot: 'SpigotMC'
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function ContentView({
  instanceId,
  label,
  sources,
  updates,
  setUpdates
}: {
  instanceId: string
  label: string
  sources: ContentSource[]
  /** Pending updates, owned by ServerView so the tab can show a badge. */
  updates: ContentUpdate[] | null
  setUpdates: Dispatch<SetStateAction<ContentUpdate[] | null>>
}): ReactElement {
  const [tab, setTab] = useState<'installed' | 'browse'>('installed')
  const [files, setFiles] = useState<ContentFile[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [checking, setChecking] = useState(false)
  const [updatingName, setUpdatingName] = useState<string | null>(null)

  const [source, setSource] = useState<ContentSource>(sources[0] ?? 'modrinth')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ContentSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setFiles(await window.api.listContent(instanceId))
  }

  useEffect(() => {
    void refresh()
    setTab('installed')
    setHits(null)
    setQuery('')
    setSource(sources[0] ?? 'modrinth')
    setError(null)
    setNote(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  async function checkUpdates(): Promise<void> {
    setChecking(true)
    setError(null)
    try {
      setUpdates(await window.api.checkContentUpdates(instanceId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setChecking(false)
    }
  }

  async function update(name: string): Promise<void> {
    setUpdatingName(name)
    setError(null)
    try {
      setFiles(await window.api.updateContent(instanceId, name))
      // Drop this file from the pending-updates list.
      setUpdates((u) => (u ? u.filter((x) => x.name !== name) : u))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUpdatingName(null)
    }
  }

  async function onDrop(e: DragEvent): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.api.pathForFile(f))
      .filter((p) => p.endsWith('.jar'))
    if (paths.length) setFiles(await window.api.addContentFiles(instanceId, paths))
  }

  async function pickAndAdd(): Promise<void> {
    const paths = await window.api.pickFiles()
    if (paths.length) setFiles(await window.api.addContentFiles(instanceId, paths))
  }

  async function del(name: string): Promise<void> {
    if (confirm(`Delete "${name}"?`)) setFiles(await window.api.deleteContentFile(instanceId, name))
  }

  async function doSearch(): Promise<void> {
    setSearching(true)
    setError(null)
    try {
      setHits(await window.api.searchContent(instanceId, source, query))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setHits([])
    } finally {
      setSearching(false)
    }
  }

  async function install(hit: ContentSearchHit): Promise<void> {
    const key = `${hit.source}:${hit.id}`
    setInstalling(key)
    setError(null)
    setNote(null)
    const before = new Set(files.map((f) => f.name))
    try {
      const result = await window.api.installContent(instanceId, hit.source, hit.id)
      setFiles(result)
      // Modrinth pulls in required dependencies — let the user know what else landed.
      const added = result.filter((f) => !before.has(f.name)).length
      const deps = added - 1
      setNote(
        deps > 0
          ? `Installed ${hit.title} and ${deps} dependenc${deps === 1 ? 'y' : 'ies'}.`
          : `Installed ${hit.title}.`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setInstalling(null)
    }
  }

  // Re-run search when the source changes (if there's a query).
  useEffect(() => {
    if (tab === 'browse' && query.trim()) void doSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  return (
    <div className="flex h-full flex-col p-4">
      {/* Sub-toggle */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-brand bg-surface-2 p-0.5 text-sm">
          {(['installed', 'browse'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 transition ${
                tab === t ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {t === 'installed' ? `Installed ${label}` : `Browse ${label}`}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {tab === 'installed' && (
          <>
            <button
              onClick={() => void checkUpdates()}
              disabled={checking || files.length === 0}
              className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            >
              {checking ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              Check updates
            </button>
            <button
              onClick={() => void pickAndAdd()}
              className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
            >
              <Upload size={14} /> Add files
            </button>
          </>
        )}
      </div>

      {tab === 'installed' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => void onDrop(e)}
          className={`min-h-0 flex-1 overflow-y-auto rounded-brand border-2 border-dashed p-2 transition ${
            dragOver ? 'border-accent bg-accent/10' : 'border-border'
          }`}
        >
          {files.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fg-muted">
              <Upload size={28} className="opacity-50" />
              <p className="text-sm">Drag &amp; drop .jar files here, or use “Add files”.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {updates !== null && (
                <div className="mb-1 px-3 text-xs text-fg-muted">
                  {updates.length === 0
                    ? 'All tracked plugins/mods are up to date.'
                    : `${updates.length} update${updates.length === 1 ? '' : 's'} available.`}
                </div>
              )}
              {files.map((f) => {
                const upd = updates?.find((u) => u.name === f.name)
                return (
                  <div
                    key={f.name}
                    className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-surface-2"
                  >
                    <FileBox size={16} className="shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {upd && (
                      <button
                        onClick={() => void update(f.name)}
                        disabled={updatingName === f.name}
                        title={
                          upd.latestVersion
                            ? `Update to ${upd.latestVersion}`
                            : 'Update to the latest version'
                        }
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-2/15 px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent-2/25 disabled:opacity-60"
                      >
                        {updatingName === f.name ? (
                          <Loader2 className="animate-spin" size={12} />
                        ) : (
                          <ArrowUpCircle size={12} />
                        )}
                        Update
                      </button>
                    )}
                    <span className="shrink-0 text-xs text-fg-muted">{formatSize(f.size)}</span>
                    <button
                      onClick={() => void del(f.name)}
                      className="rounded p-1 text-fg-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Source selector */}
          {sources.length > 1 && (
            <div className="mb-2 flex gap-1">
              {sources.map((s) => (
                <button
                  key={s}
                  onClick={() => setSource(s)}
                  className={`rounded-md px-3 py-1 text-xs transition ${
                    source === s
                      ? 'bg-accent/15 text-accent ring-1 ring-accent/40'
                      : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  {SOURCE_LABEL[s]}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void doSearch()
            }}
            className="mb-3 flex gap-2"
          >
            <div className="relative flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${SOURCE_LABEL[source]} for ${label.toLowerCase()}…`}
                className="w-full rounded-brand bg-input py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <button
              type="submit"
              className="rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110"
            >
              Search
            </button>
          </form>

          {error && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {note && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
              <Check size={14} /> {note}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {searching ? (
              <div className="flex h-full items-center justify-center text-fg-muted">
                <Loader2 className="animate-spin" size={20} />
              </div>
            ) : hits === null ? (
              <div className="flex h-full items-center justify-center text-sm text-fg-muted">
                Search {SOURCE_LABEL[source]} to find {label.toLowerCase()} for this server.
              </div>
            ) : hits.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-fg-muted">
                No results.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {hits.map((h) => {
                  const key = `${h.source}:${h.id}`
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-3 rounded-brand border border-border p-3"
                    >
                      {h.iconUrl ? (
                        <img
                          src={h.iconUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface-2 text-fg-muted">
                          <FileBox size={18} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {h.title}
                          <span className="text-xs font-normal text-fg-muted">
                            {h.downloads.toLocaleString()} downloads
                          </span>
                        </div>
                        <div className="truncate text-xs text-fg-muted">{h.description}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {h.external ? (
                          <button
                            onClick={() => h.pageUrl && void window.api.openExternal(h.pageUrl)}
                            className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                            title="Hosted off-site — open the resource page"
                          >
                            <ExternalLink size={13} /> Open page
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => void install(h)}
                              disabled={installing === key}
                              className="inline-flex items-center gap-1.5 rounded-brand bg-accent-2 px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-60"
                            >
                              {installing === key ? (
                                <Loader2 className="animate-spin" size={13} />
                              ) : (
                                <Download size={13} />
                              )}
                              {installing === key ? 'Installing' : 'Install'}
                            </button>
                            {h.pageUrl && (
                              <button
                                onClick={() => h.pageUrl && void window.api.openExternal(h.pageUrl)}
                                className="grid h-7 w-7 place-items-center rounded-brand border border-border text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                                title="Open source page"
                              >
                                <ExternalLink size={13} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
