import { spawn } from 'node:child_process'
import type { TunnelProviderStatus } from '@shared/types'
import { getConfig } from '../config'
import { ensureManagedBinary } from './download'
import type { TunnelHandle, TunnelProvider } from './types'

const EQUINOX = 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-'

/** The platform-specific ngrok download URL. ngrok ships .zip on win/mac, .tgz on linux. */
function assetUrl(): { url: string; ext: 'zip' | 'tar.gz' } {
  const a = process.arch
  if (process.platform === 'win32') {
    return { url: `${EQUINOX}windows-${a === 'ia32' ? '386' : 'amd64'}.zip`, ext: 'zip' }
  }
  if (process.platform === 'darwin') {
    return { url: `${EQUINOX}darwin-${a === 'arm64' ? 'arm64' : 'amd64'}.zip`, ext: 'zip' }
  }
  const arch = a === 'arm64' ? 'arm64' : a === 'arm' ? 'arm' : 'amd64'
  // ngrok's linux archive is a .tgz, which `tar -xf` handles the same as .tar.gz.
  return { url: `${EQUINOX}linux-${arch}.tgz`, ext: 'tar.gz' }
}

/** Download + extract the ngrok binary if it isn't already present. */
function ensureBinary(onMessage: (msg: string) => void): Promise<string> {
  const { url, ext } = assetUrl()
  return ensureManagedBinary({ name: 'ngrok', exe: 'ngrok', url, ext }, onMessage)
}

/**
 * Condense ngrok's (often multi-line) error text into one line for display, keeping the
 * human reason + any ERR_NGROK_NNN code and dropping the echoed-back token / instructions.
 */
function cleanError(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const reason = lines[0] ?? 'ngrok error'
  const code = lines.find((l) => /^ERR_NGROK_\d+/.test(l))
  return code ? `${reason} (${code})` : reason
}

/** Pull the public address or a failure reason out of an ngrok JSON log line, if present. */
function readEvent(line: string): { address?: string; error?: string } | null {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof obj.url === 'string' && obj.msg === 'started tunnel') {
    return { address: obj.url.replace(/^tcp:\/\//, '') }
  }
  const lvl = obj.lvl
  if (lvl === 'eror' || lvl === 'crit') {
    return { error: cleanError(String(obj.err || obj.msg || 'ngrok error')) }
  }
  return null
}

export const ngrokProvider: TunnelProvider = {
  id: 'ngrok',
  label: 'ngrok',

  async status(): Promise<TunnelProviderStatus> {
    const token = getConfig().ngrokAuthToken
    if (!token) {
      return {
        id: 'ngrok',
        label: 'ngrok',
        ready: false,
        needs: 'auth',
        message: 'Add a free ngrok auth token to use ngrok tunnels.'
      }
    }
    return { id: 'ngrok', label: 'ngrok', ready: true }
  },

  async start(port, onUpdate): Promise<TunnelHandle> {
    const token = getConfig().ngrokAuthToken
    if (!token) throw new Error('No ngrok auth token configured')

    onUpdate({ provider: 'ngrok', state: 'starting' })
    const exe = await ensureBinary((message) =>
      onUpdate({ provider: 'ngrok', state: 'starting', message })
    )

    onUpdate({ provider: 'ngrok', state: 'starting', message: 'Connecting to ngrok…' })
    const child = spawn(
      exe,
      ['tcp', String(port), '--authtoken', token, '--log', 'stdout', '--log-format', 'json'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    let online = false
    let reportedError = false
    let buffer = ''
    const onData = (d: Buffer): void => {
      buffer += d.toString()
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        const ev = readEvent(line)
        if (ev?.address) {
          online = true
          onUpdate({ provider: 'ngrok', state: 'online', publicAddress: ev.address })
        } else if (ev?.error && !online && !reportedError) {
          // Surface the first real failure (e.g. bad token) — don't spam duplicates.
          reportedError = true
          onUpdate({ provider: 'ngrok', state: 'error', message: ev.error })
        }
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => {
      reportedError = true
      onUpdate({ provider: 'ngrok', state: 'error', message: err.message })
    })
    child.on('close', (code) => {
      if (online) {
        onUpdate({ provider: 'ngrok', state: 'offline' })
      } else if (!reportedError) {
        // Only fall back to a generic message if ngrok gave us nothing more specific.
        onUpdate({
          provider: 'ngrok',
          state: 'error',
          message: `ngrok exited (code ${code ?? 'unknown'}) before connecting`
        })
      }
    })

    return {
      stop(): void {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
      }
    }
  }
}
