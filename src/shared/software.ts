import type { ContentKind, ContentSource, ServerCategory, ServerType } from './types'

export interface ServerTypeInfo {
  id: ServerType
  label: string
  blurb: string
  /** Server software vs proxy — used to group the picker and tweak labels/config. */
  category: ServerCategory
  /** Whether this software loads plugins, mods, or neither. */
  contentKind: ContentKind
  /** Whether installation runs an installer jar (Forge family) vs a runnable server jar. */
  usesInstaller: boolean
}

export const SERVER_TYPES: ServerTypeInfo[] = [
  {
    id: 'paper',
    label: 'Paper',
    blurb: 'High-performance Spigot fork. Runs Bukkit/Spigot plugins.',
    category: 'server',
    contentKind: 'plugins',
    usesInstaller: false
  },
  {
    id: 'purpur',
    label: 'Purpur',
    blurb: 'Paper fork with extra gameplay & config options.',
    category: 'server',
    contentKind: 'plugins',
    usesInstaller: false
  },
  {
    id: 'fabric',
    label: 'Fabric',
    blurb: 'Lightweight, fast modding toolchain. Loads Fabric mods.',
    category: 'server',
    contentKind: 'mods',
    usesInstaller: false
  },
  {
    id: 'quilt',
    label: 'Quilt',
    blurb: 'Fabric-compatible mod loader with extra features.',
    category: 'server',
    contentKind: 'mods',
    usesInstaller: false
  },
  {
    id: 'forge',
    label: 'Forge',
    blurb: 'The long-standing modding platform. Loads Forge mods.',
    category: 'server',
    contentKind: 'mods',
    usesInstaller: true
  },
  {
    id: 'neoforge',
    label: 'NeoForge',
    blurb: 'Modern successor to Forge. Loads NeoForge mods.',
    category: 'server',
    contentKind: 'mods',
    usesInstaller: true
  },
  {
    id: 'vanilla',
    label: 'Vanilla',
    blurb: "Mojang's official, unmodified server.",
    category: 'server',
    contentKind: 'none',
    usesInstaller: false
  },
  {
    id: 'velocity',
    label: 'Velocity',
    blurb: 'Modern, high-performance proxy by PaperMC. Loads Velocity plugins.',
    category: 'proxy',
    contentKind: 'plugins',
    usesInstaller: false
  },
  {
    id: 'bungeecord',
    label: 'BungeeCord',
    blurb: 'The classic proxy by SpigotMC. Loads BungeeCord plugins.',
    category: 'proxy',
    contentKind: 'plugins',
    usesInstaller: false
  },
  {
    id: 'waterfall',
    label: 'Waterfall',
    blurb: 'BungeeCord fork by PaperMC (discontinued — prefer Velocity).',
    category: 'proxy',
    contentKind: 'plugins',
    usesInstaller: false
  }
]

export const SERVER_TYPE_MAP = Object.fromEntries(
  SERVER_TYPES.map((t) => [t.id, t])
) as Record<ServerType, ServerTypeInfo>

export function categoryOf(type: ServerType): ServerCategory {
  return SERVER_TYPE_MAP[type]?.category ?? 'server'
}

/** Whether a server type is a proxy (Velocity / BungeeCord / Waterfall). */
export function isProxy(type: ServerType): boolean {
  return categoryOf(type) === 'proxy'
}

/** Console command that gracefully stops this software (proxies use `end`, servers `stop`). */
export function stopCommandFor(type: ServerType): string {
  return isProxy(type) ? 'end' : 'stop'
}

/**
 * Pattern that signals the process is up and ready, matched against console output.
 * Velocity and Minecraft servers log "Done (…)"; BungeeCord/Waterfall log "Listening on …".
 */
export function readyPatternFor(type: ServerType): RegExp {
  if (type === 'bungeecord' || type === 'waterfall') return /Listening on /
  return /Done \(/
}

export function contentKindOf(type: ServerType): ContentKind {
  return SERVER_TYPE_MAP[type]?.contentKind ?? 'none'
}

/** The folder name where this server type stores its content. */
export function contentDirOf(type: ServerType): string {
  return contentKindOf(type) === 'plugins' ? 'plugins' : 'mods'
}

/** Which content sources are available for a server type. */
export function contentSourcesOf(type: ServerType): ContentSource[] {
  const kind = contentKindOf(type)
  // Hangar and SpigotMC are plugin-only; mods come from Modrinth.
  if (kind === 'plugins') return ['modrinth', 'hangar', 'spigot']
  if (kind === 'mods') return ['modrinth']
  return []
}

/** Modrinth loader facets compatible with each server type (for search + install). */
export const MODRINTH_LOADERS: Record<ServerType, string[]> = {
  paper: ['paper', 'spigot', 'bukkit', 'purpur', 'folia'],
  purpur: ['purpur', 'paper', 'spigot', 'bukkit'],
  fabric: ['fabric'],
  quilt: ['quilt', 'fabric'],
  forge: ['forge'],
  neoforge: ['neoforge'],
  vanilla: [],
  velocity: ['velocity'],
  bungeecord: ['bungeecord'],
  waterfall: ['waterfall', 'bungeecord']
}
