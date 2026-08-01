// Central store for every secret the app holds (API keys, auth tokens).
// Values live in userData/secrets.json, encrypted with the OS keychain via
// Electron's safeStorage. Nothing here is ever written into config.json, so
// the regular config stays safe to copy/share/inspect.

import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

/** Known secret slots. Add new secrets here so usage stays greppable. */
export type SecretKey = 'ngrok-auth-token' | 'pterodactyl-api-key'

/**
 * One stored secret: OS-encrypted when the platform supports it, plaintext
 * only as a last resort (some Linux setups have no keychain — matching the
 * previous config.json behavior rather than silently dropping the value).
 */
type StoredSecret = { enc: string } | { plain: string }

interface SecretsFile {
  version: 1
  secrets: Partial<Record<SecretKey, StoredSecret>>
}

function secretsPath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

let cache: SecretsFile | null = null

function load(): SecretsFile {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(secretsPath(), 'utf-8')) as SecretsFile
    cache = { version: 1, secrets: parsed.secrets ?? {} }
  } catch {
    cache = { version: 1, secrets: {} }
  }
  return cache
}

function persist(file: SecretsFile): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(secretsPath(), JSON.stringify(file, null, 2), 'utf-8')
  try {
    chmodSync(secretsPath(), 0o600)
  } catch {
    /* best effort (no-op on Windows) */
  }
}

/** Read + decrypt a secret, or null when unset (or undecryptable on this machine). */
export function getSecret(key: SecretKey): string | null {
  const stored = load().secrets[key]
  if (!stored) return null
  if ('plain' in stored) return stored.plain
  try {
    return safeStorage.decryptString(Buffer.from(stored.enc, 'base64'))
  } catch {
    return null
  }
}

/** Encrypt + persist a secret. Pass null to delete it. */
export function setSecret(key: SecretKey, value: string | null): void {
  const file = load()
  if (value === null || value === '') {
    delete file.secrets[key]
  } else {
    file.secrets[key] = encrypt(value)
  }
  persist(file)
}

function encrypt(value: string): StoredSecret {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { enc: safeStorage.encryptString(value).toString('base64') }
    }
  } catch {
    /* fall through to plaintext */
  }
  return { plain: value }
}
