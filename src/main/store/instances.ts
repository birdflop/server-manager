import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  lstatSync,
  statSync,
  copyFileSync,
  realpathSync
} from 'node:fs'
import type {
  Group,
  ImportInstancePayload,
  Instance,
  InstanceMeta,
  ManagerIndex
} from '@shared/types'

const INDEX_FILE = 'birdflop-manager.json'
const EMPTY_INDEX: ManagerIndex = { groups: [], instances: [] }

export function indexPath(root: string): string {
  return join(root, INDEX_FILE)
}

export function instancesDir(root: string): string {
  return join(root, 'instances')
}

/** Path to a single instance's folder. */
export function instanceDir(root: string, id: string): string {
  return join(instancesDir(root), id)
}

/**
 * Ensure the data root has the expected layout: an `instances/` folder and a
 * manager index file. Safe to call repeatedly. Returns the (existing or new) index.
 */
export function ensureRoot(root: string): ManagerIndex {
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  const inst = instancesDir(root)
  if (!existsSync(inst)) mkdirSync(inst, { recursive: true })
  if (!existsSync(indexPath(root))) {
    writeIndex(root, EMPTY_INDEX)
    return { ...EMPTY_INDEX }
  }
  return readIndex(root)
}

export function readIndex(root: string): ManagerIndex {
  try {
    const raw = readFileSync(indexPath(root), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ManagerIndex>
    return {
      groups: parsed.groups ?? [],
      instances: parsed.instances ?? []
    }
  } catch {
    return { ...EMPTY_INDEX }
  }
}

export function writeIndex(root: string, index: ManagerIndex): void {
  writeFileSync(indexPath(root), JSON.stringify(index, null, 2), 'utf-8')
}

/** Read, mutate, persist, and return the index. */
function mutateIndex(root: string, fn: (index: ManagerIndex) => void): ManagerIndex {
  const index = readIndex(root)
  fn(index)
  // Keep `order` fields consistent with array position so the renderer can sort reliably.
  index.groups.forEach((g, i) => (g.order = i))
  index.instances.forEach((inst, i) => (inst.order = i))
  writeIndex(root, index)
  return index
}

// ---- Group operations ----

export function createGroup(root: string, name: string): ManagerIndex {
  return mutateIndex(root, (index) => {
    const group: Group = {
      id: randomUUID(),
      name: name.trim() || 'New group',
      expanded: true,
      order: index.groups.length
    }
    index.groups.push(group)
  })
}

export function renameGroup(root: string, id: string, name: string): ManagerIndex {
  return mutateIndex(root, (index) => {
    const group = index.groups.find((g) => g.id === id)
    if (group) group.name = name.trim() || group.name
  })
}

export function deleteGroup(root: string, id: string): ManagerIndex {
  return mutateIndex(root, (index) => {
    index.groups = index.groups.filter((g) => g.id !== id)
    // Orphaned instances fall back to ungrouped rather than being deleted.
    index.instances.forEach((inst) => {
      if (inst.groupId === id) inst.groupId = null
    })
  })
}

export function setGroupExpanded(root: string, id: string, expanded: boolean): ManagerIndex {
  return mutateIndex(root, (index) => {
    const group = index.groups.find((g) => g.id === id)
    if (group) group.expanded = expanded
  })
}

// ---- Instance index operations ----

/** Append an instance to the index (the folder + instance.json are written elsewhere). */
export function addInstanceMeta(root: string, meta: Omit<InstanceMeta, 'order'>): ManagerIndex {
  return mutateIndex(root, (index) => {
    index.instances.push({ ...meta, order: index.instances.length })
  })
}

/** Move an instance into a group (or ungrouped) and position it before `beforeId`. */
export function moveInstance(
  root: string,
  id: string,
  groupId: string | null,
  beforeId?: string | null
): ManagerIndex {
  return mutateIndex(root, (index) => {
    const idx = index.instances.findIndex((i) => i.id === id)
    if (idx === -1) return
    const [moved] = index.instances.splice(idx, 1)
    moved.groupId = groupId
    if (beforeId) {
      const target = index.instances.findIndex((i) => i.id === beforeId)
      if (target !== -1) {
        index.instances.splice(target, 0, moved)
        return
      }
    }
    index.instances.push(moved)
  })
}

export function removeInstanceMeta(root: string, id: string): ManagerIndex {
  return mutateIndex(root, (index) => {
    index.instances = index.instances.filter((i) => i.id !== id)
  })
}

export function renameInstanceMeta(root: string, id: string, name: string): ManagerIndex {
  return mutateIndex(root, (index) => {
    const inst = index.instances.find((i) => i.id === id)
    if (inst) inst.name = name.trim() || inst.name
  })
}

// ---- Per-instance config (instance.json) ----

function instanceConfigPath(root: string, id: string): string {
  return join(instanceDir(root, id), 'instance.json')
}

export function readInstance(root: string, id: string): Instance | null {
  try {
    return JSON.parse(readFileSync(instanceConfigPath(root, id), 'utf-8')) as Instance
  } catch {
    return null
  }
}

export function writeInstance(root: string, instance: Instance): void {
  writeFileSync(
    instanceConfigPath(root, instance.id),
    JSON.stringify(instance, null, 2),
    'utf-8'
  )
}

/** Editable runtime fields of an instance. */
export type InstancePatch = Partial<
  Pick<Instance, 'name' | 'port' | 'ramMB' | 'javaPath' | 'jvmArgs' | 'watch' | 'tunnel' | 'debug'>
>

/** Apply editable changes to an instance's config + index. */
export function updateInstance(
  root: string,
  id: string,
  patch: InstancePatch
): { instance: Instance; index: ManagerIndex } | null {
  const inst = readInstance(root, id)
  if (!inst) return null
  const instance = { ...inst, ...patch }
  writeInstance(root, instance)
  const index =
    patch.name && patch.name !== inst.name
      ? renameInstanceMeta(root, id, patch.name)
      : readIndex(root)
  return { instance, index }
}

/**
 * Recursively copy a folder, resolving symlinks to their real content instead of
 * recreating links (creating symlinks needs elevated privileges on Windows, which
 * is what broke `fs.cpSync`). Broken links, cycles, and unreadable/locked files
 * are skipped so importing arbitrary server folders is robust.
 */
function copyTree(src: string, dest: string, seen: Set<string> = new Set()): void {
  let st
  try {
    st = lstatSync(src)
  } catch {
    return
  }

  if (st.isSymbolicLink()) {
    let target
    try {
      target = statSync(src) // follow the link
    } catch {
      return // broken link — skip
    }
    if (target.isDirectory()) copyDir(src, dest, seen)
    else if (target.isFile()) copyFileSafe(src, dest)
    return
  }
  if (st.isDirectory()) {
    copyDir(src, dest, seen)
    return
  }
  if (st.isFile()) copyFileSafe(src, dest)
}

function copyDir(src: string, dest: string, seen: Set<string>): void {
  let real: string
  try {
    real = realpathSync(src)
  } catch {
    real = src
  }
  if (seen.has(real)) return // guard against symlink cycles
  seen.add(real)
  mkdirSync(dest, { recursive: true })
  let entries: string[]
  try {
    entries = readdirSync(src)
  } catch {
    return
  }
  for (const entry of entries) copyTree(join(src, entry), join(dest, entry), seen)
}

function copyFileSafe(src: string, dest: string): void {
  try {
    copyFileSync(src, dest)
  } catch {
    // skip files we can't read (e.g. locked by a running server)
  }
}

/** Duplicate an instance: copy its folder, assign a new id, bump the port. */
export function cloneInstance(
  root: string,
  id: string
): { instance: Instance; index: ManagerIndex } | null {
  const src = readInstance(root, id)
  if (!src) return null
  const newId = randomUUID()
  copyTree(instanceDir(root, id), instanceDir(root, newId))
  const instance: Instance = {
    ...src,
    id: newId,
    name: `${src.name} (copy)`,
    port: src.port + 1,
    createdAt: Date.now()
  }
  writeInstance(root, instance)
  const srcMeta = readIndex(root).instances.find((i) => i.id === id)
  const index = addInstanceMeta(root, {
    id: newId,
    name: instance.name,
    groupId: srcMeta?.groupId ?? null
  })
  return { instance, index }
}

/** Import an existing server folder by copying it into a new managed instance. */
export function importInstance(
  root: string,
  payload: ImportInstancePayload
): { instance: Instance; index: ManagerIndex } {
  const newId = randomUUID()
  const dir = instanceDir(root, newId)
  mkdirSync(dir, { recursive: true })
  try {
    copyTree(payload.sourcePath, dir)
  } catch (err) {
    // Clean up the partial copy so we don't leave an orphan folder behind.
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    throw err
  }
  const instance: Instance = {
    id: newId,
    name: payload.name,
    serverType: payload.serverType,
    mcVersion: payload.mcVersion,
    build: 'imported',
    launchKind: payload.launchKind,
    launchJar: payload.launchJar,
    port: payload.port,
    ramMB: payload.ramMB,
    javaPath: payload.javaPath,
    jvmArgs: payload.jvmArgs,
    eulaAccepted: existsSync(join(dir, 'eula.txt')),
    createdAt: Date.now()
  }
  writeInstance(root, instance)
  const index = addInstanceMeta(root, {
    id: newId,
    name: instance.name,
    groupId: payload.groupId
  })
  return { instance, index }
}

/** List top-level .jar files in an arbitrary folder (for the import picker). */
export function listFolderJars(path: string): string[] {
  try {
    return readdirSync(path).filter((f) => f.toLowerCase().endsWith('.jar'))
  } catch {
    return []
  }
}

/** Remove an instance's folder and its index entry. */
export function deleteInstance(root: string, id: string): ManagerIndex {
  try {
    rmSync(instanceDir(root, id), { recursive: true, force: true })
  } catch {
    /* ignore filesystem errors; still drop from the index */
  }
  return removeInstanceMeta(root, id)
}
