import { join, basename } from 'node:path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  rmSync,
  renameSync,
  readFileSync,
  writeFileSync,
  openSync,
  readSync,
  closeSync
} from 'node:fs'
import type {
  ContentFile,
  ContentMeta,
  ContentSearchHit,
  ContentSource,
  ContentUpdate,
  Instance
} from '@shared/types'
import { MODRINTH_LOADERS, contentDirOf, contentKindOf, contentSourcesOf } from '@shared/software'
import { readInstance, instanceDir } from '../store/instances'
import { downloadFile } from '../util/net'
import { searchModrinth, resolveModrinthDownload } from '../modrinth'
import { searchHangar, resolveHangarDownload } from '../hangar'
import { searchSpiget, resolveSpigetDownload } from '../spiget'

const META_FILE = '.birdflop-content.json'

function contentDir(root: string, id: string): string | null {
  const inst = readInstance(root, id)
  if (!inst || contentKindOf(inst.serverType) === 'none') return null
  return join(instanceDir(root, id), contentDirOf(inst.serverType))
}

/** filename -> install provenance, persisted alongside the content files. */
type ContentMetaMap = Record<string, ContentMeta>

function readMeta(dir: string): ContentMetaMap {
  try {
    return JSON.parse(readFileSync(join(dir, META_FILE), 'utf-8')) as ContentMetaMap
  } catch {
    return {}
  }
}

function writeMeta(dir: string, map: ContentMetaMap): void {
  try {
    writeFileSync(join(dir, META_FILE), JSON.stringify(map, null, 2), 'utf-8')
  } catch {
    /* non-fatal — update tracking is best-effort */
  }
}

/** Resolve the latest downloadable version of a project for an instance's loader/MC. */
function resolveDownload(
  inst: Instance,
  source: ContentSource,
  projectId: string
): Promise<{ url: string; filename: string; versionId: string; versionNumber?: string }> {
  if (source === 'modrinth') {
    return resolveModrinthDownload(projectId, MODRINTH_LOADERS[inst.serverType], inst.mcVersion)
  }
  if (source === 'hangar') return resolveHangarDownload(projectId)
  return resolveSpigetDownload(projectId)
}

