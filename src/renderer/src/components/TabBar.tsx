import type { ReactElement } from 'react'
import { LayoutDashboard, Server, X, ArrowDownCircle, Settings } from 'lucide-react'
import { useApp } from '../store'
import { ThemeToggle } from './ThemeToggle'
import { StatusDot } from './StatusDot'

export default function TabBar(): ReactElement {
  const openTabs = useApp((s) => s.openTabs)
  const activeTabId = useApp((s) => s.activeTabId)
  const instances = useApp((s) => s.index.instances)
  const setActiveTab = useApp((s) => s.setActiveTab)
  const closeTab = useApp((s) => s.closeTab)
  const statusMap = useApp((s) => s.status)
  const openSettings = useApp((s) => s.openSettings)

  const nameOf = (id: string): string => instances.find((i) => i.id === id)?.name ?? 'Unknown'

  return (
    <header className="flex h-11 items-center gap-1 border-b border-border bg-app px-2">
      <button
        onClick={() => setActiveTab(null)}
        className={`flex h-8 items-center gap-2 rounded-md px-3 text-sm transition ${
          activeTabId === null
            ? 'bg-surface-2 text-fg'
            : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg'
        }`}
        title="Dashboard"
      >
        <LayoutDashboard size={15} />
        <span className="hidden sm:inline">Dashboard</span>
      </button>

      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        {openTabs.map((id) => {
          const active = activeTabId === id
          return (
            <div
              key={id}
              onClick={() => setActiveTab(id)}
              className={`group flex h-8 max-w-48 cursor-pointer items-center gap-2 rounded-md px-3 text-sm transition ${
                active
                  ? 'bg-surface-2 text-fg'
                  : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg'
              }`}
            >
              {statusMap[id] && statusMap[id] !== 'stopped' ? (
                <StatusDot status={statusMap[id]} size={7} />
              ) : (
                <Server size={14} className="shrink-0" />
              )}
              <span className="truncate">{nameOf(id)}</span>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(id)
                }}
                className="-mr-1 rounded p-0.5 opacity-0 transition hover:bg-border group-hover:opacity-100"
              >
                <X size={13} />
              </span>
            </div>
          )
        })}
      </div>

      <UpdateBadge />
      <button
        onClick={openSettings}
        className="grid h-8 w-8 place-items-center rounded-brand border border-border text-fg-muted transition hover:bg-surface-2 hover:text-fg"
        title="Settings"
      >
        <Settings size={16} />
      </button>
      <ThemeToggle />
    </header>
  )
}

function UpdateBadge(): ReactElement | null {
  const update = useApp((s) => s.update)
  const openUpdateModal = useApp((s) => s.openUpdateModal)
  if (!['available', 'downloading', 'downloaded'].includes(update.state)) return null
  const label =
    update.state === 'downloaded'
      ? 'Restart to update'
      : update.state === 'downloading'
        ? `Updating ${update.percent ?? 0}%`
        : 'Update available'
  return (
    <button
      onClick={openUpdateModal}
      className="mr-1 inline-flex items-center gap-1.5 rounded-brand bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-accent/25"
    >
      <ArrowDownCircle size={14} /> {label}
    </button>
  )
}
