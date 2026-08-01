import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  FileText,
  Save,
  RotateCw,
  RefreshCw,
  FolderOpen,
  ExternalLink,
  ChevronDown,
  Loader2,
  AlertTriangle
} from 'lucide-react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import type { DetectedEditor, FileReadResult } from '@shared/types'
import { CodeEditor } from '../components/CodeEditor'
import {
  TREE_HOST_STYLE,
  entryPath,
  formatSize,
  parentTreePath,
  treePath,
  useTreeWidth
} from '../components/serverFileTree'

type ReadReason = Exclude<FileReadResult, { ok: true }>['reason']

const READ_MESSAGES: Record<ReadReason, string> = {
  binary: 'This looks like a binary file and can’t be edited as text.',
  'too-large': 'This file is too large to open in the built-in editor.',
  missing: 'This file no longer exists.',
  error: 'This file couldn’t be read.'
}

export function FilesView({ instanceId }: { instanceId: string }): ReactElement {
  const [loading, setLoading] = useState(true)
  const [truncated, setTruncated] = useState(false)

  const [openPath, setOpenPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [readState, setReadState] = useState<ReadReason | null>(null)
  const [opening, setOpening] = useState(false)
  const [saving, setSaving] = useState(false)

  const [editors, setEditors] = useState<DetectedEditor[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  const dirty = readState === null && openPath !== null && content !== original

  // Per-path metadata backing the row decorations; refs so the tree's
  // construction-time callbacks always see current data.
  const sizesRef = useRef(new Map<string, number>())
  const dirPathsRef = useRef<string[]>([])
  // Directory the user last touched — used by "Open folder".
  const [activeDir, setActiveDir] = useState('')

  const onSelectRef = useRef<(paths: readonly string[]) => void>(() => {})

  const { width: treeWidth, onPointerDown: onResizeStart } = useTreeWidth()

  const { model } = useFileTree({
    paths: [],
    search: true,
    icons: { set: 'complete', colored: true },
    density: 'compact',
    onSelectionChange: (paths) => onSelectRef.current(paths),
    renderRowDecoration: ({ row }) => {
      if (row.kind !== 'file') return null
      const size = sizesRef.current.get(row.path)
      return size === undefined ? null : { text: formatSize(size) }
    }
  })

  const loadTree = useCallback(
    async (preserveExpansion: boolean) => {
      const listing = await window.api.listFilesDeep(instanceId)
      const paths: string[] = []
      const sizes = new Map<string, number>()
      const dirPaths: string[] = []
      for (const entry of listing.entries) {
        const p = treePath(entry)
        paths.push(p)
        if (entry.isDir) dirPaths.push(p)
        else sizes.set(p, entry.size)
      }
      // Keep folders the user already opened expanded across a refresh.
      const expanded = preserveExpansion
        ? dirPaths.filter((p) => {
            const item = model.getItem(p)
            return item !== null && 'isExpanded' in item && item.isExpanded()
          })
        : undefined
      sizesRef.current = sizes
      dirPathsRef.current = dirPaths
      setTruncated(listing.truncated)
      model.resetPaths(paths, expanded ? { initialExpandedPaths: expanded } : undefined)
    },
    [instanceId, model]
  )

  // Reset when switching servers.
  useEffect(() => {
    setOpenPath(null)
    setContent('')
    setOriginal('')
    setReadState(null)
    setActiveDir('')
    setLoading(true)
    void loadTree(false).finally(() => setLoading(false))
    void window.api.detectEditors().then(setEditors)
  }, [instanceId, loadTree])

  const openFile = useCallback(
    async (path: string) => {
      setOpening(true)
      setOpenPath(path)
      try {
        const res = await window.api.readFile(instanceId, path)
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
    [instanceId]
  )

  // Tree selection → open files (directories only steer "Open folder").
  onSelectRef.current = (paths) => {
    const selected = paths[0]
    if (!selected) return
    if (selected.endsWith('/')) {
      setActiveDir(entryPath(selected))
      return
    }
    setActiveDir(entryPath(parentTreePath(selected)))
    if (selected === openPath) return
    if (dirty && !confirm('Discard unsaved changes?')) {
      // Put the selection back on the file that's open in the editor.
      model.getItem(selected)?.deselect()
      if (openPath) model.getItem(openPath)?.select()
      return
    }
    void openFile(selected)
  }

  const save = useCallback(async () => {
    if (!openPath) return
    setSaving(true)
    try {
      await window.api.writeFile(instanceId, openPath, content)
      setOriginal(content)
      sizesRef.current.set(openPath, new TextEncoder().encode(content).length)
    } finally {
      setSaving(false)
    }
  }, [instanceId, openPath, content])

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

  function launchEditor(editorId: string): void {
    setMenuOpen(false)
    void window.api.openInEditor(instanceId, editorId)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top toolbar: external-editor actions */}
      <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2">
        {truncated && (
          <span className="mr-auto text-xs text-amber-400">
            This server has too many files to show them all — the tree is truncated.
          </span>
        )}
        <button
          onClick={() => void window.api.openInstanceFolder(instanceId, activeDir)}
          title={
            activeDir
              ? `Open ${activeDir} in your file manager`
              : 'Open the server folder in your file manager'
          }
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
        {/* File tree */}
        <aside
          style={{ width: treeWidth }}
          className="relative flex shrink-0 flex-col border-r border-border"
        >
          <div
            onPointerDown={onResizeStart}
            title="Drag to resize"
            className="absolute inset-y-0 -right-[3px] z-10 w-1.5 cursor-col-resize transition hover:bg-accent/40 active:bg-accent/60"
          />
          {loading ? (
            <div className="grid flex-1 place-items-center text-fg-muted">
              <Loader2 className="animate-spin" size={16} />
            </div>
          ) : (
            <FileTree
              model={model}
              style={TREE_HOST_STYLE}
              header={
                <div className="flex w-full items-center justify-between px-2.5 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  <span>Files</span>
                  <button
                    onClick={() => void loadTree(true)}
                    title="Refresh"
                    className="rounded p-1 transition hover:bg-surface-2 hover:text-fg"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              }
            />
          )}
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
