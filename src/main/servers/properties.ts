import { join } from 'node:path'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

export function writeEula(dir: string, accepted: boolean): void {
  writeFileSync(join(dir, 'eula.txt'), `eula=${accepted ? 'true' : 'false'}\n`, 'utf-8')
}

/** Merge/set keys in server.properties, creating the file if it doesn't exist. */
export function setServerProperties(dir: string, kv: Record<string, string | number>): void {
  const path = join(dir, 'server.properties')
  const map = new Map<string, string>()
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq > 0) map.set(line.slice(0, eq), line.slice(eq + 1))
    }
  }
  for (const [k, v] of Object.entries(kv)) map.set(k, String(v))
  const out = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
  writeFileSync(path, out, 'utf-8')
}

export function readServerProperties(dir: string): Record<string, string> {
  const path = join(dir, 'server.properties')
  if (!existsSync(path)) return {}
  const map: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq > 0) map[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return map
}
