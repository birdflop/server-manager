import { spawn } from 'node:child_process'
import type { TunnelProviderStatus } from '@shared/types'
import { ensureManagedBinary } from './download'
import type { TunnelHandle, TunnelProvider } from './types'

// Pinned bore release. bore.pub is the project's free public relay (no account needed).
const VERSION = 'v0.6.0'
const RELAY = 'bore.pub'

/** Rust target triple + archive extension for the current platform. */
function assetUrl(): { url: string; ext: 'zip' | 'tar.gz' } {
  const a = process.arch
  let triple: string
  let ext: 'zip' | 'tar.gz'
  if (process.platform === 'win32') {
    triple = a === 'ia32' ? 'i686-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
    ext = 'zip'
  } else if (process.platform === 'darwin') {
    triple = a === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    ext = 'tar.gz'
  } else {
    triple =
      a === 'arm64'
        ? 'aarch64-unknown-linux-musl'
        : a === 'arm'
          ? 'armv7-unknown-linux-musleabihf'
          : 'x86_64-unknown-linux-musl'
    ext = 'tar.gz'
  }
  return {
    url: `https://github.com/ekzhang/bore/releases/download/${VERSION}/bore-${VERSION}-${triple}.${ext}`,
    ext
  }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g

/** Parse the public address out of a bore log line (e.g. "listening at bore.pub:65147"). */
function readAddress(line: string): string | null {
  const m = line.replace(ANSI, '').match(/listening at (\S+)/)
  return m ? m[1] : null
}

export const boreProvider: TunnelProvider = {
  id: 'bore',
  label: 'bore.pub',

  async status(): Promise<TunnelProviderStatus> {
    // bore.pub needs no account or token, so it's always ready.
    return {
      id: 'bore',
      label: 'bore.pub',
      ready: true,
      message: 'Free public relay — no account needed.'
    }
  },

  async start(port, onUpdate): Promise<TunnelHandle> {
    onUpdate({ provider: 'bore', state: 'starting' })
    const { url, ext } = assetUrl()
    const exe = await ensureManagedBinary({ name: 'bore', exe: 'bore', url, ext }, (message) =>
      onUpdate({ provider: 'bore', state: 'starting', message })
    )

    onUpdate({ provider: 'bore', state: 'starting', message: `Connecting to ${RELAY}…` })
    const child = spawn(exe, ['local', String(port), '--to', RELAY], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let online = false
    let lastLine = ''
    let buffer = ''
    const onData = (d: Buffer): void => {
      buffer += d.toString()
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        lastLine = line.replace(ANSI, '')
        const address = readAddress(line)
        if (address) {
          online = true
          onUpdate({ provider: 'bore', state: 'online', publicAddress: address })
        }
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => onUpdate({ provider: 'bore', state: 'error', message: err.message }))
    child.on('close', (code) => {
      if (online) {
        onUpdate({ provider: 'bore', state: 'offline' })
      } else {
        onUpdate({
          provider: 'bore',
          state: 'error',
          message: lastLine || `bore exited (code ${code ?? 'unknown'}) before connecting`
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
