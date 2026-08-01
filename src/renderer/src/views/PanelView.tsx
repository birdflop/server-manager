import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  Archive,
  Cloud,
  ExternalLink,
  FolderTree,
  HardDriveDownload,
  KeyRound,
  Loader2,
  LogOut,
  Play,
  RefreshCw,
  RotateCw,
  Send,
  Skull,
  Square,
  TerminalSquare,
  X
} from 'lucide-react'
import { PanelFilesView } from './PanelFilesView'
import { PanelBackupsView } from './PanelBackupsView'
import { ClonePanelServerModal } from '../modals/ClonePanelServerModal'
import type {
  PteroConnection,
  PteroPowerAction,
  PteroPowerState,
  PteroResources,
  PteroServer,
  ServerStatus
} from '@shared/types'
import { useApp } from '../store'
import { friendlyError } from '../errors'
import { StatusDot } from '../components/StatusDot'
import { TERM_THEMES } from './ConsoleView'

const DEFAULT_PANEL_URL = 'https://panel.birdflop.com'
/** How often to refresh resources for servers without an open console socket. */
const POLL_MS = 10_000

/** Map a remote power state onto the local StatusDot palette. */
function dotStatus(state: PteroPowerState | undefined): ServerStatus {
  return state === undefined || state === 'offline' ? 'stopped' : state
}

export default function PanelView(): ReactElement {
  const [conn, setConn] = useState<PteroConnection | null>(null)
  const [loading, setLoading] = useState(true)
  // Re-entering the key while still connected (e.g. after the panel revoked it).
  const [reauth, setReauth] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api
      .pteroStatus()
      .then((c) => {
        if (!cancelled) setConn(c)
      })
      .catch(() => {
        if (!cancelled) setConn({ connected: false, panelUrl: null, account: null })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        <Loader2 size={24} className="animate-spin" />
      </div>
    )
  }
  if (!conn?.connected || reauth) {
    return (
      <ConnectForm
        initialUrl={conn?.panelUrl ?? undefined}
        onConnected={(c) => {
          setConn(c)
          setReauth(false)
        }}
        onCancel={conn?.connected ? () => setReauth(false) : undefined}
      />
    )
  }
  return (
    <PanelServers
      conn={conn}
      onReauth={() => setReauth(true)}
      onDisconnected={() => setConn({ connected: false, panelUrl: null, account: null })}
    />
  )
}

/**
 * Panel URL + client API key entry, verified against the panel before saving.
 * Also reused to replace a revoked key — the old one is kept until the new one verifies.
 */
