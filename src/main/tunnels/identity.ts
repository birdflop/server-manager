// The user's Birdflop tunnel identity lives in ~/.birdflop/identity.json so the
// bftunnel CLI and other tools share the same stable subdomain as the app. The
// app config used to hold it; a legacy value is migrated out on first read.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { BirdflopTunnelIdentity } from '@shared/types'
import { getConfig, setConfig } from '../config'

function identityDir(): string {
  return join(homedir(), '.birdflop')
}

function identityPath(): string {
  return join(identityDir(), 'identity.json')
}

/** The saved identity, preferring the shared file over the legacy config slot. */
export function loadBirdflopIdentity(): BirdflopTunnelIdentity | null {
  try {
    const raw = JSON.parse(readFileSync(identityPath(), 'utf-8')) as {
      subdomain?: unknown
      token?: unknown
    }
    if (typeof raw.subdomain === 'string' && typeof raw.token === 'string') {
      return { subdomain: raw.subdomain, token: raw.token }
    }
  } catch {
    /* no shared file yet — fall through to the legacy config slot */
  }
  const legacy = getConfig().birdflopTunnel
  if (legacy) saveBirdflopIdentity(legacy)
  return legacy
}

/** Persist the identity to the shared file (owner-only on POSIX). */
export function saveBirdflopIdentity(identity: BirdflopTunnelIdentity): void {
  mkdirSync(identityDir(), { recursive: true })
  writeFileSync(identityPath(), JSON.stringify(identity, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600
  })
  try {
    chmodSync(identityPath(), 0o600)
  } catch {
    /* best effort (no-op on Windows) */
  }
  // The shared file is now canonical; drop the copy from the app config.
  if (getConfig().birdflopTunnel) setConfig({ birdflopTunnel: null })
}
