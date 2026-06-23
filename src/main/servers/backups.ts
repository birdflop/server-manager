import { join, relative } from 'node:path'
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import type { BackupInfo } from '@shared/types'
import { instanceDir } from '../store/instances'

const isWin = process.platform === 'win32'
const ARCHIVE_EXT = isWin ? 'zip' : 'tar.gz'

function backupsDir(root: string, id: string): string {
  return join(root, 'backups', id)
}

// Use the system bsdtar on Windows (the `tar` on PATH may be GNU tar, which can't
// read/write zip). Relative paths avoid bsdtar parsing the "C:" drive as a remote host.
function tarBin(): string {
  return isWin ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
}

export function listBackups(root: string, id: string): BackupInfo[] {
  const dir = backupsDir(root, id)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.zip') || f.endsWith('.tar.gz'))
    .map((f) => {
      const s = statSync(join(dir, f))
      return { name: f, size: s.size, createdAt: s.mtimeMs }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function createBackup(root: string, id: string): BackupInfo[] {
  const inst = instanceDir(root, id)
  if (!existsSync(inst)) throw new Error('Instance folder not found')
  const dir = backupsDir(root, id)
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const out = join(dir, `${stamp}.${ARCHIVE_EXT}`)
  const rel = relative(inst, out)
  // Skip the world lock file (held by a running server) to avoid read errors.
  const args = isWin
    ? ['-a', '-cf', rel, '--exclude', '*session.lock', '.']
    : ['-czf', rel, '--exclude', '*session.lock', '.']
  const res = spawnSync(tarBin(), args, { cwd: inst, encoding: 'utf8' })
  if (res.error) throw new Error(`Backup failed: ${res.error.message}`)
  // bsdtar/tar can exit non-zero on benign per-file warnings (a locked or changing
  // file) while still producing a valid archive — accept a non-empty result.
  if (res.status !== 0 && !(existsSync(out) && statSync(out).size > 0)) {
    throw new Error(`Backup failed: ${res.stderr?.trim() || `tar exited with code ${res.status}`}`)
  }
  return listBackups(root, id)
}

export function restoreBackup(root: string, id: string, name: string): void {
  const inst = instanceDir(root, id)
  const file = join(backupsDir(root, id), name)
  if (!existsSync(file)) throw new Error('Backup not found')
  // Replace the instance folder with the snapshot (backups live outside it, so survive).
  rmSync(inst, { recursive: true, force: true })
  mkdirSync(inst, { recursive: true })
  const rel = relative(inst, file)
  const res = spawnSync(tarBin(), ['-xf', rel], { cwd: inst, encoding: 'utf8' })
  if (res.error) throw new Error(`Restore failed: ${res.error.message}`)
  // Tolerate benign extraction warnings as long as files were actually written.
  if (res.status !== 0 && readdirSync(inst).length === 0) {
    throw new Error(`Restore failed: ${res.stderr?.trim() || `tar exited with code ${res.status}`}`)
  }
}

export function deleteBackup(root: string, id: string, name: string): BackupInfo[] {
  try {
    rmSync(join(backupsDir(root, id), name))
  } catch {
    /* ignore */
  }
  return listBackups(root, id)
}