export function listContent(root: string, id: string): ContentFile[] {
  const dir = contentDir(root, id)
  if (!dir || !existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
    .map((f) => ({ name: f, size: statSync(join(dir, f)).size }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function addContentFiles(root: string, id: string, paths: string[]): ContentFile[] {
  const dir = contentDir(root, id)
  if (!dir) return []
  mkdirSync(dir, { recursive: true })
  for (const p of paths) {
    if (!p.endsWith('.jar')) continue
    try {
      copyFileSync(p, join(dir, basename(p)))
    } catch {
      /* skip files that can't be copied */
    }
  }
  return listContent(root, id)
}

export function deleteContentFile(root: string, id: string, name: string): ContentFile[] {
  const dir = contentDir(root, id)
  if (dir) {
    const bare = basename(name)
    try {
      // Guard against path traversal — only operate on a bare filename.
      rmSync(join(dir, bare))
    } catch {
      /* ignore */
    }
    const meta = readMeta(dir)
    if (meta[bare]) {
      delete meta[bare]
      writeMeta(dir, meta)
    }
  }
  return listContent(root, id)
}

export function contentSearch(
  root: string,
  id: string,
  source: ContentSource,
  query: string
): Promise<ContentSearchHit[]> {
  const inst = readInstance(root, id)
  if (!inst || !contentSourcesOf(inst.serverType).includes(source)) return Promise.resolve([])
  if (source === 'modrinth') return searchModrinth(query, MODRINTH_LOADERS[inst.serverType])
  if (source === 'hangar') return searchHangar(query)
  return searchSpiget(query)
}

/** First two bytes of a zip/jar are "PK"; guards against saved HTML error pages. */
function isZip(path: string): boolean {
  try {
    const fd = openSync(path, 'r')
    const buf = Buffer.alloc(2)
    readSync(fd, buf, 0, 2, 0)
    closeSync(fd)
    return buf[0] === 0x50 && buf[1] === 0x4b
  } catch {
    return false
  }
}

/**
 * Download one Modrinth project's primary file into `dir`, recording provenance in `meta`
 * (mutated in place, not flushed). Returns the saved filename + its required dependency
 * project ids. Skips the download if a file with that name already exists.
 */
async function installModrinthProject(
  inst: Instance,
  dir: string,
  projectId: string,
  meta: ContentMetaMap
): Promise<{ filename: string; requiredDeps: string[] }> {
  const dl = await resolveModrinthDownload(projectId, MODRINTH_LOADERS[inst.serverType], inst.mcVersion)
  const filename = dl.filename.endsWith('.jar') ? dl.filename : `${dl.filename}.jar`
  const dest = join(dir, filename)
  if (!existsSync(dest)) {
    await downloadFile(dl.url, dest)
    if (!isZip(dest)) {
      try {
        rmSync(dest)
      } catch {
        /* ignore */
      }
      throw new Error("Couldn't fetch a jar directly (it may be hosted off-site) — use “Open page”.")
    }
  }
  meta[filename] = {
    source: 'modrinth',
    projectId,
    versionId: dl.versionId,
    versionNumber: dl.versionNumber
  }
  return { filename, requiredDeps: dl.requiredDeps }
}

const MAX_DEP_DEPTH = 5

export async function contentInstall(
  root: string,
  id: string,
  source: ContentSource,
  projectId: string
): Promise<ContentFile[]> {
  const inst = readInstance(root, id)
  const dir = contentDir(root, id)
  if (!inst || !dir) throw new Error('Server has no content folder')
  mkdirSync(dir, { recursive: true })
  const meta = readMeta(dir)

  if (source === 'modrinth') {
    // Projects already installed (any file with that provenance) — don't re-pull as a dependency.
    const installedProjects = new Set<string>()
    for (const m of Object.values(meta)) if (m.source === 'modrinth') installedProjects.add(m.projectId)

    // Install the chosen project, then breadth-first install its required dependencies.
    const root0 = await installModrinthProject(inst, dir, projectId, meta)
    installedProjects.add(projectId)

    const seen = new Set<string>([projectId])
    let frontier = root0.requiredDeps
    for (let depth = 0; frontier.length && depth < MAX_DEP_DEPTH; depth++) {
      const next: string[] = []
      for (const dep of frontier) {
        if (seen.has(dep) || installedProjects.has(dep)) continue
        seen.add(dep)
        try {
          const r = await installModrinthProject(inst, dir, dep, meta)
          installedProjects.add(dep)
          next.push(...r.requiredDeps)
        } catch {
          /* a dependency without a build for this loader/MC — skip it rather than failing the install */
        }
      }
      frontier = next
    }
    writeMeta(dir, meta)
    return listContent(root, id)
  }

  // Hangar / SpigotMC: single-file install (no dependency graph exposed).
  const dl = await resolveDownload(inst, source, projectId)
  const filename = dl.filename.endsWith('.jar') ? dl.filename : `${dl.filename}.jar`
  const dest = join(dir, filename)
  await downloadFile(dl.url, dest)
  if (!isZip(dest)) {
    try {
      rmSync(dest)
    } catch {
      /* ignore */
    }
    throw new Error("Couldn't fetch a jar directly (it may be hosted off-site) — use “Open page”.")
  }
  meta[filename] = { source, projectId, versionId: dl.versionId, versionNumber: dl.versionNumber }
  writeMeta(dir, meta)
  return listContent(root, id)
}

/** Check every tracked content file for a newer version available from its source. */
export async function checkContentUpdates(root: string, id: string): Promise<ContentUpdate[]> {
  const inst = readInstance(root, id)
  const dir = contentDir(root, id)
  if (!inst || !dir || !existsSync(dir)) return []
  const meta = readMeta(dir)
  const present = new Set(listContent(root, id).map((f) => f.name))

  const checks = Object.entries(meta)
    .filter(([name, m]) => present.has(name) && m.versionId)
    .map(async ([name, m]): Promise<ContentUpdate | null> => {
      try {
        const latest = await resolveDownload(inst, m.source, m.projectId)
        if (latest.versionId && latest.versionId !== m.versionId) {
          return {
            name,
            source: m.source,
            projectId: m.projectId,
            currentVersion: m.versionNumber,
            latestVersion: latest.versionNumber
          }
        }
      } catch {
        /* skip files whose source can't be reached right now */
      }
      return null
    })

  return (await Promise.all(checks)).filter((u): u is ContentUpdate => u !== null)
}

/** Update one tracked content file to the latest version from its source. */
export async function updateContent(root: string, id: string, name: string): Promise<ContentFile[]> {
  const inst = readInstance(root, id)
  const dir = contentDir(root, id)
  if (!inst || !dir) throw new Error('Server has no content folder')
  const bare = basename(name)
  const meta = readMeta(dir)
  const m = meta[bare]
  if (!m) throw new Error('This file was not installed by the app, so it can’t be auto-updated.')

  const dl = await resolveDownload(inst, m.source, m.projectId)
  const newName = dl.filename.endsWith('.jar') ? dl.filename : `${dl.filename}.jar`

  // Download to a temp file first; only swap in once we know it's a valid jar.
  const tmp = join(dir, `.${newName}.downloading`)
  await downloadFile(dl.url, tmp)
  if (!isZip(tmp)) {
    try {
      rmSync(tmp)
    } catch {
      /* ignore */
    }
    throw new Error("Couldn't fetch the updated jar directly — use the source page.")
  }
  try {
    rmSync(join(dir, bare))
  } catch {
    /* old file may have been removed already */
  }
  renameSync(tmp, join(dir, newName))
  delete meta[bare]
  meta[newName] = {
    source: m.source,
    projectId: m.projectId,
    versionId: dl.versionId,
    versionNumber: dl.versionNumber
  }
  writeMeta(dir, meta)
  return listContent(root, id)
}
