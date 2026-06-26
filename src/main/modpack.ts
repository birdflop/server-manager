import { resolve, sep, dirname } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import type {
  Instance,
  InstallProgress,
  ManagerIndex,
  ModpackImportPayload,
  ServerType
} from '@shared/types'
import { getProvider } from './software'
import { installServer } from './servers/install'
import { downloadFile } from './util/net'
import { writeEula, setServerProperties } from './servers/properties'
import { instanceDir, writeInstance, addInstanceMeta } from './store/instances'

type ProgressFn = (p: InstallProgress) => void

/** A single file entry in a Modrinth modpack index. */
interface MrIndexFile {
  path: string
  env?: { client?: string; server?: string }
  downloads: string[]
}

/** The modrinth.index.json manifest inside a .mrpack archive. */
interface MrIndex {
  formatVersion: number
  name?: string
  files: MrIndexFile[]
  dependencies: Record<string, string>
}

/** Map a modpack's loader dependencies to our server type + build id. */
function resolveLoader(deps: Record<string, string>): {
  type: ServerType
  build: string
  mc: string
} {
  const mc = deps.minecraft
  if (!mc) throw new Error('Modpack manifest is missing a Minecraft version.')
  if (deps['fabric-loader']) return { type: 'fabric', build: deps['fabric-loader'], mc }
  if (deps['quilt-loader']) return { type: 'quilt', build: deps['quilt-loader'], mc }
  // Forge's build id is the full "<mc>-<forge>" coordinate used by the provider.
  if (deps['forge']) return { type: 'forge', build: `${mc}-${deps['forge']}`, mc }
  if (deps['neoforge']) return { type: 'neoforge', build: deps['neoforge'], mc }
  return { type: 'vanilla', build: mc, mc }
}

/** Resolve a destination path inside `dir`, rejecting entries that escape it (zip-slip guard). */
function safeDest(dir: string, rel: string): string | null {
  const dest = resolve(dir, rel)
  const base = resolve(dir)
  return dest === base || dest.startsWith(base + sep) ? dest : null
}

/**
 * Import a Modrinth modpack (.mrpack) as a new managed instance: install the matching loader
 * server, download every server-side mod, and apply the pack's overrides.
 */
export async function importModpack(
  root: string,
  payload: ModpackImportPayload,
  onProgress?: ProgressFn
): Promise<{ instance: Instance; index: ManagerIndex }> {
  onProgress?.({ phase: 'resolve', message: 'Reading modpack…' })

  const zip = new AdmZip(payload.mrpackPath)
  const indexEntry = zip.getEntry('modrinth.index.json')
  if (!indexEntry) throw new Error('Not a valid Modrinth modpack (.mrpack): no modrinth.index.json.')
  let index: MrIndex
  try {
    index = JSON.parse(zip.readAsText(indexEntry)) as MrIndex
  } catch {
    throw new Error('Modpack manifest is corrupt or unreadable.')
  }

  const { type, build, mc } = resolveLoader(index.dependencies ?? {})

  const id = randomUUID()
  const dir = instanceDir(root, id)
  mkdirSync(dir, { recursive: true })

  try {
    // 1) Install the base loader server, exactly like the create flow.
    let buildId = build
    if (type === 'vanilla') {
      const builds = await getProvider('vanilla').listBuilds(mc)
      buildId = builds[0]?.id ?? mc
    }
    const spec = await getProvider(type).resolveInstall(mc, buildId)
    const result = await installServer(dir, spec, payload.javaPath, onProgress)

    // 2) Download server-side files declared in the manifest.
    const serverFiles = (index.files ?? []).filter(
      (f) => f.env?.server !== 'unsupported' && f.downloads?.[0]
    )
    for (let i = 0; i < serverFiles.length; i++) {
      const f = serverFiles[i]
      const dest = safeDest(dir, f.path)
      if (!dest) continue
      onProgress?.({
        phase: 'install',
        message: `Downloading mods (${i + 1}/${serverFiles.length})…`
      })
      mkdirSync(dirname(dest), { recursive: true })
      await downloadFile(f.downloads[0], dest)
    }

    // 3) Apply overrides/ then server-overrides/ (server-specific wins).
    onProgress?.({ phase: 'configure', message: 'Applying overrides…' })
    for (const prefix of ['overrides/', 'server-overrides/']) {
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue
        const rel = entry.entryName.slice(prefix.length)
        if (!rel) continue
        const dest = safeDest(dir, rel)
        if (!dest) continue
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, entry.getData())
      }
    }

    // 4) EULA + bind port, then persist the instance.
    if (payload.eulaAccepted) writeEula(dir, true)
    setServerProperties(dir, { 'server-port': 25565 })

    const instance: Instance = {
      id,
      name: payload.name,
      serverType: type,
      mcVersion: mc,
      build: buildId,
      launchKind: result.launchKind,
      launchJar: result.launchJar,
      port: 25565,
      ramMB: payload.ramMB,
      javaPath: payload.javaPath,
      jvmArgs: [],
      eulaAccepted: payload.eulaAccepted,
      createdAt: Date.now()
    }
    writeInstance(root, instance)
    const indexResult = addInstanceMeta(root, {
      id,
      name: instance.name,
      groupId: payload.groupId
    })
    onProgress?.({ phase: 'done' })
    return { instance, index: indexResult }
  } catch (err) {
    // Clean up the partial instance folder so a failed import leaves nothing behind.
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    throw err
  }
}
