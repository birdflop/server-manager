import type { ServerProvider } from './types'
import { getText } from '../util/net'

const METADATA = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'

function parseVersions(xml: string): string[] {
  // Forge versions look like "1.21.4-54.0.16" (mc-forge).
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
}

export const forge: ServerProvider = {
  id: 'forge',
  async listGameVersions() {
    const versions = parseVersions(await getText(METADATA))
    const mcs: string[] = []
    for (const v of versions) {
      const mc = v.split('-')[0]
      if (mc && !mcs.includes(mc)) mcs.push(mc)
    }
    // metadata is ascending; newest MC last.
    return mcs.reverse()
  },
  async listBuilds(mc) {
    const versions = parseVersions(await getText(METADATA)).filter((v) => v.split('-')[0] === mc)
    return versions.reverse().map((v) => ({ id: v, label: v.substring(mc.length + 1) }))
  },
  async resolveInstall(mc, full) {
    return {
      kind: 'installer',
      installer: 'forge',
      url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`,
      fileName: `forge-${full}-installer.jar`,
      meta: { mc, full }
    }
  }
}
