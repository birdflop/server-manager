import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type {
  InstallProgress,
  Instance,
  ManagerIndex,
  RecipeImportPayload,
  ServerRecipe
} from '@shared/types'
import { isProxy, SERVER_TYPE_MAP, contentKindOf } from '@shared/software'
import { readInstance, writeInstance, addInstanceMeta, instanceDir } from './store/instances'
import { getProvider } from './software'
import { installServer } from './servers/install'
import { writeEula, setServerProperties, readServerProperties, setProxyPort } from './servers/properties'
import { listContent, contentMeta, contentInstall } from './servers/content'

/**
 * Server recipes: a small shareable JSON file describing a server environment —
 * software + version, tracked plugins/mods, and config overrides — so someone else
 * (or future you) can reproduce it with one import. No world data, no secrets.
 */

/** server.properties keys that are machine-specific or secret — never exported. */
const EXCLUDED_PROPS = new Set([
  'server-port',
  'server-ip',
  'enable-rcon',
  'rcon.port',
  'rcon.password',
  'broadcast-rcon-to-ops',
  'query.port',
  'level-name'
])

export function buildRecipe(root: string, id: string): ServerRecipe {
  const inst = readInstance(root, id)
  if (!inst) throw new Error('Server not found')

  const properties: Record<string, string> = {}
  if (!isProxy(inst.serverType)) {
    for (const [key, value] of Object.entries(readServerProperties(instanceDir(root, id)))) {
      if (!EXCLUDED_PROPS.has(key)) properties[key] = value
    }
  }

  const meta = contentMeta(root, id)
  const content: ServerRecipe['content'] = []
  const untracked: string[] = []
  for (const file of listContent(root, id)) {
    const m = meta[file.name]
    if (m) {
      content.push({
        source: m.source,
        projectId: m.projectId,
        name: file.name,
        versionNumber: m.versionNumber
      })
    } else {
      untracked.push(file.name)
    }
  }

  return {
    format: 1,
    name: inst.name,
    serverType: inst.serverType,
    mcVersion: inst.mcVersion,
    build: inst.build,
    ramMB: inst.ramMB,
    jvmArgs: inst.jvmArgs,
    properties,
    content,
    untracked
  }
}

export function writeRecipe(root: string, id: string, outPath: string): void {
  writeFileSync(outPath, JSON.stringify(buildRecipe(root, id), null, 2), 'utf-8')
}

export function readRecipe(path: string): ServerRecipe {
  let parsed: ServerRecipe
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as ServerRecipe
  } catch {
    throw new Error('That file isn’t a valid recipe.')
  }
  if (parsed.format !== 1 || !parsed.serverType || !parsed.mcVersion) {
    throw new Error('Unsupported or corrupt recipe file.')
  }
  if (!SERVER_TYPE_MAP[parsed.serverType]) {
    throw new Error(`Unknown server type "${parsed.serverType}" in recipe.`)
  }
  return parsed
}

/** Create + install a new server from a recipe. Reports progress via `send`. */
export async function importRecipe(
  root: string,
  payload: RecipeImportPayload,
  send: (p: InstallProgress) => void
): Promise<{ instance: Instance; index: ManagerIndex; warnings: string[] }> {
  const recipe = readRecipe(payload.path)
  const warnings: string[] = []
  const id = randomUUID()
  const dir = instanceDir(root, id)
  mkdirSync(dir, { recursive: true })

  send({ phase: 'resolve' })
  const provider = getProvider(recipe.serverType)
  let build = recipe.build
  let spec
  try {
    spec = await provider.resolveInstall(recipe.mcVersion, build)
  } catch {
    // The recipe's exact build may have been rotated out — fall back to the latest.
    const builds = await provider.listBuilds(recipe.mcVersion)
    if (!builds.length) throw new Error(`No ${recipe.serverType} build available for ${recipe.mcVersion}.`)
    build = builds[0].id
    spec = await provider.resolveInstall(recipe.mcVersion, build)
    warnings.push(`Build ${recipe.build} is no longer available — used ${build} instead.`)
  }
  const result = await installServer(dir, spec, payload.javaPath, send)

  send({ phase: 'configure' })
  if (isProxy(recipe.serverType)) {
    setProxyPort(dir, recipe.serverType, payload.port)
  } else {
    if (payload.eulaAccepted) writeEula(dir, true)
    setServerProperties(dir, { ...recipe.properties, 'server-port': payload.port })
  }

  const instance: Instance = {
    id,
    name: payload.name,
    serverType: recipe.serverType,
    mcVersion: recipe.mcVersion,
    build,
    launchKind: result.launchKind,
    launchJar: result.launchJar,
    port: payload.port,
    ramMB: payload.ramMB,
    javaPath: payload.javaPath,
    jvmArgs: recipe.jvmArgs ?? [],
    eulaAccepted: payload.eulaAccepted,
    createdAt: Date.now()
  }
  writeInstance(root, instance)
  const index = addInstanceMeta(root, { id, name: instance.name, groupId: payload.groupId ?? null })

  // Reinstall tracked content from its source (latest compatible version).
  if (contentKindOf(recipe.serverType) !== 'none') {
    for (const item of recipe.content ?? []) {
      send({ phase: 'download', message: `Installing ${item.name}…` })
      try {
        await contentInstall(root, id, item.source, item.projectId)
      } catch (err) {
        warnings.push(`Couldn't install ${item.name}: ${(err as Error).message}`)
      }
    }
  }
  for (const name of recipe.untracked ?? []) {
    warnings.push(`${name} was added manually on the original server — add it yourself.`)
  }

  send({ phase: 'done' })
  return { instance, index, warnings }
}
