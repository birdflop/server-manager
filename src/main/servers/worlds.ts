import { join, basename } from 'node:path'
import {
  existsSync,
  readdirSync,
  statSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  renameSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import type { WorldInfo } from '@shared/types'
import { instanceDir } from '../store/instances'
import { readServerProperties, setServerProperties } from './properties'

/**
 * World management for Minecraft servers: list/switch/delete/regenerate worlds,
 * zip-based import/export, and per-world datapacks. A "world" is any folder in the
 * instance dir with a level.dat; Paper-style companion dimension folders
 * (<name>_nether / <name>_the_end) are treated as part of their base world.
 */

const isWin = process.platform === 'win32'

function tarBin(): string {
  return isWin ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
}

/** Reject anything that could escape the instance folder. */
function assertSafeName(name: string): void {
  if (!name || /[\\/]|\.\./.test(name)) throw new Error('Invalid world name')
}

function dirSize(dir: string): number {
  let total = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      const st = statSync(full)
      total += st.isDirectory() ? dirSize(full) : st.size
    } catch {
      /* locked/vanished */
    }
  }
  return total
}

function isWorldDir(dir: string): boolean {
  return existsSync(join(dir, 'level.dat')) || existsSync(join(dir, 'level.dat_old'))
}

/** The active world name from server.properties (Minecraft's default is "world"). */
function activeWorldName(dir: string): string {
  return readServerProperties(dir)['level-name']?.trim() || 'world'
}

/** Paper splits dimensions into sibling folders; treat them as part of the base world. */
function companionDirs(dir: string, name: string): string[] {
  return [`${name}_nether`, `${name}_the_end`]
    .map((n) => join(dir, n))
    .filter((p) => existsSync(p))
}

function listDatapacks(worldDir: string): string[] {
  const dir = join(worldDir, 'datapacks')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => !f.startsWith('.'))
}

export function listWorlds(root: string, id: string): WorldInfo[] {
  const dir = instanceDir(root, id)
  if (!existsSync(dir)) return []
  const active = activeWorldName(dir)

  const worldNames = readdirSync(dir).filter((entry) => {
    const full = join(dir, entry)
    try {
      if (!statSync(full).isDirectory() || !isWorldDir(full)) return false
    } catch {
      return false
    }
    // Hide companion dimension folders when their base world exists.
    const base = entry.replace(/_(nether|the_end)$/, '')
    return base === entry || !isWorldDir(join(dir, base))
  })

  return worldNames
    .map((name) => {
      const worldDir = join(dir, name)
      const size =
        dirSize(worldDir) + companionDirs(dir, name).reduce((sum, d) => sum + dirSize(d), 0)
      return { name, size, active: name === active, datapacks: listDatapacks(worldDir) }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
}

/** Point level-name at another world (takes effect on the next start). */
export function setActiveWorld(root: string, id: string, name: string): WorldInfo[] {
  assertSafeName(name)
  setServerProperties(instanceDir(root, id), { 'level-name': name })
  return listWorlds(root, id)
}

export function deleteWorld(root: string, id: string, name: string): WorldInfo[] {
  assertSafeName(name)
  const dir = instanceDir(root, id)
  if (name === activeWorldName(dir)) {
    throw new Error('This is the active world — switch to another world first.')
  }
  rmSync(join(dir, name), { recursive: true, force: true })
  for (const companion of companionDirs(dir, name)) rmSync(companion, { recursive: true, force: true })
  return listWorlds(root, id)
}

/**
 * Delete a world's files and set the seed so the server regenerates it on next start.
 * Works on the active world too — that's the main use case.
 */
export function regenerateWorld(root: string, id: string, name: string, seed: string): WorldInfo[] {
  assertSafeName(name)
  const dir = instanceDir(root, id)
  rmSync(join(dir, name), { recursive: true, force: true })
  for (const companion of companionDirs(dir, name)) rmSync(companion, { recursive: true, force: true })
  setServerProperties(dir, { 'level-name': name, 'level-seed': seed.trim() })
  return listWorlds(root, id)
}

/** Zip a world (plus its dimension companions) to `outPath`. */
export function exportWorld(root: string, id: string, name: string, outPath: string): void {
  assertSafeName(name)
  const dir = instanceDir(root, id)
  if (!existsSync(join(dir, name))) throw new Error('World not found')
  const targets = [name, ...companionDirs(dir, name).map((p) => basename(p))]
  const args = isWin ? ['-a', '-cf', outPath, ...targets] : ['-czf', outPath, ...targets]
  const res = spawnSync(tarBin(), args, { cwd: dir, encoding: 'utf8' })
  if (res.error) throw new Error(`Export failed: ${res.error.message}`)
  if (res.status !== 0 && !(existsSync(outPath) && statSync(outPath).size > 0)) {
    throw new Error(`Export failed: ${res.stderr?.trim() || `tar exited with code ${res.status}`}`)
  }
}

/**
 * Extract a world zip into the instance as a new world folder. Accepts archives with
 * level.dat at the top level or nested inside a single root folder.
 */
export function importWorld(root: string, id: string, zipPath: string): WorldInfo[] {
  const dir = instanceDir(root, id)
  let name = basename(zipPath)
    .replace(/\.(zip|tar\.gz|tgz)$/i, '')
    .replace(/[^a-z0-9 _.-]+/gi, '')
    .trim()
  if (!name) name = 'imported-world'
  while (existsSync(join(dir, name))) name = `${name}-2`

  const target = join(dir, name)
  mkdirSync(target, { recursive: true })
  const res = spawnSync(tarBin(), ['-xf', zipPath], { cwd: target, encoding: 'utf8' })
  if (res.error || (res.status !== 0 && readdirSync(target).length === 0)) {
    rmSync(target, { recursive: true, force: true })
    throw new Error(`Import failed: ${res.error?.message || res.stderr?.trim() || 'extraction error'}`)
  }

  if (!isWorldDir(target)) {
    // Single wrapper folder inside the archive? Hoist its contents up.
    const entries = readdirSync(target)
    const inner = entries.length === 1 ? join(target, entries[0]) : null
    if (inner && statSync(inner).isDirectory() && isWorldDir(inner)) {
      for (const entry of readdirSync(inner)) renameSync(join(inner, entry), join(target, entry))
      rmSync(inner, { recursive: true, force: true })
    } else {
      rmSync(target, { recursive: true, force: true })
      throw new Error('That archive doesn’t look like a world (no level.dat found).')
    }
  }
  return listWorlds(root, id)
}

/** Copy datapack zips/folders into a world's datapacks folder. */
export function addDatapacks(root: string, id: string, world: string, paths: string[]): WorldInfo[] {
  assertSafeName(world)
  const dir = join(instanceDir(root, id), world, 'datapacks')
  mkdirSync(dir, { recursive: true })
  for (const src of paths) copyFileSync(src, join(dir, basename(src)))
  return listWorlds(root, id)
}

export function deleteDatapack(root: string, id: string, world: string, name: string): WorldInfo[] {
  assertSafeName(world)
  assertSafeName(name)
  rmSync(join(instanceDir(root, id), world, 'datapacks', name), { recursive: true, force: true })
  return listWorlds(root, id)
}
