import type { ServerProvider } from './types'
import { getJson } from '../util/net'

const MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'

interface Manifest {
  latest: { release: string; snapshot: string }
  versions: { id: string; type: string; url: string }[]
}
interface VersionMeta {
  downloads: { server?: { url: string } }
}

export const vanilla: ServerProvider = {
  id: 'vanilla',
  async listGameVersions() {
    const m = await getJson<Manifest>(MANIFEST)
    // Manifest is newest first; expose releases only.
    return m.versions.filter((v) => v.type === 'release').map((v) => v.id)
  },
  async listBuilds() {
    // Vanilla has no per-version builds.
    return [{ id: 'release', label: 'Official release' }]
  },
  async resolveInstall(mc) {
    const m = await getJson<Manifest>(MANIFEST)
    const entry = m.versions.find((v) => v.id === mc)
    if (!entry) throw new Error(`Unknown Minecraft version ${mc}`)
    const meta = await getJson<VersionMeta>(entry.url)
    if (!meta.downloads.server) {
      throw new Error(`Minecraft ${mc} has no downloadable server jar`)
    }
    return { kind: 'jar', url: meta.downloads.server.url, fileName: `minecraft_server.${mc}.jar` }
  }
}
