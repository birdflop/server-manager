import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import type { AppConfig } from '@shared/types'
import { getSecret, setSecret } from './secrets'

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
  pterodactylPanelUrl: null,
  birdflopTunnel: null,
  consoleMacros: [],
  templates: [],
  disabledPlugins: []
}

/**
 * On-disk shape. Secrets live in the encrypted secrets store (secrets.ts), never
 * here — the legacy fields below are only read once to migrate old installs.
 */
type PersistedConfig = AppConfig & { ngrokAuthTokenEnc?: string | null }

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

let cache: AppConfig | null = null

/** Read app config from userData, falling back to defaults. Cached after first read. */
export function getConfig(): AppConfig {
  if (cache) return cache
  let result: AppConfig
  let migratedLegacySecret = false
  try {
    const raw = readFileSync(configPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<PersistedConfig>
    result = { ...DEFAULT_CONFIG, ...parsed }
    // Legacy installs kept the ngrok token in config.json (plaintext, then
    // per-field encrypted). Move either form into the secrets store once.
    if (parsed.ngrokAuthToken) {
      setSecret('ngrok-auth-token', parsed.ngrokAuthToken)
      migratedLegacySecret = true
    } else if (parsed.ngrokAuthTokenEnc) {
      const token = decryptLegacy(parsed.ngrokAuthTokenEnc)
      if (token) setSecret('ngrok-auth-token', token)
      migratedLegacySecret = true
    }
  } catch {
    result = { ...DEFAULT_CONFIG }
  }
  result.ngrokAuthToken = getSecret('ngrok-auth-token')
  // Dev overrides: force root/theme without touching the user's real config.
  if (process.env.BSM_ROOT) result.rootPath = process.env.BSM_ROOT
  if (process.env.BSM_THEME === 'light' || process.env.BSM_THEME === 'dark') {
    result.theme = process.env.BSM_THEME
  }
  cache = result
  if (migratedLegacySecret) persist(result) // rewrite config.json without the token fields
  return result
}

/** Decrypt a token stored by the old per-field config encryption. */
function decryptLegacy(enc: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

/** Write the config to disk. Secret fields are stripped — they live in secrets.json. */
function persist(config: AppConfig): void {
  const out: PersistedConfig = { ...config, ngrokAuthToken: null }
  delete out.ngrokAuthTokenEnc
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath(), JSON.stringify(out, null, 2), 'utf-8')
}

/** Merge a partial config and persist it to userData. */
export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...getConfig(), ...patch }
  if ('ngrokAuthToken' in patch) {
    setSecret('ngrok-auth-token', patch.ngrokAuthToken ?? null)
    next.ngrokAuthToken = patch.ngrokAuthToken || null
  }
  cache = next
  persist(next)
  return next
}
