import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, rmSync, chmodSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { downloadFile } from '../util/net'

/** Directory for a managed tunnel binary (userData/tunnels/<name>). */
export function tunnelBinDir(name: string): string {
  return join(app.getPath('userData'), 'tunnels', name)
}

/**
 * Extract an archive into `dir`. On Windows the system bsdtar handles .zip; we fall back to
 * PowerShell Expand-Archive. On macOS/Linux `tar -xf` handles both .zip and .tar.gz. A relative
 * archive name + cwd avoids the Windows "C:" drive-prefix-as-remote-host tar parsing issue.
 */
function extract(archive: string, archiveName: string, dir: string, label: string): void {
  if (process.platform === 'win32') {
    const sysTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    const res = spawnSync(sysTar, ['-xf', archiveName], { cwd: dir, encoding: 'utf8' })
    if (!res.error && res.status === 0) return
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dir}' -Force`
      ],
      { encoding: 'utf8' }
    )
    if (ps.error || ps.status !== 0) {
      throw new Error(`Failed to extract ${label}: ${res.stderr || ''} | ${ps.stderr || ps.error?.message || ''}`)
    }
    return
  }
  const res = spawnSync('tar', ['-xf', archiveName], { cwd: dir, encoding: 'utf8' })
  if (res.error || res.status !== 0) {
    throw new Error(`Failed to extract ${label}: ${res.stderr || res.error?.message || 'unknown error'}`)
  }
}

export interface ManagedBinarySpec {
  /** Subfolder under userData/tunnels (e.g. "bore", "ngrok"). */
  name: string
  /** Executable basename without extension (e.g. "bore"). `.exe` is appended on Windows. */
  exe: string
  /** Download URL for the platform archive. */
  url: string
  /** Archive extension. */
  ext: 'zip' | 'tar.gz'
  /**
   * If set, sibling cache dirs whose names start with this prefix but differ from `name`
   * are pruned. Used by version-namespaced binaries (e.g. prefix "bftunnel-" removes a
   * stale "bftunnel-v0.1.0" dir once the pinned version moves to "bftunnel-v0.2.0"). Leave
   * unset for providers with a stable, unversioned dir name (bore, ngrok), which have no
   * siblings to clean up.
   */
  prunePrefix?: string
}

/**
 * Remove cache dirs left behind by earlier pinned versions. Only entries under
 * `userData/tunnels` that start with `prefix` and aren't the current `keep` dir are
 * touched, so sibling providers' binaries are never affected. Best-effort: a dir that
 * can't be removed (e.g. its binary is still running) is skipped and retried next run.
 */
function pruneStaleBinaries(prefix: string, keep: string): void {
  const root = join(app.getPath('userData'), 'tunnels')
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return // no tunnels dir yet, nothing to prune
  }
  for (const name of entries) {
    if (name === keep || !name.startsWith(prefix)) continue
    try {
      rmSync(join(root, name), { recursive: true, force: true })
    } catch {
      /* still in use or locked — leave it for a later run */
    }
  }
}

/**
 * Ensure a managed tunnel binary is present, downloading + extracting it if missing.
 * Assumes the executable sits at the archive root. Returns the executable path.
 */
export async function ensureManagedBinary(
  spec: ManagedBinarySpec,
  onMessage: (msg: string) => void
): Promise<string> {
  const dir = tunnelBinDir(spec.name)
  const exe = join(dir, process.platform === 'win32' ? `${spec.exe}.exe` : spec.exe)

  // Drop any older version-namespaced dirs (runs whether or not we re-download, so an
  // app update that already fetched the new binary still cleans up the prior version).
  if (spec.prunePrefix) pruneStaleBinaries(spec.prunePrefix, spec.name)

  if (existsSync(exe)) return exe

  mkdirSync(dir, { recursive: true })
  const archiveName = `${spec.name}.${spec.ext}`
  const archive = join(dir, archiveName)

  onMessage(`Downloading ${spec.name}…`)
  await downloadFile(spec.url, archive)
  extract(archive, archiveName, dir, spec.name)
  try {
    rmSync(archive)
  } catch {
    /* leave the archive if it can't be removed */
  }
  if (process.platform !== 'win32') {
    try {
      chmodSync(exe, 0o755)
    } catch {
      /* best effort */
    }
  }
  if (!existsSync(exe)) throw new Error(`${spec.name} binary not found after extraction`)
  return exe
}
