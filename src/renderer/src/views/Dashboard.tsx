import { useEffect, useMemo, useState, type MouseEvent, type ReactElement } from 'react'
import {
  Plus,
  FolderInput,
  Server,
  Play,
  Square,
  Pencil,
  Copy,
  Trash2,
  Folder
} from 'lucide-react'
import type { Instance, InstanceMeta, Group, ServerStatus } from '@shared/types'
import { SERVER_TYPE_MAP } from '@shared/software'
import { useApp } from '../store'
import { StatusDot } from '../components/StatusDot'

function byOrder<T extends { order: number }>(a: T, b: T): number {
  return a.order - b.order
}

const STATUS_LABEL: Record<ServerStatus, string> = {
  stopped: 'Start',
  starting: 'Starting…',
  running: 'Stop',
  stopping: 'Stopping…'
}

function ServerCard({ meta, instance }: { meta: InstanceMeta; instance?: Instance }): ReactElement {
  const status = useApp((s) => s.status[meta.id] ?? 'stopped')
  const stats = useApp((s) => s.stats[meta.id])
  const openTab = useApp((s) => s.openTab)
  const moveInstance = useApp((s) => s.moveInstance)
  const cloneInstance = useApp((s) => s.cloneInstance)
  const renameInstance = useApp((s) => s.renameInstance)
  const removeInstance = useApp((s) => s.removeInstance)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(meta.name)

  const info = instance ? SERVER_TYPE_MAP[instance.serverType]?.label : null

  async function commitRename(): Promise<void> {
    setEditing(false)
    if (draft.trim() && draft !== meta.name) await renameInstance(meta.id, draft.trim())
    else setDraft(meta.name)
  }

  function toggleRun(e: MouseEvent): void {
    e.stopPropagation()
    if (status === 'stopped') void window.api.startServer(meta.id)
    else void window.api.stopServer(meta.id)
  }

  return (
    <div
      draggable={!editing}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', meta.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const dragged = e.dataTransfer.getData('text/plain')
        if (dragged && dragged !== meta.id) void moveInstance(dragged, meta.groupId, meta.id)
      }}
      onClick={() => openTab(meta.id)}
      className="group flex cursor-pointer flex-col gap-3 rounded-brand border border-border bg-surface p-3 transition hover:border-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={status} />
          {editing ? (
            <input
              autoFocus
              value={draft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename()
                if (e.key === 'Escape') {
                  setEditing(false)
                  setDraft(meta.name)
                }
              }}
              className="w-full rounded bg-input px-1.5 py-0.5 text-sm outline-none ring-1 ring-accent"
            />
          ) : (
            <span className="truncate text-sm font-medium">{meta.name}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
          <IconBtn title="Rename" onClick={(e) => { e.stopPropagation(); setEditing(true) }}>
            <Pencil size={13} />
          </IconBtn>
          <IconBtn title="Duplicate" onClick={(e) => { e.stopPropagation(); void cloneInstance(meta.id) }}>
            <Copy size={13} />
          </IconBtn>
          <IconBtn
            title="Delete"
            danger
            onClick={(e) => {
              e.stopPropagation()
              if (confirm(`Delete "${meta.name}"? This removes the server folder.`))
                void removeInstance(meta.id)
            }}
          >
            <Trash2 size={13} />
          </IconBtn>
        </div>
      </div>

      <div className="text-xs text-fg-muted">
        {info ? `${info} · MC ${instance?.mcVersion} · :${instance?.port}` : 'Loading…'}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={toggleRun}
          disabled={status === 'starting' || status === 'stopping'}
          className={`inline-flex items-center gap-1.5 rounded-brand px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
            status === 'stopped'
              ? 'bg-emerald-500/90 text-white hover:brightness-110'
              : 'bg-red-500/90 text-white hover:brightness-110'
          }`}
        >
          {status === 'stopped' ? <Play size={13} /> : <Square size={12} />}
          {STATUS_LABEL[status]}
        </button>
        {stats && status !== 'stopped' && (
          <span className="text-[11px] text-fg-muted">
            {stats.cpu}% · {stats.memMB} MB
          </span>
        )}
      </div>
    </div>
  )
}

