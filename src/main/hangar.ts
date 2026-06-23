import type { ContentSearchHit } from '@shared/types'
import { getJson } from './util/net'

const API = 'https://hangar.papermc.io/api/v1'

interface HangarSearchResp {
  result: {
    namespace: { owner: string; slug: string }
    name: string
    description: string
    avatarUrl?: string
    stats?: { downloads?: number }
  }[]
}

interface HangarVersion {
  name: string
  downloads: Record<
    string,
    { fileInfo?: { name: string } | null; externalUrl?: string | null }
  >
}

/** Search Paper Hangar for plugins (PAPER platform). */
export async function searchHangar(query: string): Promise<ContentSearchHit[]> {
  const url = `${API}/projects?limit=20&offset=0&platform=PAPER&query=${encodeURIComponent(query)}`
  const data = await getJson<HangarSearchResp>(url)
  return data.result.map((p) => ({
    source: 'hangar' as const,
    id: `${p.namespace.owner}/${p.namespace.slug}`,
    title: p.name,
    description: p.description ?? '',
    iconUrl: p.avatarUrl,
    downloads: p.stats?.downloads ?? 0,
    author: p.namespace.owner,
    pageUrl: `https://hangar.papermc.io/${p.namespace.owner}/${p.namespace.slug}`
  }))
}

/** Resolve the latest PAPER download for a Hangar project ("owner/slug"). */
export async function resolveHangarDownload(
  projectId: string
): Promise<{ url: string; filename: string }> {
  const [owner, slug] = projectId.split('/')
  const versions = await getJson<{ result: HangarVersion[] }>(
    `${API}/projects/${owner}/${slug}/versions?limit=1&offset=0&platform=PAPER`
  )
  const version = versions.result[0]
  if (!version) throw new Error('No Paper version available on Hangar')
  const dl = version.downloads['PAPER'] ?? Object.values(version.downloads)[0]
  if (!dl) throw new Error('No download for this Hangar version')

  if (dl.fileInfo?.name) {
    // Internal download served by Hangar.
    return {
      url: `${API}/projects/${owner}/${slug}/versions/${encodeURIComponent(version.name)}/PAPER/download`,
      filename: dl.fileInfo.name
    }
  }
  if (dl.externalUrl) {
    const last = dl.externalUrl.split('?')[0].split('/').pop() || ''
    const filename = last.endsWith('.jar') ? last : `${slug}-${version.name}.jar`
    return { url: dl.externalUrl, filename }
  }
  throw new Error('Hangar version has no downloadable file')
}
