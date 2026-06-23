import type { ServerProvider } from './types'
import { getJson } from '../util/net'

const BASE = 'https://fill.papermc.io/v3/projects/paper'

interface VersionsResp {
  versions: Record<string, string[]>
}
interface BuildResp {
  id: number
  channel: string
  downloads: Record<string, { name: string; url: string }>
}

export const paper: ServerProvider = {
  id: 'paper',
  async listGameVersions() {
    const data = await getJson<VersionsResp>(BASE)
    // versions is grouped by major (newest first), each array newest first.
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
    if (!build) throw new Error(`No Paper build found for ${mc}`)
    const dl = build.downloads['server:default']
    if (!dl) throw new Error(`No server download for Paper ${mc} build ${build.id}`)
    return { kind: 'jar', url: dl.url, fileName: dl.name }
  }
}
