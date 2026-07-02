import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import type { AppConfig } from '@shared/types'

const DEFAULT_CONFIG: AppConfig = {
  rootPath: null,
  theme: 'dark',
  defaultRamMB: 2048,
  defaultJavaPath: null,
  autoUpdate: true,
  releaseChannel: 'stable',
  notifications: true,
  autoRestartOnCrash: false,
  minimizeToTray: false,
  ngrokAuthToken: null,
  birdflopTunnel: null,
  consoleMacros: [],
  templates: []
}

/** On-disk shape: secrets are stored OS-encrypted, not as plaintext fields. */
type PersistedConfig = AppConfig & { ngrokAuthTokenEnc?: string | null }

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** OS-keychain-encrypt a secret (base64), or null when unavailable (some Linux). */
function encryptSecret(secret: string): string | null {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(secret).toString('base64')
    }
  } catch {
    /* fall through to plaintext */
  }
  return null
}

function decryptSecret(enc: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

let cache: AppConfig | null = null

/** Read app config from userData, falling back to defaults. Cached after first read. */
export function getConfig(): AppConfig {
  if (cache) return cache
  let result: AppConfig
  let hadPlaintextSecret = false
  try {
    const raw = readFileSync(configPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<PersistedConfig>
    result = { ...DEFAULT_CONFIG, ...parsed }
    if (parsed.ngrokAuthTokenEnc) {
      result.ngrokAuthToken = decryptSecret(parsed.ngrokAuthTokenEnc)
    } else if (parsed.ngrokAuthToken) {
      // Legacy plaintext token — re-persist encrypted below.
      hadPlaintextSecret = true
    }
  } catch {
    result = { ...DEFAULT_CONFIG }
  }
  // Dev overrides: force root/theme without touching the user's real config.
  if (process.env.BSM_ROOT) result.rootPath = process.env.BSM_ROOT
  if (process.env.BSM_THEME === 'light' || process.env.BSM_THEME === 'dark') {
    result.theme = process.env.BSM_THEME
  }
  cache = result
  if (hadPlaintextSecret) persist(result)
  return result
}

/** Write the config to disk, encrypting secrets when the OS supports it. */
function persist(config: AppConfig): void {
  const out: PersistedConfig = { ...config, ngrokAuthTokenEnc: null }
  if (config.ngrokAuthToken) {
    const enc = encryptSecret(config.ngrokAuthToken)
    if (enc) {
      out.ngrokAuthTokenEnc = enc
      out.ngrokAuthToken = null // never store the plaintext next to the ciphertext
    }
  }
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath(), JSON.stringify(out, null, 2), 'utf-8')
}

/** Merge a partial config and persist it to userData. */
export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...getConfig(), ...patch }
  cache = next
  persist(next)
  return next
}
