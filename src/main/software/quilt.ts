import type { ServerProvider } from './types'
import { getJson } from '../util/net'

const META = 'https://meta.quiltmc.org/v3'

interface GameVersion {
  version: string
  stable: boolean
}
interface LoaderVersion {
  version: string
}
interface InstallerVersion {
  version: string
  url: string
}

export const quilt: ServerProvider = {
  id: 'quilt',
  async listGameVersions() {
    const games = await getJson<GameVersion[]>(`${META}/versions/game`)
    return games.filter((g) => g.stable).map((g) => g.version)
  },
  async listBuilds() {
    const loaders = await getJson<LoaderVersion[]>(`${META}/versions/loader`)
    return loaders.map((l) => ({ id: l.version, label: `Loader ${l.version}` }))
  },
  async resolveInstall(mc, loader) {
    // Quilt has no prebuilt server jar; we run the quilt-installer (see install.ts).
    const installers = await getJson<InstallerVersion[]>(`${META}/versions/installer`)
    const inst = installers[0]
    if (!inst) throw new Error('No Quilt installer available')
    return {
      kind: 'installer',
      installer: 'quilt',
      url: inst.url,
      fileName: `quilt-installer-${inst.version}.jar`,
      meta: { mc, loader }
    }
  }
}
