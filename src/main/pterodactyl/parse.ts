// Pure parsing/mapping helpers for the Pterodactyl integration — no Electron
// imports so they stay unit-testable (see __tests__/parse.test.ts).

import type {
  FileEntry,
  PteroBackup,
  PteroResources,
  PteroServer,
  PteroStatsEvent,
  ServerType
} from '@shared/types'

/**
 * Normalize user input ("panel.birdflop.com/", "https://panel.x.com/account")
 * to the panel origin the API lives under. Throws on unparseable input.
 */
export function normalizePanelUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Enter your panel URL')
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error(`"${input}" is not a valid URL`)
  }
  return url.origin
}

// ---- Response shapes (the slices of the panel API we consume) ----

export interface ServerAttributes {
  identifier: string
  name: string
  description: string
  node: string
  is_suspended: boolean
  limits: { memory: number; disk: number; cpu: number }
  relationships?: {
    allocations?: {
      data?: {
        attributes: { ip: string; ip_alias: string | null; port: number; is_default: boolean }
      }[]
    }
  }
}

export interface ResourcesAttributes {
  current_state: string
  resources: {
    memory_bytes: number
    cpu_absolute: number
    disk_bytes: number
    uptime: number
  }
}

export function mapServer(attrs: ServerAttributes): PteroServer {
  const allocations = attrs.relationships?.allocations?.data ?? []
  const primary = allocations.find((a) => a.attributes.is_default) ?? allocations[0]
  return {
    identifier: attrs.identifier,
    name: attrs.name,
    description: attrs.description ?? '',
    node: attrs.node,
    address: primary
      ? `${primary.attributes.ip_alias ?? primary.attributes.ip}:${primary.attributes.port}`
      : null,
    suspended: attrs.is_suspended,
    limits: {
      memoryMB: attrs.limits.memory,
      diskMB: attrs.limits.disk,
      cpuPct: attrs.limits.cpu
    }
  }
}

/** Wings state strings ("running", "offline", …) → our power-state union. */
export function mapPowerState(state: string): PteroResources['state'] {
  if (state === 'running' || state === 'starting' || state === 'stopping') return state
  return 'offline'
}

export function mapResources(attrs: ResourcesAttributes): PteroResources {
  return {
    state: mapPowerState(attrs.current_state),
    cpuPct: Math.round(attrs.resources.cpu_absolute * 10) / 10,
    memMB: Math.round(attrs.resources.memory_bytes / (1024 * 1024)),
    diskMB: Math.round(attrs.resources.disk_bytes / (1024 * 1024)),
    uptimeMs: attrs.resources.uptime
  }
}

export interface FileAttributes {
  name: string
  size: number
  is_file: boolean
  is_symlink: boolean
  mimetype: string
  modified_at: string
}

/** Map a panel file object into the FileEntry shape the file browser renders. */
export function mapFileEntry(dir: string, attrs: FileAttributes): FileEntry {
  const mtime = Date.parse(attrs.modified_at)
  return {
    name: attrs.name,
    path: dir ? `${dir}/${attrs.name}` : attrs.name,
    isDir: !attrs.is_file,
    size: attrs.size,
    mtimeMs: Number.isNaN(mtime) ? 0 : mtime
  }
}

/** Dirs first, then case-insensitive by name — same order as the local file browser. */
export function sortFileEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export interface BackupAttributes {
  uuid: string
  name: string
  bytes: number
  is_successful: boolean
  is_locked: boolean
  created_at: string
  completed_at: string | null
}

export function mapBackup(attrs: BackupAttributes): PteroBackup {
  const created = Date.parse(attrs.created_at)
  const completed = attrs.completed_at ? Date.parse(attrs.completed_at) : NaN
  return {
    uuid: attrs.uuid,
    name: attrs.name,
    size: attrs.bytes,
    successful: attrs.is_successful,
    locked: attrs.is_locked,
    createdAt: Number.isNaN(created) ? 0 : created,
    completedAt: Number.isNaN(completed) ? null : completed
  }
}

// ---- Clone helpers: guess local launch config from the remote startup command ----

export interface InvocationInfo {
  launchKind: 'jar' | 'args-file'
  launchJar?: string
  /** Extra JVM flags (memory flags stripped — the local launcher sets -Xmx from ramMB). */
  jvmArgs: string[]
}

/**
 * Parse a panel startup command ("java -Xms128M … -jar server.jar" or the
 * Forge/NeoForge "@…/unix_args.txt" form) into our launch config.
 */
export function parseInvocation(invocation: string): InvocationInfo {
  const tokens = invocation.trim().split(/\s+/)
  const jvmArgs: string[] = []
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '-jar') {
      const jar = tokens[i + 1]
      if (jar) return { launchKind: 'jar', launchJar: jar, jvmArgs }
      break
    }
    if (t.startsWith('@')) return { launchKind: 'args-file', jvmArgs }
    // Memory sizing is managed locally (ramMB), so drop the panel's flags for it.
    if (/^-Xm[sx]/i.test(t) || t.includes('RAMPercentage')) continue
    if (t.startsWith('-')) jvmArgs.push(t)
  }
  return { launchKind: 'args-file', jvmArgs }
}

/** "1.21.4"-or-"26.2"-style version numbers. */
const VERSION = /(\d+(?:\.\d+)+)/

const JAR_TYPE_PATTERNS: { test: RegExp; type: ServerType; version?: RegExp }[] = [
  { test: /^paper-/i, type: 'paper', version: /paper-(\d+(?:\.\d+)+)/i },
  { test: /^purpur-/i, type: 'purpur', version: /purpur-(\d+(?:\.\d+)+)/i },
  { test: /^folia-/i, type: 'folia', version: /folia-(\d+(?:\.\d+)+)/i },
  { test: /fabric/i, type: 'fabric', version: /mc\.(\d+(?:\.\d+)+)/i },
  { test: /quilt/i, type: 'quilt' },
  { test: /^neoforge/i, type: 'neoforge' },
  { test: /^forge-/i, type: 'forge', version: /forge-(\d+(?:\.\d+)+)-/i },
  { test: /^velocity/i, type: 'velocity', version: VERSION },
  { test: /^waterfall/i, type: 'waterfall', version: /waterfall-(\d+(?:\.\d+)+)/i },
  { test: /bungee/i, type: 'bungeecord' },
  { test: /^minecraft_server/i, type: 'vanilla', version: VERSION }
]

/** Best-effort server type + MC version from a jar filename ("" guesses when unsure). */
export function guessServerFromJar(jar: string): { serverType?: ServerType; mcVersion?: string } {
  for (const p of JAR_TYPE_PATTERNS) {
    if (p.test.test(jar)) {
      return { serverType: p.type, mcVersion: p.version ? jar.match(p.version)?.[1] : undefined }
    }
  }
  return {}
}

/** Wings pushes stats as a JSON string in args[0]; tolerate malformed frames. */
export function parseWingsStats(raw: string): Omit<PteroStatsEvent, 'serverId'> | null {
  try {
    const s = JSON.parse(raw) as {
      state?: string
      memory_bytes?: number
      cpu_absolute?: number
      disk_bytes?: number
      uptime?: number
    }
    return {
      state: mapPowerState(s.state ?? 'offline'),
      cpuPct: Math.round((s.cpu_absolute ?? 0) * 10) / 10,
      memMB: Math.round((s.memory_bytes ?? 0) / (1024 * 1024)),
      diskMB: Math.round((s.disk_bytes ?? 0) / (1024 * 1024)),
      uptimeMs: s.uptime ?? 0
    }
  } catch {
    return null
  }
}
