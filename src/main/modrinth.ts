import type { ContentSearchHit } from '@shared/types'
import { getJson } from './util/net'

const API = 'https://api.modrinth.com/v2'

interface SearchResp {
  hits: {
    project_id: string
    slug: string
    title: string
    description: string
    icon_url?: string
    downloads: number
    author: string
  }[]
}

interface MrDependency {
  project_id?: string
  version_id?: string
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

interface MrVersion {
  id: string
  version_number?: string
  date_published: string
  files: { url: string; filename: string; primary: boolean }[]
  dependencies?: MrDependency[]
}

/** A resolved Modrinth download plus the project ids of its required dependencies. */
export interface ModrinthDownload {
  url: string
  filename: string
  versionId: string
  versionNumber?: string
  /** Project ids of dependencies marked `required` for this version. */
  requiredDeps: string[]
}

export async function searchModrinth(query: string, loaders: string[]): Promise<ContentSearchHit[]> {
  // Facet by loader (OR within the group) so results match the server type.
  const facets = JSON.stringify([loaders.map((l) => `categories:${l}`)])
  const url = `${API}/search?limit=20&index=relevance&query=${encodeURIComponent(
    query
  )}&facets=${encodeURIComponent(facets)}`
  const data = await getJson<SearchResp>(url)
  return data.hits.map((h) => ({
    source: 'modrinth' as const,
    id: h.project_id,
    title: h.title,
    description: h.description,
    iconUrl: h.icon_url,
    downloads: h.downloads,
    author: h.author,
    pageUrl: `https://modrinth.com/project/${h.slug}`
  }))
}

/** Resolve the best downloadable file for a project given loader(s) + MC version. */
export async function resolveModrinthDownload(
  projectId: string,
  loaders: string[],
  mc: string
): Promise<ModrinthDownload> {
  const lf = encodeURIComponent(JSON.stringify(loaders))
  const gv = encodeURIComponent(JSON.stringify([mc]))

  const tries = [
    `${API}/project/${projectId}/version?loaders=${lf}&game_versions=${gv}`,
    `${API}/project/${projectId}/version?loaders=${lf}`,
    `${API}/project/${projectId}/version`
  ]
  let versions: MrVersion[] = []
  for (const url of tries) {
    versions = await getJson<MrVersion[]>(url)
    if (versions.length > 0) break
  }
  versions.sort((a, b) => b.date_published.localeCompare(a.date_published))
  const v = versions[0]
  if (!v) throw new Error('No compatible version found on Modrinth')
  const file = v.files.find((f) => f.primary) ?? v.files[0]
  if (!file) throw new Error('Version has no downloadable file')
  const requiredDeps = (v.dependencies ?? [])
    .filter((d) => d.dependency_type === 'required' && d.project_id)
    .map((d) => d.project_id as string)
  return {
    url: file.url,
    filename: file.filename,
    versionId: v.id,
    versionNumber: v.version_number,
    requiredDeps
  }
}