function ConnectForm({
  initialUrl,
  onConnected,
  onCancel
}: {
  initialUrl?: string
  onConnected: (c: PteroConnection) => void
  onCancel?: () => void
}): ReactElement {
  const [panelUrl, setPanelUrl] = useState(initialUrl ?? DEFAULT_PANEL_URL)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      onConnected(await window.api.pteroConnect(panelUrl, apiKey))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const keysUrl = `${panelUrl.replace(/\/+$/, '')}/account/api`

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md rounded-brand border border-border bg-surface p-6">
        <div className="mb-1 flex items-center gap-2 text-lg font-semibold">
          <Cloud size={20} className="text-accent" /> Connect a panel
        </div>
        <p className="mb-5 text-sm text-fg-muted">
          Control servers hosted on a Pterodactyl (or Pelican) panel — start, stop, and use the
          live console right from here. Your API key is stored encrypted on this machine.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void connect()
          }}
          className="space-y-4"
        >
          <label className="block">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Panel URL
            </div>
            <input
              value={panelUrl}
              onChange={(e) => setPanelUrl(e.target.value)}
              placeholder={DEFAULT_PANEL_URL}
              className="w-full rounded-brand bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Client API key
            </div>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              placeholder="ptlc_…"
              className="w-full rounded-brand bg-input px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => void window.api.openExternal(keysUrl)}
              className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <KeyRound size={12} /> Create one under Account → API Credentials
              <ExternalLink size={11} />
            </button>
          </label>
          {error && (
            <div className="rounded-brand border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-brand border border-border px-3 py-2 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={busy || !apiKey.trim() || !panelUrl.trim()}
              className="flex flex-1 items-center justify-center gap-2 rounded-brand bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />}
              {busy ? 'Verifying…' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Connected state: server list + selected server console. */
function PanelServers({
  conn,
  onReauth,
  onDisconnected
}: {
  conn: PteroConnection
  onReauth: () => void
  onDisconnected: () => void
}): ReactElement {
  const [servers, setServers] = useState<PteroServer[] | null>(null)
  const [resources, setResources] = useState<Record<string, PteroResources>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Whether the selected server's Files tab holds unsaved edits (guards navigation away).
  const filesDirtyRef = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.pteroListServers()
      setServers(list)
      setError(null)
      const results = await Promise.allSettled(
        list.map(async (s) => [s.identifier, await window.api.pteroResources(s.identifier)] as const)
      )
      setResources((prev) => {
        const next = { ...prev }
        for (const r of results) if (r.status === 'fulfilled') next[r.value[0]] = r.value[1]
        return next
      })
    } catch (err) {
      setError(friendlyError(err))
      setServers((prev) => prev ?? [])
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    // Live updates from any open console socket beat the poll.
    const unsubStats = window.api.onPteroStats((e) =>
      setResources((prev) => ({ ...prev, [e.serverId]: e }))
    )
    const unsubState = window.api.onPteroState((e) =>
      setResources((prev) => {
        const cur = prev[e.serverId]
        return { ...prev, [e.serverId]: { ...(cur ?? { cpuPct: 0, memMB: 0, diskMB: 0, uptimeMs: 0 }), state: e.state } }
      })
    )
    return () => {
      clearInterval(timer)
      unsubStats()
      unsubState()
    }
  }, [refresh])

  async function disconnect(): Promise<void> {
    if (!confirm('Disconnect from the panel? The saved API key will be removed.')) return
    await window.api.pteroDisconnect()
    onDisconnected()
  }

  /** Change the selected server, confirming first when unsaved remote edits would be lost. */
  function select(id: string | null): void {
    if (id === selectedId) return
    if (filesDirtyRef.current && !confirm('Discard unsaved changes to the open remote file?')) {
      return
    }
    filesDirtyRef.current = false
    setSelectedId(id)
  }

  const selected = servers?.find((s) => s.identifier === selectedId) ?? null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Cloud size={18} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-semibold">
            {conn.panelUrl?.replace(/^https?:\/\//, '')}
          </div>
          <div className="truncate text-xs text-fg-muted">
            {conn.account ? `${conn.account.username} · ${conn.account.email}` : 'Key not verified'}
          </div>
        </div>
        {!conn.account && (
          <button
            onClick={onReauth}
            title="The saved key could not be verified — enter a new one"
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300 transition hover:bg-amber-500/20"
          >
            <KeyRound size={13} /> Update key
          </button>
        )}
        <button
          onClick={() => void refresh()}
          title="Refresh servers"
          className="rounded-md border border-border p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <RefreshCw size={14} />
        </button>
        <button
          onClick={() => void disconnect()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <LogOut size={13} /> Disconnect
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-brand border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Server list */}
        <div className="w-72 shrink-0 space-y-1.5 overflow-y-auto border-r border-border p-3">
          {servers === null ? (
            <div className="flex justify-center py-8 text-fg-muted">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : servers.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-fg-muted">
              No servers on this account yet.
            </p>
          ) : (
            servers.map((s) => (
              <ServerCard
                key={s.identifier}
                server={s}
                res={resources[s.identifier]}
                active={s.identifier === selectedId}
                onSelect={() => select(s.identifier)}
              />
            ))
          )}
        </div>

        {/* Detail / console */}
        <div className="min-w-0 flex-1">
          {selected ? (
            <ServerDetail
              key={selected.identifier}
              server={selected}
              res={resources[selected.identifier]}
              onFilesDirtyChange={(dirty) => (filesDirtyRef.current = dirty)}
              onClose={() => select(null)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-muted">
              <TerminalSquare size={28} className="opacity-50" />
              <p className="text-sm">Select a server to open its console.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ServerCard({
  server,
  res,
  active,
  onSelect
}: {
  server: PteroServer
  res: PteroResources | undefined
  active: boolean
  onSelect: () => void
}): ReactElement {
  const state = res?.state
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-brand border p-3 text-left transition ${
        active ? 'border-accent/50 bg-accent/10' : 'border-border bg-surface hover:bg-surface-2'
      }`}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={dotStatus(state)} size={8} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{server.name}</span>
        {server.suspended && (
          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-400">
            Suspended
          </span>
        )}
      </div>
      <div className="mt-1 truncate text-xs text-fg-muted">
        {server.address ?? 'no address'} · {server.node}
      </div>
      {res && res.state !== 'offline' && (
        <div className="mt-1.5 flex gap-3 text-xs text-fg-muted">
          <span>CPU {res.cpuPct}%</span>
          <span>
            RAM {res.memMB}
            {server.limits.memoryMB ? `/${server.limits.memoryMB}` : ''} MB
          </span>
        </div>
      )}
    </button>
  )
}

type DetailTab = 'console' | 'files' | 'backups'

const DETAIL_TABS: { id: DetailTab; label: string; icon: typeof TerminalSquare }[] = [
  { id: 'console', label: 'Console', icon: TerminalSquare },
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'backups', label: 'Backups', icon: Archive }
]

/** Power controls, console, files, and backups for one remote server. */
function ServerDetail({
  server,
  res,
  onFilesDirtyChange,
  onClose
}: {
  server: PteroServer
  res: PteroResources | undefined
  onFilesDirtyChange: (dirty: boolean) => void
  onClose: () => void
}): ReactElement {
  const [busyAction, setBusyAction] = useState<PteroPowerAction | null>(null)
  const [powerError, setPowerError] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>('console')
  // Files mount on first visit, then stay mounted so unsaved edits survive tab switches.
  const [filesMounted, setFilesMounted] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)
  const state = res?.state ?? 'offline'

  async function power(action: PteroPowerAction): Promise<void> {
    if (action === 'kill' && !confirm(`Force-kill "${server.name}"? Unsaved data may be lost.`)) return
    setBusyAction(action)
    setPowerError(null)
    try {
      await window.api.pteroPower(server.identifier, action)
    } catch (err) {
      setPowerError(friendlyError(err))
    } finally {
      setBusyAction(null)
    }
  }

  const btn =
    'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40'

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <StatusDot status={dotStatus(state)} size={8} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{server.name}</span>
        <button onClick={() => void power('start')} disabled={busyAction !== null || state !== 'offline'} className={btn}>
          <Play size={13} /> Start
        </button>
        <button onClick={() => void power('restart')} disabled={busyAction !== null || state === 'offline'} className={btn}>
          <RotateCw size={13} /> Restart
        </button>
        <button onClick={() => void power('stop')} disabled={busyAction !== null || state === 'offline'} className={btn}>
          <Square size={13} /> Stop
        </button>
        <button
          onClick={() => void power('kill')}
          disabled={busyAction !== null || state === 'offline'}
          title="Force-kill the server process"
          className={`${btn} hover:text-red-400`}
        >
          <Skull size={13} /> Kill
        </button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <button
          onClick={() => setCloneOpen(true)}
          title="Copy this server 1:1 into a local test instance"
          className={btn}
        >
          <HardDriveDownload size={13} /> Clone locally
        </button>
        <button onClick={onClose} title="Close" className="rounded p-1 text-fg-muted transition hover:text-fg">
          <X size={15} />
        </button>
      </div>
      {cloneOpen && (
        <ClonePanelServerModal serverId={server.identifier} onClose={() => setCloneOpen(false)} />
      )}
      {powerError && (
        <div className="mx-4 mt-2 rounded-brand border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {powerError}
        </div>
      )}
      <div className="flex gap-1 border-b border-border px-4">
        {DETAIL_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => {
              setTab(id)
              if (id === 'files') setFilesMounted(true)
            }}
            className={`flex items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-sm transition ${
              tab === id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {/* The console stays mounted (hidden) so its websocket + scrollback survive tab switches. */}
        <div className={tab === 'console' ? 'h-full' : 'hidden'}>
          <RemoteConsole serverId={server.identifier} state={state} />
        </div>
        {/* Files stay mounted too, so unsaved editor changes survive tab switches. */}
        <div className={tab === 'files' ? 'h-full' : 'hidden'}>
          {filesMounted && (
            <PanelFilesView serverId={server.identifier} onDirtyChange={onFilesDirtyChange} />
          )}
        </div>
        {tab === 'backups' && <PanelBackupsView serverId={server.identifier} />}
      </div>
    </div>
  )
}

/** Live console streamed from the server's Wings websocket. */
function RemoteConsole({ serverId, state }: { serverId: string; state: PteroPowerState }): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const theme = useApp((s) => s.config?.theme ?? 'dark')
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [connectError, setConnectError] = useState<string | null>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
      fontSize: 12,
      convertEol: true,
      cursorBlink: false,
      scrollback: 5000,
      theme: TERM_THEMES[theme]
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current as HTMLDivElement)
    fit.fit()
    termRef.current = term

    term.attachCustomKeyEventHandler((e) => {
      if (
        e.type === 'keydown' &&
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'c' &&
        term.hasSelection()
      ) {
        void window.api.copyText(term.getSelection())
        return false
      }
      return true
    })

    const unsub = window.api.onPteroOutput((e) => {
      if (e.serverId === serverId) term.write(e.chunk)
    })
    void window.api
      .pteroOpenConsole(serverId)
      .then((buffer) => buffer && term.write(buffer))
      .catch((err) => setConnectError(friendlyError(err)))

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      unsub()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      void window.api.pteroCloseConsole(serverId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = TERM_THEMES[theme]
  }, [theme])

  function submit(): void {
    const text = cmd.trim()
    if (!text) return
    void window.api.pteroSendCommand(serverId, text).catch((err) => {
      termRef.current?.write(`\r\n\x1b[31m[command failed] ${friendlyError(err)}\x1b[0m\r\n`)
    })
    setHistory((h) => [...h, text])
    setHistIdx(-1)
    setCmd('')
  }

  const disabled = state === 'offline'

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      {connectError && (
        <div className="rounded-brand border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          Could not open the console: {connectError}
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-hidden rounded-brand border border-border p-2"
        style={{ backgroundColor: TERM_THEMES[theme].background }}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex items-center gap-2"
      >
        <input
          value={cmd}
          disabled={disabled}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && history.length) {
              e.preventDefault()
              const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1)
              setHistIdx(idx)
              setCmd(history[idx])
            } else if (e.key === 'ArrowDown' && histIdx >= 0) {
              e.preventDefault()
              const idx = histIdx + 1
              if (idx >= history.length) {
                setHistIdx(-1)
                setCmd('')
              } else {
                setHistIdx(idx)
                setCmd(history[idx])
              }
            }
          }}
          placeholder={disabled ? 'Server is offline' : 'Type a command (e.g. say hello)'}
          className="flex-1 rounded-brand bg-input px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-brand bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
        >
          <Send size={15} /> Send
        </button>
      </form>
    </div>
  )
}
