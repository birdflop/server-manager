import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import type { AppConfig } from '@shared/types'

const DEFAULT_CONFIG: AppConfig = {
  rootPath: null,
  theme: 'dark',
  defaultRamMB: 2048,
  defaultJavaPath: null,
  autoUpdate: true,
  notifications: true,
  autoRestartOnCrash: false,
  minimizeToTray: false,
  ngrokAuthToken: null
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

let cache: AppConfig | null = null

/** Read app config from userData, falling back to defaults. Cached after first read. */
export function getConfig(): AppConfig {
  if (cache) return cache
  let result: AppConfig
  try {
    const raw = readFileSync(configPath(), 'utf-8')
    result = { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    result = { ...DEFAULT_CONFIG }
  }
  // Dev overrides: force root/theme without touching the user's real config.
  if (process.env.BSM_ROOT) result.rootPath = process.env.BSM_ROOT
  if (process.env.BSM_THEME === 'light' || process.env.BSM_THEME === 'dark') {
    result.theme = process.env.BSM_THEME
  }
  cache = result
  return result
}

/** Merge a partial config and persist it to userData. */
export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...getConfig(), ...patch }
  cache = next
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
