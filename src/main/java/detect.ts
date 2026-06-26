import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { JavaInstall } from '@shared/types'

const execFileAsync = promisify(execFile)

/** Path to the java executable inside a JDK/JRE home for the current platform. */
function javaExe(home: string): string {
  return process.platform === 'win32' ? join(home, 'bin', 'java.exe') : join(home, 'bin', 'java')
}

/** Directory where the app stores auto-downloaded Java runtimes. */
export function runtimesDir(): string {
  return join(app.getPath('userData'), 'runtimes')
}

function parseVersion(output: string): { version: string; major: number } | null {
  const m = output.match(/version "([^"]+)"/)
  if (!m) return null
  const v = m[1]
  let major: number
  if (v.startsWith('1.')) major = parseInt(v.split('.')[1], 10) // 1.8.0_x -> 8
  else major = parseInt(v.split('.')[0], 10) // 17.0.x -> 17
  if (!Number.isFinite(major)) return null
  return { version: v, major }
}

/** Run `java -version` (writes to stderr) and parse the result. Resolves null on any failure. */
async function probe(javaPath: string): Promise<JavaInstall | null> {
  try {
    const { stdout, stderr } = await execFileAsync(javaPath, ['-version'], {
      encoding: 'utf8',
      timeout: 5000
    })
    const parsed = parseVersion((stderr || '') + (stdout || ''))
    if (!parsed) return null
    return { path: javaPath, version: parsed.version, major: parsed.major }
  } catch {
    return null
  }
}

/** Candidate JDK/JRE home directories per platform. */
function candidateHomes(): string[] {
  const homes = new Set<string>()
  const add = (p?: string): void => {
    if (p) homes.add(p)
  }

  add(process.env.JAVA_HOME)

  const scanParent = (parent: string): void => {
    try {
      if (!existsSync(parent)) return
      for (const entry of readdirSync(parent)) {
        const full = join(parent, entry)
        try {
          if (statSync(full).isDirectory()) homes.add(full)
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const local = process.env['LOCALAPPDATA'] || ''
    for (const base of [pf, pf86]) {
      scanParent(join(base, 'Java'))
      scanParent(join(base, 'Eclipse Adoptium'))
      scanParent(join(base, 'Microsoft'))
      scanParent(join(base, 'Zulu'))
      scanParent(join(base, 'Amazon Corretto'))
      scanParent(join(base, 'BellSoft'))
    }
    if (local) scanParent(join(local, 'Programs', 'Eclipse Adoptium'))
  } else if (process.platform === 'darwin') {
    const jvm = '/Library/Java/JavaVirtualMachines'
    try {
      if (existsSync(jvm)) {
        for (const entry of readdirSync(jvm)) homes.add(join(jvm, entry, 'Contents', 'Home'))
      }
    } catch {
      /* ignore */
    }
    scanParent('/opt/homebrew/opt')
    scanParent('/usr/local/opt')
  } else {
    scanParent('/usr/lib/jvm')
    scanParent('/usr/java')
    scanParent('/opt/java')
    scanParent('/opt')
  }

  // Managed runtimes (downloaded by the app); homes can be one or two levels deep.
  const rt = runtimesDir()
  scanParent(rt)
  try {
    for (const major of existsSync(rt) ? readdirSync(rt) : []) {
      scanParent(join(rt, major))
      // macOS Adoptium layout: <dir>/Contents/Home
      homes.add(join(rt, major, 'Contents', 'Home'))
    }
  } catch {
    /* ignore */
  }

  return [...homes]
}

/**
 * Detect Java runtimes on the machine plus any managed downloads.
 * Returns installs sorted newest major first, de-duplicated by real path.
 *
 * Each `java -version` boots a JVM (~100-500ms), so candidates are probed
 * concurrently and off the main thread to avoid blocking the UI.
 */
export async function detectJava(): Promise<JavaInstall[]> {
  const rt = runtimesDir()

  // Resolve candidate executables to real paths and de-dupe before probing.
  const seen = new Set<string>()
  const targets: string[] = []
  for (const home of candidateHomes()) {
    const javaPath = javaExe(home)
    if (!existsSync(javaPath)) continue
    let real = javaPath
    try {
      real = realpathSync(javaPath)
    } catch {
      /* keep original */
    }
    if (seen.has(real)) continue
    seen.add(real)
    targets.push(real)
  }

  // Probe every candidate plus whatever `java` is on PATH, all in parallel.
  const [onPath, ...installs] = await Promise.all([probe('java'), ...targets.map(probe)])

  const found = new Map<string, JavaInstall>()
  targets.forEach((real, i) => {
    const install = installs[i]
    if (install) {
      install.managed = real.startsWith(rt)
      found.set(real, install)
    }
  })

  // Add the PATH java only if it isn't already a non-managed install we found.
  if (onPath && ![...found.values()].some((i) => i.version === onPath.version && !i.managed)) {
    found.set('__path__', { path: 'java', version: onPath.version, major: onPath.major })
  }

  return [...found.values()].sort((a, b) => b.major - a.major)
}

// ---- Cached access ----------------------------------------------------------
// Detection is stable within a session, so results are memoized. Callers that
// need fresh data (after a managed download, or a user-triggered rescan) use
// refreshJava() / invalidateJavaCache().

let cache: JavaInstall[] | null = null
let inflight: Promise<JavaInstall[]> | null = null

/** Cached Java detection. Runs detectJava() once, then serves the memoized result. */
export async function listJava(): Promise<JavaInstall[]> {
  if (cache) return cache
  if (!inflight) {
    inflight = detectJava()
      .then((r) => {
        cache = r
        return r
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** Force a fresh detection, replacing the cache. Used by the manual refresh button. */
export async function refreshJava(): Promise<JavaInstall[]> {
  inflight = null
  cache = await detectJava()
  return cache
}

/** Drop the cache so the next listJava() re-detects (e.g. after downloading a runtime). */
export function invalidateJavaCache(): void {
  cache = null
  inflight = null
}
