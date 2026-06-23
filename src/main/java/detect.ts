import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { JavaInstall } from '@shared/types'

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

/** Run `java -version` (writes to stderr) and parse the result. */
function probe(javaPath: string): JavaInstall | null {
  const res = spawnSync(javaPath, ['-version'], { encoding: 'utf8', timeout: 5000 })
  if (res.error || res.status !== 0) return null
  const parsed = parseVersion((res.stderr || '') + (res.stdout || ''))
  if (!parsed) return null
  return { path: javaPath, version: parsed.version, major: parsed.major }
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
 */
export function detectJava(): JavaInstall[] {
  const found = new Map<string, JavaInstall>()
  const rt = runtimesDir()

  const consider = (javaPath: string): void => {
    if (!existsSync(javaPath)) return
    let real = javaPath
    try {
      real = realpathSync(javaPath)
    } catch {
      /* keep original */
    }
    if (found.has(real)) return
    const install = probe(real)
    if (install) {
      install.managed = real.startsWith(rt)
      found.set(real, install)
    }
  }

  for (const home of candidateHomes()) consider(javaExe(home))

  // Also try whatever `java` is on PATH.
  const onPath = spawnSync('java', ['-version'], { encoding: 'utf8', timeout: 5000 })
  if (!onPath.error && onPath.status === 0) {
    const parsed = parseVersion((onPath.stderr || '') + (onPath.stdout || ''))
    if (parsed && ![...found.values()].some((i) => i.version === parsed.version && !i.managed)) {
      found.set('__path__', { path: 'java', version: parsed.version, major: parsed.major })
    }
  }

  return [...found.values()].sort((a, b) => b.major - a.major)
}
