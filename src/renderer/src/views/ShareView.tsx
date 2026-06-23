import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  Loader2,
  Play,
  Square,
  Copy,
  Check,
  AlertTriangle,
  ExternalLink,
  KeyRound
} from 'lucide-react'
import type {
  Instance,
  ServerStatus,
  TunnelInfo,
  TunnelProviderId,
  TunnelProviderStatus,
  TunnelState
} from '@shared/types'
import { useApp } from '../store'

const STATE_COLOR: Record<TunnelState, string> = {
  offline: 'bg-fg-muted/40',
  starting: 'bg-amber-400 animate-pulse',
  online: 'bg-emerald-400',
  error: 'bg-red-400'
}
const STATE_LABEL: Record<TunnelState, string> = {
  offline: 'Offline',
  starting: 'Starting…',
  online: 'Online',
  error: 'Error'
}

const NGROK_TOKEN_URL = 'https://dashboard.ngrok.com/get-started/your-authtoken'

export function ShareView({
  instance,
  status
}: {
  instance: Instance
  status: ServerStatus
}): ReactElement {
  const config = useApp((s) => s.config)
  const updateConfig = useApp((s) => s.updateConfig)

  const [providers, setProviders] = useState<TunnelProviderStatus[]>([])
  const [provider, setProvider] = useState<TunnelProviderId>(instance.tunnel?.provider ?? 'bore')
  const [info, setInfo] = useState<TunnelInfo>({ provider: null, state: 'offline' })
  const [token, setToken] = useState(config?.ngrokAuthToken ?? '')
  const [savingToken, setSavingToken] = useState(false)
  const [copied, setCopied] = useState(false)

  const refreshProviders = useCallback(async () => {
    setProviders(await window.api.listTunnelProviders())
  }, [])

  useEffect(() => {
    void refreshProviders()
    void window.api.getTunnel(instance.id).then(setInfo)
    const off = window.api.onTunnelStatus((e) => {
      if (e.id !== instance.id) return
      setInfo({
        provider: e.provider,
        state: e.state,
        publicAddress: e.publicAddress,
        message: e.message
      })
    })
    return off
  }, [instance.id, refreshProviders])

  const selected = providers.find((p) => p.id === provider)
  const running = status === 'running'
  const active = info.state === 'online' || info.state === 'starting'
  const canStart = running && !!selected?.ready && !active

  async function saveToken(): Promise<void> {
    setSavingToken(true)
    try {
      await updateConfig({ ngrokAuthToken: token.trim() || null })
      await refreshProviders()
    } finally {
      setSavingToken(false)
    }
  }

  function copyAddress(): void {
    if (!info.publicAddress) return
    void window.api.copyText(info.publicAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="mx-auto h-full max-w-2xl space-y-6 overflow-y-auto p-6">
      {/* Public-exposure warning */}
      <div className="flex items-start gap-2 rounded-brand border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300/90">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <p>
          Sharing exposes this server to the public internet through a third-party relay. Use a
          whitelist or <span className="font-mono">online-mode</span>, and only share the address
          with people you trust.
        </p>
      </div>

      {/* Tunnel control */}
      <section className="rounded-brand border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">Share this server</h2>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Provider
            </span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as TunnelProviderId)}
              disabled={active}
              className="w-full rounded-md bg-input px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.ready ? '' : ' — unavailable'}
                </option>
              ))}
            </select>
            {selected?.message && (
              <p className="mt-1.5 text-xs text-fg-muted">{selected.message}</p>
            )}
          </label>

          {/* ngrok token setup */}
          {provider === 'ngrok' && (
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                <KeyRound size={12} /> ngrok auth token
              </span>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="2abc…"
                  className="min-w-0 flex-1 rounded-md bg-input px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  onClick={() => void saveToken()}
                  disabled={savingToken || token.trim() === (config?.ngrokAuthToken ?? '')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                >
                  {savingToken ? <Loader2 className="animate-spin" size={13} /> : 'Save'}
                </button>
              </div>
              <button
                onClick={() => void window.api.openExternal(NGROK_TOKEN_URL)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                Get a free token <ExternalLink size={11} />
              </button>
            </label>
          )}

          {/* Status + address */}
          <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATE_COLOR[info.state]}`}
              />
              <span className="text-sm">{STATE_LABEL[info.state]}</span>
              {info.state === 'online' && info.publicAddress && (
                <button
                  onClick={copyAddress}
                  title="Copy public address"
                  className="ml-1 inline-flex min-w-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-fg-muted transition hover:bg-surface hover:text-fg"
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  <span className="truncate">{info.publicAddress}</span>
                </button>
              )}
            </div>
            {active ? (
              <button
                onClick={() => void window.api.stopTunnel(instance.id)}
                className="inline-flex items-center gap-1.5 rounded-brand bg-red-500/90 px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110"
              >
                <Square size={14} /> Stop
              </button>
            ) : (
              <button
                onClick={() => void window.api.startTunnel(instance.id, provider)}
                disabled={!canStart}
                className="inline-flex items-center gap-1.5 rounded-brand bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
              >
                <Play size={15} /> Start tunnel
              </button>
            )}
          </div>

          {info.state === 'error' && info.message && (
            <p className="text-xs text-red-300">{info.message}</p>
          )}
          {info.state === 'starting' && info.message && (
            <p className="text-xs text-fg-muted">{info.message}</p>
          )}
          {!running && (
            <p className="text-xs text-fg-muted">Start the server first, then open a tunnel.</p>
          )}
        </div>
      </section>
    </div>
  )
}
