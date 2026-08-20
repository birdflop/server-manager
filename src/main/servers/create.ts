/**
 * Building a new server from a create payload. Shared by the renderer's create
 * wizard (via `instances:create`) and the plugin API, so both go through exactly
 * the same download → configure → index path.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import type {
  CreateInstancePayload,
  InstallProgress,
  Instance,
  ManagerIndex,
  ServerType
} from '@shared/types'
import { isProxy } from '@shared/software'
import { getConfig } from '../config'
import { getProvider } from '../software'
import { addInstanceMeta, instanceDir, readIndex, readInstance, writeInstance } from '../store/instances'
import { listJava, invalidateJavaCache } from '../java/detect'
import { ensureJava } from '../java/adoptium'
import { javaSatisfies, requiredJavaMajor } from '../java/requirements'
import { installServer } from './install'
import { setProxyPort, setServerProperties, writeEula } from './properties'

/** Everything but `name` and `serverType` can be filled in by `resolveCreateDefaults`. */
export type PartialCreatePayload = Omit<Partial<CreateInstancePayload>, 'name' | 'serverType'> & {
  name: string
  /** Not `ServerType`: plugin-registered software providers bring their own ids. */
  serverType: string
}

/**
 * Download + install a server into a fresh folder and add it to the index.
 * On failure the half-written folder is removed, since it has no index entry
 * and nothing else would ever clean it up.
 */
export async function createInstance(
  root: string,
  payload: CreateInstancePayload,
  onProgress?: (p: InstallProgress) => void
): Promise<{ instance: Instance; index: ManagerIndex }> {
  const id = randomUUID()
  const dir = instanceDir(root, id)
  mkdirSync(dir, { recursive: true })

  const send = (p: InstallProgress): void => onProgress?.(p)

  let instance: Instance
  try {
    send({ phase: 'resolve' })
    const spec = await getProvider(payload.serverType).resolveInstall(payload.mcVersion, payload.build)
    const result = await installServer(dir, spec, payload.javaPath, send)

    send({ phase: 'configure' })
    if (isProxy(payload.serverType)) {
      // Proxies have no Minecraft EULA and use their own config file for the bind port.
      setProxyPort(dir, payload.serverType, payload.port)
    } else {
      if (payload.eulaAccepted) writeEula(dir, true)
      setServerProperties(dir, { 'server-port': payload.port })
    }

    instance = {
      id,
      name: payload.name,
      serverType: payload.serverType,
      mcVersion: payload.mcVersion,
      build: payload.build,
      launchKind: result.launchKind,
      launchJar: result.launchJar,
      port: payload.port,
      ramMB: payload.ramMB,
      javaPath: payload.javaPath,
      jvmArgs: payload.jvmArgs,
      eulaAccepted: payload.eulaAccepted,
      createdAt: Date.now()
    }
  } catch (err) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best-effort cleanup of the orphan folder */
    }
    throw err
  }

  writeInstance(root, instance)
  const index = addInstanceMeta(root, {
    id,
    name: instance.name,
    groupId: payload.groupId ?? null
  })
  send({ phase: 'done' })
  return { instance, index }
}

/** The lowest port at or above 25565 that no existing server is bound to. */
export function nextFreePort(root: string): number {
  const taken = new Set(
    readIndex(root)
      .instances.map((m) => readInstance(root, m.id)?.port)
      .filter((p): p is number => typeof p === 'number')
  )
  let port = 25565
  while (taken.has(port)) port++
  return port
}

/**
 * Pick a Java runtime able to run `mcVersion` — the configured default when it
 * qualifies, otherwise any detected install, downloading a managed Temurin JRE
 * as a last resort. Used when a caller (an automation, not the wizard) doesn't
 * name a runtime itself.
 */
async function pickJava(mcVersion: string): Promise<string> {
  const required = requiredJavaMajor(mcVersion)
  const installs = await listJava()
  const preferred = getConfig().defaultJavaPath
  const fits = installs.filter((j) => javaSatisfies(j.major, required))
  const chosen = fits.find((j) => j.path === preferred) ?? fits[0]
  if (chosen) return chosen.path
  const downloaded = await ensureJava(required)
  invalidateJavaCache() // a new managed runtime is now on disk
  return downloaded.path
}

/**
 * Fill in everything a create payload doesn't specify: latest game version and
 * build for the software, a free port, the configured RAM default, and a Java
 * runtime that matches the game version.
 */
export async function resolveCreateDefaults(
  root: string,
  opts: PartialCreatePayload
): Promise<CreateInstancePayload> {
  const provider = getProvider(opts.serverType)

  let mcVersion = opts.mcVersion
  if (!mcVersion) {
    const versions = await provider.listGameVersions()
    mcVersion = versions[0]
    if (!mcVersion) throw new Error(`No game versions available for "${opts.serverType}"`)
  }

  let build = opts.build
  if (!build) {
    const builds = await provider.listBuilds(mcVersion)
    build = builds[0]?.id
    if (!build) throw new Error(`No builds available for ${opts.serverType} ${mcVersion}`)
  }

  return {
    name: opts.name,
    serverType: opts.serverType as ServerType,
    mcVersion,
    build,
    port: opts.port ?? nextFreePort(root),
    ramMB: opts.ramMB ?? getConfig().defaultRamMB,
    javaPath: opts.javaPath ?? (await pickJava(mcVersion)),
    jvmArgs: opts.jvmArgs ?? [],
    eulaAccepted: opts.eulaAccepted ?? false,
    groupId: opts.groupId ?? null
  }
}