function IconBtn({
  children,
  title,
  danger,
  onClick
}: {
  children: ReactElement
  title: string
  danger?: boolean
  onClick: (e: MouseEvent) => void
}): ReactElement {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded p-1 text-fg-muted transition hover:bg-surface-2 ${
        danger ? 'hover:text-red-400' : 'hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

function CardGrid({
  metas,
  instances
}: {
  metas: InstanceMeta[]
  instances: Record<string, Instance>
}): ReactElement {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      {metas.map((m) => (
        <ServerCard key={m.id} meta={m} instance={instances[m.id]} />
      ))}
    </div>
  )
}

function GroupSection({
  group,
  metas,
  instances
}: {
  group: Group
  metas: InstanceMeta[]
  instances: Record<string, Instance>
}): ReactElement {
  const { renameGroup, deleteGroup, moveInstance } = useApp()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const [dragOver, setDragOver] = useState(false)

  return (
    <section>
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
        className={`group mb-2 flex items-center gap-2 rounded-md px-2 py-1 ${
          dragOver ? 'bg-accent/10 ring-1 ring-accent' : ''
        }`}
      >
        <Folder size={15} className="text-fg-muted" />
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false)
              if (draft.trim() && draft !== group.name) void renameGroup(group.id, draft.trim())
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setEditing(false)
                setDraft(group.name)
              }
            }}
            className="rounded bg-input px-1.5 py-0.5 text-sm font-semibold outline-none ring-1 ring-accent"
          />
        ) : (
          <h2 className="text-sm font-semibold">{group.name}</h2>
        )}
        <span className="text-xs text-fg-muted">{metas.length}</span>
        <div className="ml-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
          <IconBtn title="Rename group" onClick={() => setEditing(true)}>
            <Pencil size={13} />
          </IconBtn>
          <IconBtn
            title="Delete group"
            danger
            onClick={() => {
              if (confirm(`Delete group "${group.name}"? Its servers become ungrouped.`))
                void deleteGroup(group.id)
            }}
          >
            <Trash2 size={13} />
          </IconBtn>
        </div>
      </div>
      {metas.length > 0 ? (
        <CardGrid metas={metas} instances={instances} />
      ) : (
        <div className="rounded-brand border border-dashed border-border px-3 py-4 text-center text-xs text-fg-muted">
          Empty — drag a server here.
        </div>
      )}
    </section>
  )
}

export default function Dashboard(): ReactElement {
  const index = useApp((s) => s.index)
  const openWizard = useApp((s) => s.openWizard)
  const openImport = useApp((s) => s.openImport)
  const createGroup = useApp((s) => s.createGroup)
  const moveInstance = useApp((s) => s.moveInstance)
  const [instances, setInstances] = useState<Record<string, Instance>>({})
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroup, setNewGroup] = useState('')
  const [ungroupedDragOver, setUngroupedDragOver] = useState(false)

  useEffect(() => {
    void window.api
      .listInstances()
      .then((list) => setInstances(Object.fromEntries(list.map((i) => [i.id, i]))))
  }, [index])

  const groups = useMemo(() => [...index.groups].sort(byOrder), [index.groups])
  const byGroup = useMemo(() => {
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
  const ungrouped = useMemo(
    () => index.instances.filter((i) => !i.groupId).sort(byOrder),
    [index.instances]
  )

  const empty = index.instances.length === 0 && index.groups.length === 0

  if (empty) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-accent/15 text-accent">
          <Server size={32} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">Birdflop Server Manager</h1>
          <p className="mt-1 text-sm text-fg-muted">Create your first local test server to begin.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openWizard}
            className="inline-flex items-center gap-2 rounded-brand bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:brightness-110"
          >
            <Plus size={18} /> New Instance
          </button>
          <button
            onClick={openImport}
            className="inline-flex items-center gap-2 rounded-brand border border-border px-4 py-2.5 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <FolderInput size={16} /> Import existing
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-fg-muted">
            {index.instances.length} server{index.instances.length === 1 ? '' : 's'} across{' '}
            {index.groups.length} group{index.groups.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {addingGroup ? (
            <input
              autoFocus
              value={newGroup}
              placeholder="Group name"
              onChange={(e) => setNewGroup(e.target.value)}
              onBlur={() => {
                setAddingGroup(false)
                if (newGroup.trim()) void createGroup(newGroup.trim())
                setNewGroup('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  setAddingGroup(false)
                  setNewGroup('')
                }
              }}
              className="rounded-brand bg-input px-3 py-2 text-sm outline-none ring-1 ring-accent"
            />
          ) : (
            <button
              onClick={() => setAddingGroup(true)}
              className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-2 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
            >
              <Folder size={15} /> New group
            </button>
          )}
          <button
            onClick={openImport}
            className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-2 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <FolderInput size={15} /> Import
          </button>
          <button
            onClick={openWizard}
            className="inline-flex items-center gap-1.5 rounded-brand bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110"
          >
            <Plus size={16} /> New Instance
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {groups.map((g) => (
          <GroupSection key={g.id} group={g} metas={byGroup.get(g.id) ?? []} instances={instances} />
        ))}

        {ungrouped.length > 0 && (
          <section>
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
              className={`mb-2 rounded-md px-2 py-1 text-sm font-semibold text-fg-muted ${
                ungroupedDragOver ? 'bg-accent/10 ring-1 ring-accent' : ''
              }`}
            >
              Ungrouped
            </div>
            <CardGrid metas={ungrouped} instances={instances} />
          </section>
        )}
      </div>
    </div>
  )
}
