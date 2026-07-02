// Birdflop tunnel provider.
//
// All shared servers ride ONE `bftunnel local` process: each share is a route in
// a generated --config file, multiplexed over a single relay connection under the
// user's one identity. Adding/removing a share rewrites the config and restarts
// the process (the CLI registers routes once per connection). The process runs
// with --json, so state, live stats, and reconnect progress arrive as NDJSON
// events instead of scraped log lines — the binary itself reconnects with
// backoff, so a relay restart never kills the tunnel.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { TunnelInfo, TunnelProviderStatus, TunnelStats } from '@shared/types'
import { getJson } from '../util/net'
import { ensureManagedBinary } from './download'
import { diagnoseTunnelError, parseTunnelEvent, pickLatestCompatible } from './events'
import { loadBirdflopIdentity, saveBirdflopIdentity } from './identity'
import type { TunnelHandle, TunnelProvider } from './types'

// Minimum bftunnel release with --json/--config multiplexing; newer patch
// releases of the same minor are picked up automatically (see resolveVersion).
const PINNED_VERSION = 'v0.3.1'
// Public relay host. Override with BFTUNNEL_RELAY for local testing.
const RELAY = process.env.BFTUNNEL_RELAY || 'tunnel.birdflop.com'

/**
 * Rust target triple + archive extension for the current platform. Covers the
 * targets the release workflow builds: Windows x64, macOS x64/arm64, Linux
 * x64/arm64 (musl). Electron only ships 64-bit, so 32-bit triples are omitted.
 */
function assetUrl(version: string): { url: string; ext: 'zip' | 'tar.gz' } {
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
    url: `https://github.com/birdflop/tunnel/releases/download/${version}/bftunnel-${triple}.${ext}`,
    ext
  }
}

/** One server currently shared through the multiplexed process. */
interface Share {
  instanceId: string
  localPort: number
  publicPort: number
  label?: string
  onUpdate: (info: TunnelInfo) => void
  /** Public address once bound (matched to the route by config order). */
  address?: string
  /** Hostname part of the address, for pairing relay stats to this share. */
  hostname?: string
  stats?: TunnelStats
}

const shares = new Map<string, Share>()
/** Instance ids in routes-config order — `bound.addresses` comes back in it. */
let order: string[] = []
let child: ChildProcess | null = null
/** Whether the running child's exit is ours (restart/stop), not a crash. */
let expectedExit = false
/** Serializes restarts so add/remove bursts can't race each other. */
let syncing: Promise<void> = Promise.resolve()
let online = false

/** GitHub release check happens once per app run; falls back to the pin. */
let resolvedVersion: string | null = null
let cachedExe: string | null = null

async function resolveVersion(): Promise<string> {
  if (resolvedVersion) return resolvedVersion
  try {
    const releases = await Promise.race([
      getJson<Array<{ tag_name: string; prerelease: boolean; draft: boolean }>>(
        'https://api.github.com/repos/birdflop/tunnel/releases?per_page=20'
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('release check timed out')), 4000)
      )
    ])
    const tags = releases.filter((r) => !r.prerelease && !r.draft).map((r) => r.tag_name)
    resolvedVersion = pickLatestCompatible(tags, PINNED_VERSION)
  } catch {
    resolvedVersion = PINNED_VERSION
  }
  return resolvedVersion
}

async function resolveBinary(onMessage: (msg: string) => void): Promise<string> {
  // Allow a locally-built binary during development (cargo build → target/…/bftunnel).
  if (process.env.BFTUNNEL_BIN) return process.env.BFTUNNEL_BIN
  if (cachedExe) return cachedExe
  const version = await resolveVersion()
  cachedExe = await ensureManagedBinary(
    // Version the cache dir so a new release pulls a fresh binary instead of
    // reusing a stale one; `prunePrefix` deletes the previous version's dir.
    { name: `bftunnel-${version}`, exe: 'bftunnel', prunePrefix: 'bftunnel-', ...assetUrl(version) },
    onMessage
  )
  return cachedExe
}

/** Send the current state of one share to its listeners. */
function emit(share: Share, info: Partial<TunnelInfo> & { state: TunnelInfo['state'] }): void {
  share.onUpdate({
    provider: 'birdflop',
    publicAddress: share.address,
    stats: share.stats,
    ...info
  })
}

