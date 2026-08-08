import type { ContentKind } from '@shared/types'
import type { ContentSourceProvider } from './types'
import { searchModrinth, resolveModrinthDownload } from '../modrinth'
import { searchHangar, resolveHangarDownload } from '../hangar'
import { searchSpiget, resolveSpigetDownload } from '../spiget'

export type { ContentSourceProvider, ContentResolveContext, ResolvedContentDownload } from './types'

/**
 * Open registry of content sources, keyed by source id. Built-ins register
 * below; app plugins can add sources at activation.
 */
const providers = new Map<string, ContentSourceProvider>()

/** Register (or replace) a content source. */
export function registerContentSource(provider: ContentSourceProvider): void {
  providers.set(provider.id, provider)
}

/** Remove a registered content source (plugin deactivation). No-op for unknown ids. */
export function unregisterContentSource(id: string): void {
  providers.delete(id)
}

export function getContentSource(id: string): ContentSourceProvider {
  const provider = providers.get(id)
  if (!provider) throw new Error(`No content source "${id}"`)
  return provider
}

/** Sources able to serve a content kind, in registration order (built-ins first). */
export function contentSourcesForKind(kind: ContentKind): ContentSourceProvider[] {
  if (kind === 'none') return []
  return [...providers.values()].filter((p) => p.kinds.includes(kind))
}

registerContentSource({
  id: 'modrinth',
  label: 'Modrinth',
  kinds: ['plugins', 'mods'],
  search: (query, ctx) => searchModrinth(query, ctx.loaders),
  resolve: (projectId, ctx) => resolveModrinthDownload(projectId, ctx.loaders, ctx.mcVersion)
})

registerContentSource({
  id: 'hangar',
  label: 'Hangar',
  kinds: ['plugins'],
  search: (query) => searchHangar(query),
  resolve: (projectId) => resolveHangarDownload(projectId)
})

registerContentSource({
  id: 'spigot',
  label: 'SpigotMC',
  kinds: ['plugins'],
  search: (query) => searchSpiget(query),
  resolve: (projectId) => resolveSpigetDownload(projectId)
})
