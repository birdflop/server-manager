import type { ContentKind, ContentSource, ServerType } from './types'

export interface ServerTypeInfo {
  id: ServerType
  label: string
  blurb: string
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
    contentKind: 'plugins',
    usesInstaller: false
  },
  {
    id: 'purpur',
    label: 'Purpur',
    blurb: 'Paper fork with extra gameplay & config options.',
    contentKind: 'plugins',
    usesInstaller: false
  },
  {
    id: 'fabric',
    label: 'Fabric',
    blurb: 'Lightweight, fast modding toolchain. Loads Fabric mods.',
    contentKind: 'mods',
    usesInstaller: false
  },
  {
    id: 'quilt',
    label: 'Quilt',
    blurb: 'Fabric-compatible mod loader with extra features.',
    contentKind: 'mods',
    usesInstaller: false
  },
  {
    id: 'forge',
    label: 'Forge',
    blurb: 'The long-standing modding platform. Loads Forge mods.',
    contentKind: 'mods',
    usesInstaller: true
  },
  {
    id: 'neoforge',
    label: 'NeoForge',
    blurb: 'Modern successor to Forge. Loads NeoForge mods.',
    contentKind: 'mods',
    usesInstaller: true
  },
  {
    id: 'vanilla',
    label: 'Vanilla',
    blurb: "Mojang's official, unmodified server.",
    contentKind: 'none',
    usesInstaller: false
  }
]

export const SERVER_TYPE_MAP = Object.fromEntries(
  SERVER_TYPES.map((t) => [t.id, t])
) as Record<ServerType, ServerTypeInfo>

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
  vanilla: []
}
