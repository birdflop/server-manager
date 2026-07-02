import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  Loader2,
  Play,
  Square,
  Copy,
  Check,
  AlertTriangle,
  ExternalLink,
  KeyRound,
  ShieldAlert,
  Users,
  Smartphone,
  Download
} from 'lucide-react'
import type {
  BedrockStatus,
  Instance,
  ServerStatus,
  ShareSafety,
  ShareSafetyFix,
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
  reconnecting: 'bg-amber-400 animate-pulse',
  error: 'bg-red-400'
}
const STATE_LABEL: Record<TunnelState, string> = {
  offline: 'Offline',
  starting: 'Starting…',
  online: 'Online',
  reconnecting: 'Reconnecting…',
  error: 'Error'
}

const NGROK_TOKEN_URL = 'https://dashboard.ngrok.com/get-started/your-authtoken'

/** "1.2 MB"-style formatting for the transferred-bytes stat. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n
  let unit = ''
  for (const u of units) {
    value /= 1024
    unit = u
    if (value < 1024) break
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`
}

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
  const [provider, setProvider] = useState<TunnelProviderId>(instance.tunnel?.provider ?? 'birdflop')
  const [info, setInfo] = useState<TunnelInfo>({ provider: null, state: 'offline' })
  const [token, setToken] = useState(config?.ngrokAuthToken ?? '')
  const [savingToken, setSavingToken] = useState(false)
  const [copied, setCopied] = useState(false)
  const [safety, setSafety] = useState<ShareSafety | null>(null)
  const [safetyFixed, setSafetyFixed] = useState(false)
  const [fixing, setFixing] = useState<ShareSafetyFix | null>(null)

  const [bedrock, setBedrock] = useState<BedrockStatus | null>(null)
  const [installingBedrock, setInstallingBedrock] = useState(false)
  const [bedrockJustInstalled, setBedrockJustInstalled] = useState(false)
  const [bedrockWarning, setBedrockWarning] = useState<string | null>(null)
  const [bedrockError, setBedrockError] = useState<string | null>(null)
  const [copiedBedrock, setCopiedBedrock] = useState(false)

  const refreshProviders = useCallback(async () => {
    setProviders(await window.api.listTunnelProviders())
  }, [])

  useEffect(() => {
    void refreshProviders()
    void window.api.getTunnel(instance.id).then(setInfo)
    setSafetyFixed(false)
    void window.api
      .getShareSafety(instance.id)
      .then(setSafety)
      .catch(() => setSafety(null))
    setBedrockJustInstalled(false)
    setBedrockWarning(null)
    setBedrockError(null)
    void window.api
      .getBedrockStatus(instance.id)
      .then(setBedrock)
      .catch(() => setBedrock(null))
    const off = window.api.onTunnelStatus((e) => {
      if (e.id !== instance.id) return
      setInfo({
        provider: e.provider,
        state: e.state,
        publicAddress: e.publicAddress,
        message: e.message,
        stats: e.stats
      })
    })
    return off
  }, [instance.id, refreshProviders])

  const selected = providers.find((p) => p.id === provider)
  const running = status === 'running'
  const active =
    info.state === 'online' || info.state === 'starting' || info.state === 'reconnecting'
  const canStart = running && !!selected?.ready && !active

  async function applySafetyFix(fix: ShareSafetyFix): Promise<void> {
    setFixing(fix)
    try {
      setSafety(await window.api.applyShareSafetyFix(instance.id, fix))
      setSafetyFixed(true)
    } finally {
      setFixing(null)
    }
  }

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

  async function enableBedrock(): Promise<void> {
    setInstallingBedrock(true)
    setBedrockError(null)
    setBedrockWarning(null)
    try {
      const result = await window.api.installBedrock(instance.id)
      setBedrock(result.status)
      setBedrockWarning(result.warning ?? null)
      setBedrockJustInstalled(true)
    } catch (e) {
      setBedrockError(e instanceof Error ? e.message : String(e))
    } finally {
      setInstallingBedrock(false)
    }
  }

  function copyBedrockAddress(): void {
    if (!bedrock?.lanAddress) return
    void window.api.copyText(bedrock.lanAddress)
    setCopiedBedrock(true)
    setTimeout(() => setCopiedBedrock(false), 1200)
  }

  return (
    <div className="mx-auto h-full max-w-2xl space-y-6 overflow-y-auto p-6">
      {/* Public-exposure warning: a concrete finding when the check flags the
          server, the generic caution otherwise. */}
      {safety?.checked && safety.risky ? (
        <div className="space-y-2 rounded-brand border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-300/90">
          <div className="flex items-start gap-2">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <p>
              This server has <span className="font-mono">online-mode=false</span> and no
              whitelist — once shared, anyone with the address can join, including bots using
              cracked clients. Enable at least one before sharing:
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-6">
            <button
              onClick={() => void applySafetyFix('online-mode')}
              disabled={fixing !== null}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-400/40 px-2.5 py-1 font-medium transition hover:bg-red-500/10 disabled:opacity-40"
            >
              {fixing === 'online-mode' && <Loader2 className="animate-spin" size={11} />}
              Enable online-mode
            </button>
            <button
              onClick={() => void applySafetyFix('whitelist')}
              disabled={fixing !== null}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-400/40 px-2.5 py-1 font-medium transition hover:bg-red-500/10 disabled:opacity-40"
            >
              {fixing === 'whitelist' && <Loader2 className="animate-spin" size={11} />}
              Enable whitelist
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded-brand border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300/90">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <p>
              Sharing exposes this server to the public internet through a third-party relay. Use
              a whitelist or <span className="font-mono">online-mode</span>, and only share the
              address with people you trust.
            </p>
          </div>
          {safetyFixed && (
            <p className="pl-6 text-amber-200/80">
              Fix applied{running ? ' — restart the server for it to take effect' : ''}.
            </p>
          )}
        </div>
      )}

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

          {/* Live traffic stats (Birdflop pushes them while the tunnel is up). */}
          {info.state === 'online' && info.stats && (
            <p className="flex items-center gap-1.5 text-xs text-fg-muted">
              <Users size={12} className="shrink-0" />
              {info.stats.activeConnections} online now · {info.stats.totalConnections} session
              {info.stats.totalConnections === 1 ? '' : 's'} · {formatBytes(info.stats.bytes)}{' '}
              transferred
            </p>
          )}

          {info.state === 'error' && info.message && (
            <p className="text-xs text-red-300">{info.message}</p>
          )}
          {(info.state === 'starting' || info.state === 'reconnecting') && info.message && (
            <p className="text-xs text-fg-muted">{info.message}</p>
          )}
          {!running && (
            <p className="text-xs text-fg-muted">Start the server first, then open a tunnel.</p>
          )}
        </div>
      </section>

      {/* Bedrock crossplay (Geyser) */}
      {bedrock?.supported && (
        <section className="rounded-brand border border-border bg-surface p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Smartphone size={15} /> Bedrock &amp; phones
            </h2>
            {!bedrock.installed && (
              <button
                onClick={() => void enableBedrock()}
                disabled={installingBedrock}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
              >
                {installingBedrock ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Download size={13} />
                )}
                Enable Bedrock support
              </button>
            )}
          </div>

          {bedrock.installed ? (
            <div className="space-y-2">
              <p className="text-xs text-fg-muted">
                GeyserMC is installed{bedrock.floodgate ? ' with Floodgate' : ''} — Minecraft
                Bedrock (phones, consoles, Windows edition) can join
                {bedrockJustInstalled ? ' after a restart' : ''}.
              </p>
              {bedrock.lanAddress && (
                <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-muted">
                  <span>
                    On the same Wi-Fi, join{' '}
                    <code className="rounded bg-input px-1 py-0.5 font-mono text-fg">
                      {bedrock.lanAddress}
                    </code>
                  </span>
                  <button
                    onClick={copyBedrockAddress}
                    className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 transition hover:bg-surface hover:text-fg"
                  >
                    {copiedBedrock ? <Check size={11} /> : <Copy size={11} />} Copy
                  </button>
                </div>
              )}
              <p className="text-[11px] text-fg-muted">
                Bedrock uses UDP port {bedrock.port}, so it works on your local network — TCP
                tunnels above can’t carry it.
                {!bedrock.floodgate &&
                  ' Without Floodgate, Bedrock players must link a Java account.'}
              </p>
            </div>
          ) : (
            <p className="text-xs text-fg-muted">
              Install GeyserMC{' '}
              {bedrock && ['paper', 'purpur', 'folia', 'velocity', 'bungeecord', 'waterfall'].includes(instance.serverType)
                ? '+ Floodgate '
                : ''}
              so phones and consoles can join this server for quick playtesting — one click, then
              restart.
            </p>
          )}
          {bedrockWarning && <p className="mt-2 text-xs text-amber-300">{bedrockWarning}</p>}
          {bedrockError && <p className="mt-2 text-xs text-red-300">{bedrockError}</p>}
        </section>
      )}
    </div>
  )
}
