import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  AlertTriangle,
  Download,
  FilePlus2,
  FileText,
  FolderPlus,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCw,
  Save,
  Trash2,
  Upload
} from 'lucide-react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import type {
  ContextMenuItem,
  FileTreeBatchOperation,
  FileTreeDropResult,
  FileTreeRenameEvent
} from '@pierre/trees'
import type { FileReadResult } from '@shared/types'
import { friendlyError } from '../errors'
import { CodeEditor } from '../components/CodeEditor'
import {
  TREE_HOST_STYLE,
  baseName,
  dropMapKeys,
  dropSetMembers,
  entryPath,
  formatSize,
  parentTreePath,
  remapMapKeys,
  remapPath,
  remapSet,
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

function MenuButton({
  danger,
  onClick,
  children
}: {
  danger?: boolean
  onClick: () => void
  children: ReactNode
}): ReactElement {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-surface-2 ${
        danger ? 'text-red-400 hover:text-red-300' : 'text-fg-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Browse + edit the files of a remote panel server. The tree loads lazily: each
 * directory's contents are fetched from the panel the first time it's expanded.
 */
export function PanelFilesView({
  serverId,
  onDirtyChange
}: {
  serverId: string
  /** Reports unsaved-editor-changes state so the parent can guard navigation away. */
  onDirtyChange?: (dirty: boolean) => void
}): ReactElement {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [openPath, setOpenPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [readState, setReadState] = useState<ReadReason | null>(null)
  const [opening, setOpening] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const dirty = readState === null && openPath !== null && content !== original

  // Report dirtiness upward (and clear it when this view unmounts).
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    return () => onDirtyChange?.(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The tree model owns structure; these refs carry everything else per path.
  const sizesRef = useRef(new Map<string, number>()) // file tree-path → bytes
  const unloadedRef = useRef(new Set<string>()) // dirs in the tree whose contents we haven't fetched
  const pendingRef = useRef(new Set<string>()) // dirs currently being fetched
  const openPathRef = useRef<string | null>(null)
  // Directory new files/folders/uploads go into (canonical, '' = root).
  const [activeDir, setActiveDir] = useState('')

  const setOpen = useCallback((path: string | null): void => {
    openPathRef.current = path
    setOpenPath(path)
  }, [])

  const onSelectRef = useRef<(paths: readonly string[]) => void>(() => {})
  const onRenameRef = useRef<(event: FileTreeRenameEvent) => void>(() => {})
  const onDropRef = useRef<(event: FileTreeDropResult) => void>(() => {})

  const { width: treeWidth, onPointerDown: onResizeStart } = useTreeWidth()

  const { model } = useFileTree({
    paths: [],
    search: true,
    icons: { set: 'complete', colored: true },
    density: 'compact',
    onSelectionChange: (paths) => onSelectRef.current(paths),
    renaming: {
      onRename: (event) => onRenameRef.current(event),
      onError: (message) => alert(message)
    },
    dragAndDrop: {
      onDropComplete: (event) => onDropRef.current(event),
      onDropError: (message) => alert(message)
    },
    renderRowDecoration: ({ row }) => {
      if (row.kind !== 'file') return null
      const size = sizesRef.current.get(row.path)
      return size === undefined ? null : { text: formatSize(size) }
    }
  })

  /** Fetch a directory's contents into the tree (dir is canonical: '' or 'plugins/'). */
  const loadDir = useCallback(
    async (dir: string) => {
      if (pendingRef.current.has(dir)) return
      pendingRef.current.add(dir)
      unloadedRef.current.delete(dir)
      try {
        const children = await window.api.pteroListFiles(serverId, entryPath(dir))
        const ops: FileTreeBatchOperation[] = []
        for (const child of children) {
          const path = treePath(child)
          const isNew = model.getItem(path) === null
          if (child.isDir) {
            if (isNew) unloadedRef.current.add(path)
          } else {
            sizesRef.current.set(path, child.size)
          }
          if (isNew) ops.push({ type: 'add', path })
        }
        if (ops.length > 0) model.batch(ops)
        setError(null)
      } catch (err) {
        if (dir !== '') unloadedRef.current.add(dir) // collapse + re-expand retries
        setError(friendlyError(err))
      } finally {
        pendingRef.current.delete(dir)
      }
    },
    [serverId, model]
  )

  // Lazy loading: whenever the tree changes, fetch any not-yet-loaded dir that
  // is now expanded. (Trees has no expand event, but subscribe covers it.)
  useEffect(() => {
    return model.subscribe(() => {
      for (const dir of [...unloadedRef.current]) {
        const item = model.getItem(dir)
        if (item !== null && 'isExpanded' in item && item.isExpanded()) void loadDir(dir)
      }
    })
  }, [model, loadDir])

  // Keep the path-keyed bookkeeping (and the open file) in sync with tree
  // mutations, wherever they come from: renames, drag-and-drop, or reverts.
  useEffect(() => {
    return model.onMutation('*', (event) => {
      const events = event.operation === 'batch' ? event.events : [event]
      for (const ev of events) {
        if (ev.operation === 'move') {
          remapMapKeys(sizesRef.current, ev.from, ev.to)
          remapSet(unloadedRef.current, ev.from, ev.to)
          remapSet(pendingRef.current, ev.from, ev.to)
          setActiveDir((dir) => (dir ? (remapPath(dir, ev.from, ev.to) ?? dir) : dir))
          if (openPathRef.current !== null) {
            const moved = remapPath(openPathRef.current, ev.from, ev.to)
            if (moved !== null) setOpen(moved)
          }
        } else if (ev.operation === 'remove') {
          dropMapKeys(sizesRef.current, ev.path)
          dropSetMembers(unloadedRef.current, ev.path)
          setActiveDir((dir) =>
            dir === ev.path || (ev.path.endsWith('/') && dir.startsWith(ev.path)) ? '' : dir
          )
        }
      }
    })
  }, [model, setOpen])

  const refresh = useCallback(async () => {
    sizesRef.current.clear()
    unloadedRef.current.clear()
    pendingRef.current.clear()
    setError(null)
    model.resetPaths([])
    await loadDir('')
  }, [model, loadDir])

  // (Re)load when switching servers.
  useEffect(() => {
    setOpen(null)
    setContent('')
    setOriginal('')
    setReadState(null)
    setActiveDir('')
    setLoading(true)
    void refresh().finally(() => setLoading(false))
  }, [serverId, refresh, setOpen])

  const openFile = useCallback(
    async (path: string) => {
      setOpening(true)
      setOpen(path)
      try {
        const res = await window.api.pteroReadFile(serverId, path)
        if (res.ok) {
          setContent(res.content)
          setOriginal(res.content)
          setReadState(null)
        } else {
          setReadState(res.reason)
        }
      } catch (err) {
        // Don't leave the previous file's content on screen under the new path.
        setReadState('error')
        setError(friendlyError(err))
      } finally {
        setOpening(false)
      }
    },
    [serverId, setOpen]
  )

  // Tree selection → open files; directories steer where new files/uploads go.
  onSelectRef.current = (paths) => {
    const selected = paths[0]
    if (!selected) return
    if (selected.endsWith('/')) {
      setActiveDir(selected)
      return
    }
    setActiveDir(parentTreePath(selected))
    if (selected === openPathRef.current) return
    if (dirty && !confirm('Discard unsaved changes?')) {
      // Put the selection back on the file that's open in the editor.
      model.getItem(selected)?.deselect()
      if (openPathRef.current !== null) model.getItem(openPathRef.current)?.select()
      return
    }
    void openFile(selected)
  }

  // Inline rename committed in the tree → apply on the panel; revert on failure.
  onRenameRef.current = (event) => {
    void (async () => {
      try {
        await window.api.pteroRenameFile(serverId, '', event.sourcePath, event.destinationPath)
      } catch (err) {
        alert(friendlyError(err))
        const suffix = event.isFolder ? '/' : ''
        model.move(event.destinationPath + suffix, event.sourcePath + suffix)
      }
    })()
  }

  // Drag-and-drop move already applied in the tree → apply on the panel; revert on failure.
  onDropRef.current = (event) => {
    const destDir = event.target.directoryPath ?? ''
    for (const source of event.draggedPaths) {
      const destination = destDir + baseName(source) + (source.endsWith('/') ? '/' : '')
      void (async () => {
        try {
          await window.api.pteroRenameFile(serverId, '', entryPath(source), entryPath(destination))
        } catch (err) {
          alert(friendlyError(err))
          model.move(destination, source)
        }
      })()
    }
  }

  const save = useCallback(async () => {
    if (!openPath) return
    setSaving(true)
    try {
      await window.api.pteroWriteFile(serverId, openPath, content)
      setOriginal(content)
      sizesRef.current.set(openPath, new TextEncoder().encode(content).length)
    } catch (err) {
      alert(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }, [serverId, openPath, content])

  const reload = useCallback(async () => {
    if (!openPath) return
    if (dirty && !confirm('Discard unsaved changes and reload from the server?')) return
    try {
      const res = await window.api.pteroReadFile(serverId, openPath)
      if (res.ok) {
        setContent(res.content)
        setOriginal(res.content)
        setReadState(null)
      } else {
        setReadState(res.reason)
      }
    } catch (err) {
      setReadState('error')
      setError(friendlyError(err))
    }
  }, [serverId, openPath, dirty])

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

  async function newFolder(): Promise<void> {
    const name = prompt(`Folder name (created in ${activeDir || 'the server root'})`)?.trim()
    if (!name) return
    try {
      await window.api.pteroCreateFolder(serverId, entryPath(activeDir), name)
      const path = `${activeDir}${name}/`
      // A brand-new folder is empty, so it's already "loaded".
      if (model.getItem(path) === null) model.add(path)
    } catch (err) {
      alert(friendlyError(err))
    }
  }

  async function newFile(): Promise<void> {
    const name = prompt(
      `File name (created in ${activeDir || 'the server root'}, e.g. config.yml)`
    )?.trim()
    if (!name) return
    const path = activeDir + name
    try {
      await window.api.pteroWriteFile(serverId, path, '')
      if (model.getItem(path) === null) model.add(path)
      sizesRef.current.set(path, 0)
      setOpen(path)
      setContent('')
      setOriginal('')
      setReadState(null)
      model.getItem(path)?.select()
    } catch (err) {
      alert(friendlyError(err))
    }
  }

  async function upload(): Promise<void> {
    setUploading(true)
    try {
      const fresh = await window.api.pteroUploadFiles(serverId, entryPath(activeDir))
      if (fresh) {
        const ops: FileTreeBatchOperation[] = []
        for (const child of fresh) {
          const path = treePath(child)
          const isNew = model.getItem(path) === null
          if (child.isDir) {
            if (isNew) unloadedRef.current.add(path)
          } else {
            sizesRef.current.set(path, child.size)
          }
          if (isNew) ops.push({ type: 'add', path })
        }
        if (ops.length > 0) model.batch(ops)
      }
    } catch (err) {
      alert(friendlyError(err))
    } finally {
      setUploading(false)
    }
  }

  async function removeItem(item: ContextMenuItem): Promise<void> {
    const isDir = item.kind === 'directory'
    const what = isDir ? 'folder and everything in it' : 'file'
    if (!confirm(`Delete "${item.name}"? This ${what} will be removed from the server.`)) return
    try {
      await window.api.pteroDeleteFiles(serverId, entryPath(parentTreePath(item.path)), [item.name])
      const open = openPathRef.current
      if (open !== null && (open === item.path || (isDir && open.startsWith(item.path)))) {
        setOpen(null)
        setReadState(null)
      }
      model.remove(item.path, isDir ? { recursive: true } : undefined)
    } catch (err) {
      alert(friendlyError(err))
    }
  }

  const toolbarBtn =
    'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50'

  return (
    <div className="flex h-full flex-col">
      {/* Folder actions (they target the selected folder) */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
          New files and uploads go to{' '}
          <span className="font-mono">{activeDir ? entryPath(activeDir) : 'the server root'}</span>
        </span>
        <button onClick={() => void newFile()} className={toolbarBtn}>
          <FilePlus2 size={13} /> New file
        </button>
        <button onClick={() => void newFolder()} className={toolbarBtn}>
          <FolderPlus size={13} /> New folder
        </button>
        <button onClick={() => void upload()} disabled={uploading} className={toolbarBtn}>
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Upload
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded-brand border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

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
                    onClick={() => void refresh()}
                    title="Refresh"
                    className="rounded p-1 transition hover:bg-surface-2 hover:text-fg"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              }
              renderContextMenu={(item, context) => (
                <div className="min-w-40 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg">
                  {item.kind === 'file' && (
                    <MenuButton
                      onClick={() => {
                        context.close()
                        void window.api
                          .pteroDownloadFile(serverId, item.path)
                          .catch((err) => setError(friendlyError(err)))
                      }}
                    >
                      <Download size={13} /> Download
                    </MenuButton>
                  )}
                  <MenuButton
                    onClick={() => {
                      context.close({ restoreFocus: false })
                      model.startRenaming(item.path)
                    }}
                  >
                    <Pencil size={13} /> Rename
                  </MenuButton>
                  <MenuButton
                    danger
                    onClick={() => {
                      context.close()
                      void removeItem(item)
                    }}
                  >
                    <Trash2 size={13} /> Delete
                  </MenuButton>
                </div>
              )}
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
                  title="Reload from the server"
                  className={toolbarBtn}
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
                      {readState !== 'missing' && (
                        <div className="mt-3">
                          <button
                            onClick={() =>
                              void window.api
                                .pteroDownloadFile(serverId, openPath)
                                .catch((err) => setError(friendlyError(err)))
                            }
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs transition hover:bg-surface-2 hover:text-fg"
                          >
                            <Download size={13} /> Download instead
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
