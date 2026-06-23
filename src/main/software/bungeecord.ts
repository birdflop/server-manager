import type { ServerProvider } from './types'
import { getJson } from '../util/net'

// BungeeCord is published as Jenkins CI artifacts rather than versioned releases.
const JOB = 'https://hub.spigotmc.org/jenkins/job/BungeeCord'

interface JenkinsJob {
  builds?: { number: number }[]
}

function artifactUrl(buildRef: string): string {
  return `${JOB}/${buildRef}/artifact/bootstrap/target/BungeeCord.jar`
}

export const bungeecord: ServerProvider = {
  id: 'bungeecord',
  async listGameVersions() {
    // BungeeCord isn't tied to a Minecraft version — surface recent CI build numbers
    // (newest first). If the Jenkins API is unreachable, fall back to "latest".
    try {
      const job = await getJson<JenkinsJob>(`${JOB}/api/json?tree=builds[number]{0,25}`)
      const nums = (job.builds ?? []).map((b) => String(b.number))
      if (nums.length > 0) return nums
    } catch {
      /* fall through */
    }
    return ['latest']
  },
  async listBuilds(version) {
    // No sub-builds per version; each version maps to a single downloadable jar.
    const label = version === 'latest' ? 'Latest build' : `Build #${version}`
    return [{ id: version, label }]
  },
  async resolveInstall(version) {
    const ref = version === 'latest' ? 'lastSuccessfulBuild' : version
    return { kind: 'jar', url: artifactUrl(ref), fileName: 'BungeeCord.jar' }
  }
}
