import type { ServerProvider } from './types'
import { getText } from '../util/net'

const METADATA = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'

/**
 * Map a NeoForge version to its Minecraft version. NeoForge encodes MC in its first
 * two parts. Two eras exist:
 *  - Legacy "1.x" Minecraft (NeoForge 20.x–24.x): "21.4.x" -> 1.21.4, "20.2.x" -> 1.20.2.
 *  - Calendar Minecraft (NeoForge >= 25, e.g. MC "26.2"): "26.2.x" -> 26.2.
 * Pre-NeoForge numbering (47.x for 1.20.1) is ignored.
 */
function neoToMc(v: string): string | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  const major = Number(m[1])
  const minor = m[2]
  if (major < 20) return null
  if (major >= 25) return minor === '0' ? `${major}` : `${major}.${minor}`
  return minor === '0' ? `1.${major}` : `1.${major}.${minor}`
}

function parseVersions(xml: string): string[] {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
}

export const neoforge: ServerProvider = {
  id: 'neoforge',
  async listGameVersions() {
    const versions = parseVersions(await getText(METADATA))
    const mcs: string[] = []
    for (const v of versions) {
      const mc = neoToMc(v)
      if (mc && !mcs.includes(mc)) mcs.push(mc)
    }
    return mcs.reverse()
  },
  async listBuilds(mc) {
    const versions = parseVersions(await getText(METADATA)).filter((v) => neoToMc(v) === mc)
    return versions.reverse().map((v) => ({ id: v, label: v }))
  },
  async resolveInstall(mc, full) {
    return {
      kind: 'installer',
      installer: 'neoforge',
      url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${full}/neoforge-${full}-installer.jar`,
      fileName: `neoforge-${full}-installer.jar`,
      meta: { mc, full }
    }
  }
}
