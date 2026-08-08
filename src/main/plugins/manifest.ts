import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginContributions, PluginIsolation } from '@shared/types'

/** Shape of a plugin folder's plugin.json. */
export interface PluginManifest {
  /** Stable identifier — lowercase slug, used in IPC channels and file paths. */
  id: string
  name: string
  version: string
  description?: string
  author?: string
  /** Entry file, relative to the plugin folder (CommonJS, exports activate()). */
  main: string
  /** Minimum app version, e.g. { "bsm": ">=0.9.0" }. */
  engines?: { bsm?: string }
  /** Permission ids the plugin needs (see PluginPermission in the SDK). */
  permissions?: string[]
  /** 'inline' (default) runs in the main process; 'process' in an isolated utility process. */
  isolation?: PluginIsolation
  /** Declarative UI contributions (console macros, …). */
  contributes?: PluginContributions
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Read + validate a plugin folder's plugin.json. Throws with a friendly message. */
export function readManifest(dir: string): PluginManifest {
  const path = join(dir, 'plugin.json')
  if (!existsSync(path)) throw new Error('plugin.json is missing')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    throw new Error('plugin.json is not valid JSON')
  }
  const m = raw as Partial<PluginManifest>
  if (!m.id || typeof m.id !== 'string' || !ID_RE.test(m.id)) {
    throw new Error('plugin.json needs an "id" (lowercase letters, digits, - or _)')
  }
  if (!m.name || typeof m.name !== 'string') throw new Error('plugin.json needs a "name"')
  if (!m.version || typeof m.version !== 'string') throw new Error('plugin.json needs a "version"')
  if (!m.main || typeof m.main !== 'string') throw new Error('plugin.json needs a "main" entry file')
  if (m.main.includes('..')) throw new Error('"main" must stay inside the plugin folder')
  if (!existsSync(join(dir, m.main))) throw new Error(`entry file "${m.main}" doesn't exist`)
  if (m.isolation && m.isolation !== 'inline' && m.isolation !== 'process') {
    throw new Error('"isolation" must be "inline" or "process"')
  }
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    description: typeof m.description === 'string' ? m.description : undefined,
    author: typeof m.author === 'string' ? m.author : undefined,
    main: m.main,
    engines: m.engines,
    permissions: Array.isArray(m.permissions) ? m.permissions.filter((p) => typeof p === 'string') : [],
    isolation: m.isolation ?? 'inline',
    contributes: m.contributes
  }
}

function parseVersion(v: string): [number, number, number] {
  const parts = v.replace(/^[^0-9]*/, '').split('.')
  return [Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0]
}

/**
 * Check an `engines.bsm` range against the running app version. Supports
 * ">=x.y.z" / "^x.y.z" (both treated as at-least) and exact "x.y.z".
 * Returns an error message, or null when satisfied (or no range declared).
 */
export function checkEngine(range: string | undefined, appVersion: string): string | null {
  if (!range) return null
  const want = parseVersion(range)
  const have = parseVersion(appVersion)
  const atLeast =
    have[0] !== want[0] ? have[0] > want[0] : have[1] !== want[1] ? have[1] > want[1] : have[2] >= want[2]
  const exact = range.trim().match(/^\d/) !== null
  const ok = exact ? have[0] === want[0] && have[1] === want[1] && have[2] === want[2] : atLeast
  return ok ? null : `needs app version ${range} (you have ${appVersion})`
}
