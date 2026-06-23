import type { ServerProvider } from './types'
import { getJson } from '../util/net'

const META = 'https://meta.fabricmc.net/v2'

interface GameVersion {
  version: string
  stable: boolean
}
interface LoaderVersion {
  version: string
  stable: boolean
}
interface InstallerVersion {
  version: string
  stable: boolean
}

export const fabric: ServerProvider = {
  id: 'fabric',
  async listGameVersions() {
    const games = await getJson<GameVersion[]>(`${META}/versions/game`)
    return games.filter((g) => g.stable).map((g) => g.version)
  },
  async listBuilds() {
    // For Fabric the "build" is the loader version.
    const loaders = await getJson<LoaderVersion[]>(`${META}/versions/loader`)
    return loaders.map((l) => ({
      id: l.version,
      label: `Loader ${l.version}`,
      channel: l.stable ? 'stable' : 'beta'
    }))
  },
  async resolveInstall(mc, loader) {
    const installers = await getJson<InstallerVersion[]>(`${META}/versions/installer`)
    const installer = (installers.find((i) => i.stable) ?? installers[0])?.version
    if (!installer) throw new Error('No Fabric installer available')
    // Fabric serves a ready-to-run server launcher jar.
    return {
      kind: 'jar',
      url: `${META}/versions/loader/${mc}/${loader}/${installer}/server/jar`,
      fileName: `fabric-server-${mc}-${loader}.jar`
    }
  }
}
