import { spawn } from 'node:child_process'
import type { TunnelProviderStatus } from '@shared/types'
import { ensureManagedBinary } from './download'
import type { TunnelHandle, TunnelProvider } from './types'

// Pinned bftunnel release tag from github.com/birdflop/tunnel.
const VERSION = 'v0.1.0'
// Public relay host. Override with BFTUNNEL_RELAY for local testing.
const RELAY = process.env.BFTUNNEL_RELAY || 'tunnel.birdflop.com'

/**
 * Rust target triple + archive extension for the current platform. Covers the
 * targets the release workflow builds: Windows x64, macOS x64/arm64, Linux
 * x64/arm64 (musl). Electron only ships 64-bit, so 32-bit triples are omitted.
 */
function assetUrl(): { url: string; ext: 'zip' | 'tar.gz' } {
  const arm64 = process.arch === 'arm64'
  let triple: string
  let ext: 'zip' | 'tar.gz'
  if (process.platform === 'win32') {
    triple = 'x86_64-pc-windows-msvc'
    ext = 'zip'
  } else if (process.platform === 'darwin') {
    triple = arm64 ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    ext = 'tar.gz'
  } else {
    triple = arm64 ? 'aarch64-unknown-linux-musl' : 'x86_64-unknown-linux-musl'
    ext = 'tar.gz'
  }
  return {
    url: `https://github.com/birdflop/tunnel/releases/download/${VERSION}/bftunnel-${triple}.${ext}`,
    ext
  }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g

export const birdflopProvider: TunnelProvider = {
  id: 'birdflop',
  label: 'Birdflop',

  async status(): Promise<TunnelProviderStatus> {
    // The relay enrolls users on first connect, so nothing is needed up front.
    return {
      id: 'birdflop',
      label: 'Birdflop',
      ready: true,
      message: 'Your own *.tunnel.birdflop.com address — no account needed.'
    }
  },

  async start(port, onUpdate, opts): Promise<TunnelHandle> {
    onUpdate({ provider: 'birdflop', state: 'starting' })

    // Allow a locally-built binary during development (cargo build → target/…/bftunnel).
    const exe = process.env.BFTUNNEL_BIN
      ? process.env.BFTUNNEL_BIN
      : await ensureManagedBinary(
          // Version the cache dir so a new release pulls a fresh binary instead of
          // reusing a stale one.
          { name: `bftunnel-${VERSION}`, exe: 'bftunnel', ...assetUrl() },
          (message) => onUpdate({ provider: 'birdflop', state: 'starting', message })
        )

    const publicPort = opts?.publicPort ?? port
    const args = ['local', String(port), '--to', RELAY, '--port', String(publicPort)]
    if (opts?.label) args.push('--label', opts.label)
    if (opts?.identity) {
      args.push('--subdomain', opts.identity.subdomain, '--token', opts.identity.token)
    }

    onUpdate({ provider: 'birdflop', state: 'starting', message: `Connecting to ${RELAY}…` })
    const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let online = false
    let lastLine = ''
    let buffer = ''
    const onData = (d: Buffer): void => {
      buffer += d.toString()
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim().replace(ANSI, '')
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        lastLine = line

        // Newly issued identity — persist it so the address is stable next time.
        const issued = line.match(/^BFTUNNEL_IDENTITY subdomain=(\S+) token=(\S+)/)
        if (issued) {
          opts?.onIdentity?.({ subdomain: issued[1], token: issued[2] })
          continue
        }

        // Public address (BFTUNNEL_ADDRESS, or the human-readable "listening at" line).
        const addr = line.match(/^BFTUNNEL_ADDRESS (\S+)/) ?? line.match(/listening at (\S+)/)
        if (addr) {
          online = true
          onUpdate({ provider: 'birdflop', state: 'online', publicAddress: addr[1] })
        }
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) =>
      onUpdate({ provider: 'birdflop', state: 'error', message: err.message })
    )
    child.on('close', (code) => {
      if (online) {
        onUpdate({ provider: 'birdflop', state: 'offline' })
      } else {
        onUpdate({
          provider: 'birdflop',
          state: 'error',
          message: lastLine || `bftunnel exited (code ${code ?? 'unknown'}) before connecting`
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
