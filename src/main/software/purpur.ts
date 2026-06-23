import type { ServerProvider } from './types'
import { getJson } from '../util/net'

const BASE = 'https://api.purpurmc.org/v2/purpur'

interface RootResp {
  versions: string[]
}
interface BuildsResp {
  builds: { latest: string; all: string[] }
}

export const purpur: ServerProvider = {
  id: 'purpur',
  async listGameVersions() {
    const data = await getJson<RootResp>(BASE)
    // API lists versions oldest first.
    return [...data.versions].reverse()
  },
  async listBuilds(mc) {
    const data = await getJson<BuildsResp>(`${BASE}/${mc}`)
    return [...data.builds.all].reverse().map((b) => ({ id: b, label: `Build ${b}` }))
  },
  async resolveInstall(mc, buildId) {
    return {
      kind: 'jar',
      url: `${BASE}/${mc}/${buildId}/download`,
      fileName: `purpur-${mc}-${buildId}.jar`
    }
  }
}
