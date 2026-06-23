import { join, basename } from 'node:path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  rmSync,
  openSync,
  readSync,
  closeSync
} from 'node:fs'
import type { ContentFile, ContentSearchHit, ContentSource } from '@shared/types'
import { MODRINTH_LOADERS, contentDirOf, contentKindOf, contentSourcesOf } from '@shared/software'
import { readInstance, instanceDir } from '../store/instances'
import { downloadFile } from '../util/net'
import { searchModrinth, resolveModrinthDownload } from '../modrinth'
import { searchHangar, resolveHangarDownload } from '../hangar'
import { searchSpiget, resolveSpigetDownload } from '../spiget'

function contentDir(root: string, id: string): string | null {
  const inst = readInstance(root, id)
  if (!inst || contentKindOf(inst.serverType) === 'none') return null
  return join(instanceDir(root, id), contentDirOf(inst.serverType))
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
    try {
      // Guard against path traversal — only operate on a bare filename.
      rmSync(join(dir, basename(name)))
    } catch {
      /* ignore */
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

export async function contentInstall(
  root: string,
  id: string,
  source: ContentSource,
  projectId: string
): Promise<ContentFile[]> {
  const inst = readInstance(root, id)
  const dir = contentDir(root, id)
  if (!inst || !dir) throw new Error('Server has no content folder')

  let dl: { url: string; filename: string }
  if (source === 'modrinth') {
    dl = await resolveModrinthDownload(projectId, MODRINTH_LOADERS[inst.serverType], inst.mcVersion)
  } else if (source === 'hangar') {
    dl = await resolveHangarDownload(projectId)
  } else {
    dl = await resolveSpigetDownload(projectId)
  }

  mkdirSync(dir, { recursive: true })
  const dest = join(dir, dl.filename.endsWith('.jar') ? dl.filename : `${dl.filename}.jar`)
  await downloadFile(dl.url, dest)
  if (!isZip(dest)) {
    try {
      rmSync(dest)
    } catch {
      /* ignore */
    }
    throw new Error("Couldn't fetch a jar directly (it may be hosted off-site) — use “Open page”.")
  }
  return listContent(root, id)
}
