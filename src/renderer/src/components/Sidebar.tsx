import { useMemo, useState, type ReactElement } from 'react'
import {
  Plus,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderInput,
  Server,
  Pencil,
  Trash2,
  Check,
  X
} from 'lucide-react'
import type { Group, InstanceMeta } from '@shared/types'
import { useApp } from '../store'
import { StatusDot } from './StatusDot'
import { BirdflopLogo } from './BirdflopLogo'

function byOrder<T extends { order: number }>(a: T, b: T): number {
  return a.order - b.order
}

function InstanceRow({ inst }: { inst: InstanceMeta }): ReactElement {
  const activeTabId = useApp((s) => s.activeTabId)
  const openTab = useApp((s) => s.openTab)
  const moveInstance = useApp((s) => s.moveInstance)
  const status = useApp((s) => s.status[inst.id] ?? 'stopped')
  const active = activeTabId === inst.id

  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', inst.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const dragged = e.dataTransfer.getData('text/plain')
        if (dragged && dragged !== inst.id) void moveInstance(dragged, inst.groupId, inst.id)
      }}
      onClick={() => openTab(inst.id)}
      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
        active
          ? 'bg-accent/15 text-accent'
          : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      <Server size={15} className="shrink-0" />
      <span className="flex-1 truncate">{inst.name}</span>
      {status !== 'stopped' && <StatusDot status={status} size={7} />}
    </button>
  )
}

function GroupRow({
  group,
  instances
}: {
  group: Group
  instances: InstanceMeta[]
}): ReactElement {
  const { toggleGroup, renameGroup, deleteGroup, moveInstance } = useApp()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const [dragOver, setDragOver] = useState(false)

  async function commitRename(): Promise<void> {
    setEditing(false)
    if (draft.trim() && draft !== group.name) await renameGroup(group.id, draft.trim())
    else setDraft(group.name)
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const dragged = e.dataTransfer.getData('text/plain')
          if (dragged) void moveInstance(dragged, group.id)
        }}
        className={`group flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold uppercase tracking-wide transition ${
          dragOver ? 'bg-accent/15 ring-1 ring-accent' : 'text-fg-muted'
        }`}
      >
        <button
          onClick={() => void toggleGroup(group.id, !group.expanded)}
          className="flex flex-1 items-center gap-1 overflow-hidden text-left hover:text-fg"
        >
          {group.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {group.expanded ? <FolderOpen size={13} /> : <Folder size={13} />}
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename()
                if (e.key === 'Escape') {
                  setEditing(false)
                  setDraft(group.name)
                }
              }}
              className="w-full rounded bg-input px-1 py-0.5 text-xs font-normal normal-case text-fg outline-none ring-1 ring-accent"
            />
          ) : (
            <span className="truncate">{group.name}</span>
          )}
          {!editing && <span className="ml-1 normal-case text-fg-muted/70">{instances.length}</span>}
        </button>

        {editing ? (
          <span className="flex items-center gap-0.5">
            <span
              role="button"
              onClick={() => void commitRename()}
              className="rounded p-0.5 hover:text-accent"
            >
              <Check size={13} />
            </span>
            <span
              role="button"
              onClick={() => {
                setEditing(false)
                setDraft(group.name)
              }}
              className="rounded p-0.5 hover:text-fg"
            >
              <X size={13} />
            </span>
          </span>
        ) : (
          <span className="hidden items-center gap-0.5 group-hover:flex">
            <span
              role="button"
              onClick={() => setEditing(true)}
              className="rounded p-0.5 hover:text-fg"
              title="Rename group"
            >
              <Pencil size={13} />
            </span>
            <span
              role="button"
              onClick={() => {
                if (confirm(`Delete group "${group.name}"? Its servers become ungrouped.`))
                  void deleteGroup(group.id)
              }}
              className="rounded p-0.5 hover:text-red-400"
              title="Delete group"
            >
              <Trash2 size={13} />
            </span>
          </span>
        )}
      </div>

      {group.expanded && (
        <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
          {instances.length === 0 ? (
            <div className="px-2 py-1 text-xs text-fg-muted/60">Empty</div>
          ) : (
            instances.map((inst) => <InstanceRow key={inst.id} inst={inst} />)
          )}
        </div>
      )}
    </div>
  )
}

