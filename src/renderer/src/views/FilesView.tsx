import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  Folder,
  FileText,
  Save,
  RotateCw,
  RefreshCw,
  ChevronRight,
  CornerLeftUp,
  FolderOpen,
  ExternalLink,
  ChevronDown,
  Loader2,
  AlertTriangle
} from 'lucide-react'
import type { DetectedEditor, FileEntry, FileReadResult } from '@shared/types'
import { CodeEditor } from '../components/CodeEditor'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type ReadReason = Exclude<FileReadResult, { ok: true }>['reason']

const READ_MESSAGES: Record<ReadReason, string> = {
  binary: 'This looks like a binary file and can’t be edited as text.',
  'too-large': 'This file is too large to open in the built-in editor.',
  missing: 'This file no longer exists.',
  error: 'This file couldn’t be read.'
}

export function FilesView({ instanceId }: { instanceId: string }): ReactElement {
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [listing, setListing] = useState(true)

  const [openPath, setOpenPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [readState, setReadState] = useState<ReadReason | null>(null)
  const [opening, setOpening] = useState(false)
  const [saving, setSaving] = useState(false)

  const [editors, setEditors] = useState<DetectedEditor[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  const dirty = readState === null && openPath !== null && content !== original

  const loadList = useCallback(
    async (path: string) => {
      setListing(true)
      try {
        setEntries(await window.api.listFiles(instanceId, path))
        setCwd(path)
      } catch {
        setEntries([])
      } finally {
        setListing(false)
      }
    },
    [instanceId]
  )

  // Reset when switching servers.
  useEffect(() => {
    setOpenPath(null)
    setContent('')
    setOriginal('')
    setReadState(null)
    void loadList('')
    void window.api.detectEditors().then(setEditors)
  }, [instanceId, loadList])

  const openFile = useCallback(
    async (entry: FileEntry) => {
      if (dirty && !confirm('Discard unsaved changes?')) return
      setOpening(true)
      setOpenPath(entry.path)
      try {
        const res = await window.api.readFile(instanceId, entry.path)
        if (res.ok) {
          setContent(res.content)
          setOriginal(res.content)
          setReadState(null)
        } else {
          setReadState(res.reason)
        }
      } finally {
        setOpening(false)
      }
    },
    [instanceId, dirty]
  )

  const save = useCallback(async () => {
    if (!openPath) return
    setSaving(true)
    try {
      await window.api.writeFile(instanceId, openPath, content)
      setOriginal(content)
      void loadList(cwd) // refresh sizes
    } finally {
      setSaving(false)
    }
  }, [instanceId, openPath, content, cwd, loadList])

  const reload = useCallback(async () => {
    if (!openPath) return
    if (dirty && !confirm('Discard unsaved changes and reload from disk?')) return
    const res = await window.api.readFile(instanceId, openPath)
    if (res.ok) {
      setContent(res.content)
      setOriginal(res.content)
      setReadState(null)
    } else {
      setReadState(res.reason)
    }
  }, [instanceId, openPath, dirty])

  // Ctrl/Cmd+S saves the open file.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dirty) {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, save])

  const segments = cwd ? cwd.split('/') : []

  function launchEditor(editorId: string): void {
    setMenuOpen(false)
    void window.api.openInEditor(instanceId, editorId)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top toolbar: breadcrumb + external-editor actions */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs text-fg-muted">
          <button
            onClick={() => void loadList('')}
            className="shrink-0 rounded px-1.5 py-0.5 transition hover:bg-surface-2 hover:text-fg"
          >
            Server root
          </button>
          {segments.map((seg, i) => {
            const path = segments.slice(0, i + 1).join('/')
            return (
              <span key={path} className="flex shrink-0 items-center gap-1">
                <ChevronRight size={12} />
                <button
                  onClick={() => void loadList(path)}
                  className="rounded px-1.5 py-0.5 transition hover:bg-surface-2 hover:text-fg"
                >
                  {seg}
                </button>
              </span>
            )
          })}
        </nav>

        <button
          onClick={() => void window.api.openInstanceFolder(instanceId)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <FolderOpen size={13} /> Open folder
        </button>

        {editors.length > 0 && (
          <div className="relative shrink-0">
            <button
              onClick={() =>
                editors.length === 1 ? launchEditor(editors[0].id) : setMenuOpen((o) => !o)
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              title="Open this server's folder in an editor"
            >
              <ExternalLink size={13} />
              {editors.length === 1 ? `Open in ${editors[0].name}` : 'Open in editor'}
              {editors.length > 1 && <ChevronDown size={13} />}
            </button>
            {menuOpen && editors.length > 1 && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 min-w-44 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
                  {editors.map((ed) => (
                    <button
                      key={ed.id}
                      onClick={() => launchEditor(ed.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                    >
                      <ExternalLink size={13} /> {ed.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* File browser */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-border">
          <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            <span>Files</span>
            <button
              onClick={() => void loadList(cwd)}
              title="Refresh"
              className="rounded p-1 transition hover:bg-surface-2 hover:text-fg"
            >
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {cwd && (
              <button
                onClick={() => void loadList(segments.slice(0, -1).join('/'))}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-fg-muted transition hover:bg-surface-2"
              >
                <CornerLeftUp size={15} /> ..
              </button>
            )}
            {listing ? (
              <div className="grid place-items-center py-6 text-fg-muted">
                <Loader2 className="animate-spin" size={16} />
              </div>
            ) : entries.length === 0 ? (
              <p className="px-2 py-4 text-xs text-fg-muted">This folder is empty.</p>
            ) : (
              entries.map((entry) =>
                entry.isDir ? (
                  <button
                    key={entry.path}
                    onClick={() => void loadList(entry.path)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-surface-2"
                  >
                    <Folder size={15} className="shrink-0 text-accent-2" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ) : (
                  <button
                    key={entry.path}
                    onClick={() => void openFile(entry)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-surface-2 ${
                      openPath === entry.path ? 'bg-surface-2 text-fg' : 'text-fg-muted'
                    }`}
                  >
                    <FileText size={15} className="shrink-0 text-fg-muted" />
                    <span className="flex-1 truncate">{entry.name}</span>
                    <span className="shrink-0 text-[10px] text-fg-muted">{formatSize(entry.size)}</span>
                  </button>
                )
              )
            )}
          </div>
        </aside>

        {/* Editor */}
        <section className="flex min-w-0 flex-1 flex-col">
          {openPath === null ? (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-fg-muted">
              <div>
                <FileText className="mx-auto mb-2 opacity-40" size={28} />
                Select a file to view or edit.
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
                  {openPath}
                  {dirty && <span className="ml-1.5 text-accent">●</span>}
                </span>
                <button
                  onClick={() => void reload()}
                  disabled={opening}
                  title="Reload from disk"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
                >
                  <RotateCw size={13} /> Reload
                </button>
                <button
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
                >
                  {saving ? <Loader2 className="animate-spin" size={13} /> : <Save size={13} />}
                  Save
                </button>
              </div>
              <div className="min-h-0 flex-1">
                {opening ? (
                  <div className="grid h-full place-items-center text-fg-muted">
                    <Loader2 className="animate-spin" size={18} />
                  </div>
                ) : readState ? (
                  <div className="grid h-full place-items-center px-6 text-center text-sm text-fg-muted">
                    <div>
                      <AlertTriangle className="mx-auto mb-2 text-amber-400" size={26} />
                      {READ_MESSAGES[readState]}
                      {editors.length > 0 && readState !== 'missing' && (
                        <div className="mt-3">
                          <button
                            onClick={() => launchEditor(editors[0].id)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition hover:bg-surface-2 hover:text-fg"
                          >
                            <ExternalLink size={13} /> Open in {editors[0].name}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <CodeEditor value={content} filename={openPath} onChange={setContent} />
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
