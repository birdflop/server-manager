import type { ContentSearchHit } from '@shared/types'
import { getJson } from './util/net'

const API = 'https://api.spiget.org/v2'

interface SpigetResource {
  id: number
  name: string
  tag: string
  downloads: number
  external?: boolean
  file?: { type?: string; url?: string }
  icon?: { url?: string }
}

function isExternal(r: SpigetResource): boolean {
  if (r.external === true) return true
  const t = r.file?.type ?? ''
  // Direct uploads have a ".jar"/".zip" type; anything else is an off-site link.
  return !(t.includes('jar') || t.includes('zip'))
}

/** Search SpigotMC resources via the Spiget API (best-effort). */
export async function searchSpiget(query: string): Promise<ContentSearchHit[]> {
  const url = `${API}/search/resources/${encodeURIComponent(
    query
  )}?size=20&sort=-downloads&fields=id,name,tag,downloads,external,file,icon`
  // Spiget returns 404 when there are no matches.
  const list = await getJson<SpigetResource[]>(url).catch(() => [] as SpigetResource[])
  return list.map((r) => ({
    source: 'spigot' as const,
    id: String(r.id),
    title: r.name,
    description: r.tag ?? '',
    iconUrl: r.icon?.url ? `https://www.spigotmc.org/${r.icon.url}` : undefined,
    downloads: r.downloads ?? 0,
    external: isExternal(r),
    pageUrl: `https://www.spigotmc.org/resources/${r.id}`
  }))
}

export async function resolveSpigetDownload(
  id: string
): Promise<{ url: string; filename: string }> {
  const r = await getJson<SpigetResource>(`${API}/resources/${id}?fields=id,name,external,file`)
  if (isExternal(r)) {
    throw new Error('This SpigotMC resource is hosted off-site — open its page to download.')
  }
  const slug =
    (r.name || `spigot-${id}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `spigot-${id}`
  return { url: `${API}/resources/${id}/download`, filename: `${slug}.jar` }
}
