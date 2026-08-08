import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginLogger } from './api'

const MAX_LOG_BYTES = 1024 * 1024

/** Where a plugin's log lines land. */
export function pluginLogPath(id: string): string {
  return join(app.getPath('userData'), 'plugin-logs', `${id}.log`)
}

function write(id: string, level: 'info' | 'warn' | 'error', message: string): void {
  const path = pluginLogPath(id)
  try {
    mkdirSync(join(app.getPath('userData'), 'plugin-logs'), { recursive: true })
    // One rotation generation is enough for plugin logs.
    try {
      if (statSync(path).size > MAX_LOG_BYTES) renameSync(path, `${path}.old`)
    } catch {
      /* no log yet */
    }
    appendFileSync(path, `${new Date().toISOString()} [${level}] ${message}\n`, 'utf-8')
  } catch {
    /* logging must never take a plugin down */
  }
  if (!app.isPackaged) console[level === 'info' ? 'log' : level](`[plugin:${id}]`, message)
}

/** Logger handed to a plugin as ctx.log. */
export function createPluginLogger(id: string): PluginLogger {
  return {
    info: (message) => write(id, 'info', message),
    warn: (message) => write(id, 'warn', message),
    error: (message) => write(id, 'error', message)
  }
}
