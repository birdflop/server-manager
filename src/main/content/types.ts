import type { ContentKind, ContentSearchHit } from '@shared/types'

/** Everything a source needs to pick a compatible file for an instance. */
export interface ContentResolveContext {
  /** Modrinth-style loader ids compatible with the instance's server type. */
  loaders: string[]
  mcVersion: string
}

/** A concrete download for one project, resolved for a (loaders, mcVersion) pair. */
export interface ResolvedContentDownload {
  url: string
  filename: string
  /** Source-specific id of the resolved version ('' when the source can't say). */
  versionId: string
  /** Human-readable version (e.g. "1.2.3"), when available. */
  versionNumber?: string
  /** Project ids this version requires — installed automatically alongside it. */
  requiredDeps?: string[]
}

/**
 * A place plugins/mods can be searched and installed from — mirrors the
 * software/tunnel `getProvider` pattern. Built-ins wrap the Modrinth, Hangar,
 * and Spiget API clients; app plugins can register additional sources.
 */
export interface ContentSourceProvider {
  /** Registry key, recorded as install provenance in .birdflop-content.json. */
  id: string
  /** Display name for the source picker (e.g. "Modrinth"). */
  label: string
  /** Which content kinds this source serves. */
  kinds: Exclude<ContentKind, 'none'>[]
  search(query: string, ctx: ContentResolveContext): Promise<ContentSearchHit[]>
  /** Resolve the latest compatible download for a project. Throws when none exists. */
  resolve(projectId: string, ctx: ContentResolveContext): Promise<ResolvedContentDownload>
}