export default function Sidebar(): ReactElement {
  const index = useApp((s) => s.index)
  const rootPath = useApp((s) => s.config?.rootPath ?? '')
  const openWizard = useApp((s) => s.openWizard)
  const openImport = useApp((s) => s.openImport)
  const createGroup = useApp((s) => s.createGroup)
  const moveInstance = useApp((s) => s.moveInstance)

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [ungroupedDragOver, setUngroupedDragOver] = useState(false)

  const groups = useMemo(() => [...index.groups].sort(byOrder), [index.groups])
  const ungrouped = useMemo(
    () => index.instances.filter((i) => !i.groupId).sort(byOrder),
    [index.instances]
  )
  const instancesByGroup = useMemo(() => {
    const map = new Map<string, InstanceMeta[]>()
    for (const inst of [...index.instances].sort(byOrder)) {
      if (inst.groupId) {
        const arr = map.get(inst.groupId) ?? []
        arr.push(inst)
        map.set(inst.groupId, arr)
      }
    }
    return map
  }, [index.instances])

  async function commitNewGroup(): Promise<void> {
    const name = newName.trim()
    setAdding(false)
    setNewName('')
    if (name) await createGroup(name)
  }

  const empty = index.instances.length === 0 && index.groups.length === 0

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <BirdflopLogo size={32} />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Birdflop</div>
          <div className="text-xs text-fg-muted">Server Manager</div>
        </div>
      </div>

      <div className="space-y-1.5 px-3">
        <button
          onClick={openWizard}
          className="flex w-full items-center justify-center gap-2 rounded-brand bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110"
        >
          <Plus size={16} /> New Instance
        </button>
        <button
          onClick={openImport}
          className="flex w-full items-center justify-center gap-2 rounded-brand border border-border px-3 py-1.5 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <FolderInput size={14} /> Import existing
        </button>
      </div>

      {/* Tree */}
      <div className="mt-4 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {groups.map((group) => (
          <GroupRow key={group.id} group={group} instances={instancesByGroup.get(group.id) ?? []} />
        ))}

        {/* Ungrouped */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setUngroupedDragOver(true)
          }}
          onDragLeave={() => setUngroupedDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setUngroupedDragOver(false)
            const dragged = e.dataTransfer.getData('text/plain')
            if (dragged) void moveInstance(dragged, null)
          }}
          className={`rounded-md px-1.5 py-1 text-xs font-semibold uppercase tracking-wide transition ${
            ungroupedDragOver ? 'bg-accent/15 ring-1 ring-accent' : 'text-fg-muted'
          }`}
        >
          Ungrouped
        </div>
        <div className="ml-1 flex flex-col gap-0.5">
          {ungrouped.map((inst) => (
            <InstanceRow key={inst.id} inst={inst} />
          ))}
        </div>

        {empty && (
          <div className="mt-6 flex flex-col items-center gap-2 px-6 text-center text-fg-muted">
            <Server size={24} className="opacity-50" />
            <p className="text-xs">No servers yet. Click “New Instance” to create one.</p>
          </div>
        )}
      </div>

      {/* New group + root footer */}
      <div className="border-t border-border px-3 py-2">
        {adding ? (
          <input
            autoFocus
            value={newName}
            placeholder="Group name"
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => void commitNewGroup()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitNewGroup()
              if (e.key === 'Escape') {
                setAdding(false)
                setNewName('')
              }
            }}
            className="w-full rounded-md bg-input px-2 py-1.5 text-sm text-fg outline-none ring-1 ring-accent"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <Plus size={15} /> New group
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted" title={rootPath}>
          <FolderOpen size={13} className="shrink-0" />
          <span className="truncate">{rootPath}</span>
        </div>
        <VersionBadge />
      </div>
    </aside>
  )
}

function VersionBadge(): ReactElement {
  const version = useApp((s) => s.appVersion)
  const update = useApp((s) => s.update)
  const openUpdateModal = useApp((s) => s.openUpdateModal)
  const hasUpdate =
    update.state === 'available' || update.state === 'downloading' || update.state === 'downloaded'
  return (
    <button
      onClick={openUpdateModal}
      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
      title="About & updates"
    >
      {hasUpdate && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      v{version || '…'}
    </button>
  )
}
