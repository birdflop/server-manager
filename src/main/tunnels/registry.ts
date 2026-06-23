import { BrowserWindow } from 'electron'
import type { TunnelInfo, TunnelProviderId } from '@shared/types'
import { getTunnelProvider } from './index'
import type { TunnelHandle } from './types'

interface RunningTunnel {
  handle: TunnelHandle | null
  info: TunnelInfo
}

const tunnels = new Map<string, RunningTunnel>()

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

/** Record + broadcast a tunnel's latest state for an instance. */
function emit(id: string, info: TunnelInfo): void {
  const entry = tunnels.get(id)
  if (entry) entry.info = info
  else tunnels.set(id, { handle: null, info })
  broadcast('tunnel:status', { id, ...info })
}

export function tunnelInfo(id: string): TunnelInfo {
  return tunnels.get(id)?.info ?? { provider: null, state: 'offline' }
}

/** Start (or restart) a tunnel for an instance on `port` using `providerId`. */
export async function startTunnel(
  id: string,
  providerId: TunnelProviderId,
  port: number
): Promise<void> {
  // Tear down any existing tunnel for this instance first.
  stopTunnel(id)

  const provider = getTunnelProvider(providerId)
  emit(id, { provider: providerId, state: 'starting' })
  try {
    const handle = await provider.start(port, (info) => emit(id, info))
    const entry = tunnels.get(id)
    if (entry) entry.handle = handle
    else tunnels.set(id, { handle, info: { provider: providerId, state: 'starting' } })
  } catch (err) {
    emit(id, { provider: providerId, state: 'error', message: (err as Error).message })
  }
}

/** Stop an instance's tunnel, if any. */
export function stopTunnel(id: string): void {
  const entry = tunnels.get(id)
  if (!entry) return
  try {
    entry.handle?.stop()
  } catch {
    /* ignore */
  }
  emit(id, { provider: entry.info.provider, state: 'offline' })
  tunnels.delete(id)
}

/** Stop every tunnel (used on app quit). */
export function stopAllTunnels(): void {
  for (const id of [...tunnels.keys()]) stopTunnel(id)
}