function emitAll(info: Partial<TunnelInfo> & { state: TunnelInfo['state'] }): void {
  for (const share of shares.values()) emit(share, info)
}

/** Path of the generated routes config consumed by `bftunnel local --config`. */
function routesConfigPath(): string {
  const dir = join(app.getPath('userData'), 'tunnels')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'bftunnel-routes.json')
}

function handleEvent(line: string): void {
  const event = parseTunnelEvent(line)
  if (!event) return
  switch (event.event) {
    // Newly issued identity — persist it so the address is stable next time.
    case 'identity_issued':
      saveBirdflopIdentity({ subdomain: event.subdomain, token: event.token })
      break

    // One address per route, in config order — pair them back to the shares.
    case 'bound':
      order.forEach((instanceId, i) => {
        const share = shares.get(instanceId)
        const address = event.addresses[i]
        if (!share || !address) return
        share.address = address
        share.hostname = address.split(':')[0]
      })
      break

    case 'connected':
      online = true
      emitAll({ state: 'online' })
      break

    case 'reconnecting':
      online = false
      emitAll({
        state: 'reconnecting',
        message: `Connection to the relay lost — reconnecting (attempt ${event.attempt})…`
      })
      break

    case 'stats':
      for (const stat of event.routes) {
        for (const share of shares.values()) {
          if (share.hostname === stat.hostname && share.publicPort === stat.port) {
            share.stats = {
              activeConnections: stat.active_connections,
              totalConnections: stat.total_connections,
              bytes: stat.bytes
            }
          }
        }
      }
      if (online) emitAll({ state: 'online' })
      break

    case 'error':
      if (event.fatal) {
        online = false
        emitAll({ state: 'error', message: diagnoseTunnelError(event.message) })
      }
      break
  }
}

function spawnShared(exe: string): void {
  const list = [...shares.values()]
  order = list.map((s) => s.instanceId)
  const config = {
    routes: list.map((s) => ({
      label: s.label || undefined,
      local_port: s.localPort,
      public_port: s.publicPort
    }))
  }
  const configPath = routesConfigPath()
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

  const args = ['local', '--to', RELAY, '--config', configPath, '--json']
  const identity = loadBirdflopIdentity()
  if (identity) args.push('--subdomain', identity.subdomain, '--token', identity.token)

  emitAll({ state: 'starting', message: `Connecting to ${RELAY}…` })
  online = false
  expectedExit = false
  const proc = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  child = proc

  let stdoutBuf = ''
  proc.stdout.on('data', (d: Buffer) => {
    stdoutBuf += d.toString()
    let nl: number
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl)
      stdoutBuf = stdoutBuf.slice(nl + 1)
      if (proc === child) handleEvent(line)
    }
  })
  // Stderr carries tracing logs; keep the tail for crash diagnosis.
  let lastStderr = ''
  proc.stderr.on('data', (d: Buffer) => {
    const text = d.toString().trim()
    if (text) lastStderr = text.split('\n').pop() ?? text
  })
  proc.on('error', (err) => {
    if (proc !== child) return
    emitAll({ state: 'error', message: diagnoseTunnelError(err.message) })
  })
  proc.on('close', (code) => {
    if (proc !== child || expectedExit) return
    // The binary only exits on fatal errors (it reconnects on its own), so an
    // unexpected exit without a fatal event is a crash worth surfacing.
    child = null
    if (shares.size > 0) {
      emitAll({
        state: 'error',
        message: diagnoseTunnelError(
          lastStderr || `bftunnel exited unexpectedly (code ${code ?? 'unknown'})`
        )
      })
    }
  })
}

/** Kill the current process (if any) and start one matching the share set. */
async function syncProcess(): Promise<void> {
  const run = async (): Promise<void> => {
    if (child) {
      expectedExit = true
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      child = null
    }
    if (shares.size === 0) return
    const exe = await resolveBinary((message) => emitAll({ state: 'starting', message }))
    spawnShared(exe)
  }
  syncing = syncing.then(run, run)
  return syncing
}

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
    const instanceId = opts?.instanceId ?? `port-${port}`
    shares.set(instanceId, {
      instanceId,
      localPort: port,
      publicPort: opts?.publicPort ?? port,
      label: opts?.label,
      onUpdate
    })
    onUpdate({ provider: 'birdflop', state: 'starting' })
    await syncProcess()

    return {
      stop(): void {
        shares.delete(instanceId)
        void syncProcess()
      }
    }
  }
}
