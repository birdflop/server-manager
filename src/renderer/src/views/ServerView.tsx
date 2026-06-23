import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  Terminal,
  Package,
  Settings,
  Play,
  Square,
  RotateCw,
  Loader2,
  Archive,
  Cpu,
  MemoryStick,
  Activity,
  Network
} from 'lucide-react'
import type { Instance, ServerStatus } from '@shared/types'
import { SERVER_TYPE_MAP, contentKindOf, contentSourcesOf, isProxy } from '@shared/software'
import { useApp } from '../store'
import { StatusDot } from '../components/StatusDot'
import { CopyAddress } from '../components/CopyAddress'
import { ConsoleView } from './ConsoleView'
import { ContentView } from './ContentView'
import { SettingsView } from './SettingsView'
import { BackupsView } from './BackupsView'
import { PerformanceView } from './PerformanceView'
import { ProxyBackendsView } from './ProxyBackendsView'

type SubId = 'console' | 'content' | 'backends' | 'performance' | 'backups' | 'settings'

const STATUS_LABEL: Record<ServerStatus, string> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  running: 'Running',
  stopping: 'Stopping…'
}

export default function ServerView({ instanceId }: { instanceId: string }): ReactElement {
  const status = useApp((s) => s.status[instanceId] ?? 'stopped')
  const stats = useApp((s) => s.stats[instanceId])
  const refreshIndex = useApp((s) => s.refreshIndex)
  const closeTab = useApp((s) => s.closeTab)
  const [instance, setInstance] = useState<Instance | null>(null)
  const [sub, setSub] = useState<SubId>('console')

  useEffect(() => {
    setInstance(null)
    setSub('console')
    void window.api.getInstance(instanceId).then(setInstance)
  }, [instanceId])

  const reload = useCallback(async () => {
    setInstance(await window.api.getInstance(instanceId))
    await refreshIndex()
  }, [instanceId, refreshIndex])

  if (!instance) {
    return (
      <div className="grid h-full place-items-center text-fg-muted">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  const ck = contentKindOf(instance.serverType)
  const proxy = isProxy(instance.serverType)
  const contentLabel = ck === 'plugins' ? 'Plugins' : 'Mods'
  const subviews: { id: SubId; label: string; icon: typeof Terminal }[] = [
    { id: 'console', label: 'Console', icon: Terminal },
    ...(ck !== 'none' ? [{ id: 'content' as SubId, label: contentLabel, icon: Package }] : []),
    ...(proxy ? [{ id: 'backends' as SubId, label: 'Backends', icon: Network }] : []),
    { id: 'performance', label: 'Performance', icon: Activity },
    { id: 'backups', label: 'Backups', icon: Archive },
    { id: 'settings', label: 'Settings', icon: Settings }
  ]

  const busy = status === 'starting' || status === 'stopping'

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{instance.name}</h1>
              <StatusDot status={status} />
              <span className="text-xs text-fg-muted">{STATUS_LABEL[status]}</span>
              {stats && status !== 'stopped' && (
                <span className="flex items-center gap-3 text-xs text-fg-muted">
                  <span className="flex items-center gap-1">
                    <Cpu size={12} /> {stats.cpu}%
                  </span>
                  <span className="flex items-center gap-1">
                    <MemoryStick size={12} /> {stats.memMB} MB
                  </span>
                </span>
              )}
            </div>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
              <span>
                {SERVER_TYPE_MAP[instance.serverType].label} ·{' '}
                {proxy ? '' : 'MC '}
                {instance.mcVersion} · {instance.build}
              </span>
              <CopyAddress port={instance.port} />
            </p>
          </div>

          <div className="flex items-center gap-2">
            {status === 'stopped' ? (
              <button
                onClick={() => void window.api.startServer(instanceId)}
                className="inline-flex items-center gap-1.5 rounded-brand bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110"
              >
                <Play size={15} /> Start
              </button>
            ) : (
              <button
                onClick={() => void window.api.stopServer(instanceId)}
                disabled={status === 'stopping'}
                className="inline-flex items-center gap-1.5 rounded-brand bg-red-500/90 px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
              >
                <Square size={14} /> Stop
              </button>
            )}
            <button
              onClick={() => void window.api.restartServer(instanceId)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            >
              <RotateCw size={14} /> Restart
            </button>
          </div>
        </div>

        <div className="mt-3 flex gap-1">
          {subviews.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSub(id)}
              className={`flex items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-sm transition ${
                sub === id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {sub === 'console' && <ConsoleView instanceId={instanceId} />}
        {sub === 'content' && (
          <ContentView
            instanceId={instanceId}
            label={contentLabel}
            sources={contentSourcesOf(instance.serverType)}
          />
        )}
        {sub === 'backends' && <ProxyBackendsView instance={instance} status={status} />}
        {sub === 'performance' && <PerformanceView instance={instance} />}
        {sub === 'backups' && <BackupsView instanceId={instanceId} status={status} />}
        {sub === 'settings' && (
          <SettingsView
            instance={instance}
            status={status}
            reload={reload}
            onDeleted={() => closeTab(instanceId)}
          />
        )}
      </div>
    </div>
  )
}
