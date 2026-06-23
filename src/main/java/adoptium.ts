import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { JavaInstall, JavaProgress } from '@shared/types'
import { downloadFile } from '../util/net'
import { runtimesDir } from './detect'

type ProgressFn = (p: JavaProgress) => void

function osName(): string {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'mac'
  return 'linux'
}

function archName(): string {
  switch (process.arch) {
    case 'x64':
      return 'x64'
    case 'arm64':
      return 'aarch64'
    case 'ia32':
      return 'x86'
    default:
      return 'x64'
  }
}

function javaExe(home: string): string {
  return process.platform === 'win32' ? join(home, 'bin', 'java.exe') : join(home, 'bin', 'java')
}

/**
 * Extract an Adoptium archive into targetDir.
 * On Windows the `tar` on PATH may be GNU tar (from Git for Windows) which can't read
 * zips, so we use the system bsdtar explicitly and fall back to PowerShell Expand-Archive.
 * On macOS/Linux the system tar handles .tar.gz. A relative archive name + cwd avoids the
 * Windows "C:" drive-prefix-as-remote-host parsing issue.
 */
function extractArchive(archive: string, archiveName: string, targetDir: string): void {
  if (process.platform === 'win32') {
    const sysTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    const res = spawnSync(sysTar, ['-xf', archiveName], { cwd: targetDir, encoding: 'utf8' })
    if (!res.error && res.status === 0) return
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${targetDir}' -Force`
      ],
      { encoding: 'utf8' }
    )
    if (ps.error || ps.status !== 0) {
      throw new Error(
        `Failed to extract Java: ${res.stderr || ''} | ${ps.stderr || ps.error?.message || 'unknown error'}`
      )
    }
    return
  }
  const res = spawnSync('tar', ['-xf', archiveName], { cwd: targetDir, encoding: 'utf8' })
  if (res.error || res.status !== 0) {
    throw new Error(`Failed to extract Java: ${res.stderr || res.error?.message || 'unknown error'}`)
  }
}

/** Locate the java executable within an extracted Adoptium archive folder. */
function findJava(dir: string): string | null {
  for (const entry of readdirSync(dir)) {
    const home = join(dir, entry)
    try {
      if (!statSync(home).isDirectory()) continue
    } catch {
      continue
    }
    const direct = javaExe(home)
    if (existsSync(direct)) return direct
    const macJava = javaExe(join(home, 'Contents', 'Home'))
    if (existsSync(macJava)) return macJava
  }
  return null
}

/**
 * Ensure a Temurin JRE for `major` is available, downloading + extracting from
 * Adoptium if needed. Reports progress through `onProgress`.
 */
export async function ensureJava(major: number, onProgress?: ProgressFn): Promise<JavaInstall> {
  const targetDir = join(runtimesDir(), String(major))

  // Reuse an already-extracted runtime.
  if (existsSync(targetDir)) {
    const existing = findJava(targetDir)
    if (existing) {
      onProgress?.({ major, phase: 'done' })
      return { path: existing, version: String(major), major, managed: true }
    }
  }

  mkdirSync(targetDir, { recursive: true })
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName()}/${archName()}/jre/hotspot/normal/eclipse`
  const archiveName = `temurin-${major}.${ext}`
  const archive = join(targetDir, archiveName)

  onProgress?.({ major, phase: 'download', received: 0, total: 0 })
  await downloadFile(url, archive, (received, total) =>
    onProgress?.({ major, phase: 'download', received, total })
  )

  onProgress?.({ major, phase: 'extract' })
  extractArchive(archive, archiveName, targetDir)
  try {
    rmSync(archive)
  } catch {
    /* leave the archive if it can't be removed */
  }

  const javaPath = findJava(targetDir)
  if (!javaPath) throw new Error('Could not locate java executable after extraction')

  onProgress?.({ major, phase: 'done' })
  return { path: javaPath, version: String(major), major, managed: true }
}
