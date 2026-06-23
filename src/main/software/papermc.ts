import type { ServerType } from '@shared/types'
import type { ServerProvider } from './types'
import { getJson } from '../util/net'

const FILL = 'https://fill.papermc.io/v3/projects'

interface VersionsResp {
  versions: Record<string, string[]>
}
interface BuildResp {
  id: number
  channel: string
  downloads: Record<string, { name: string; url: string }>
}

/**
 * Build a provider for any PaperMC "fill" v3 project (paper, velocity, waterfall).
 * They share an identical API shape: a versions map and per-version builds whose
 * runnable jar lives under the `server:default` download key.
 */
export function makePaperMcProvider(id: ServerType, project: string): ServerProvider {
  const BASE = `${FILL}/${project}`
  return {
    id,
    async listGameVersions() {
      const data = await getJson<VersionsResp>(BASE)
      // Grouped by major (newest first), each array newest first.
      return Object.values(data.versions).flat()
    },
    async listBuilds(mc) {
      const builds = await getJson<BuildResp[]>(`${BASE}/versions/${mc}/builds`)
      return builds
        .map((b) => ({ id: String(b.id), label: `Build ${b.id}`, channel: b.channel.toLowerCase() }))
        .sort((a, b) => Number(b.id) - Number(a.id))
    },
    async resolveInstall(mc, buildId) {
      const builds = await getJson<BuildResp[]>(`${BASE}/versions/${mc}/builds`)
      const build = builds.find((b) => String(b.id) === String(buildId)) ?? builds[0]
      if (!build) throw new Error(`No ${project} build found for ${mc}`)
      const dl = build.downloads['server:default']
      if (!dl) throw new Error(`No server download for ${project} ${mc} build ${build.id}`)
      return { kind: 'jar', url: dl.url, fileName: dl.name }
    }
  }
}
