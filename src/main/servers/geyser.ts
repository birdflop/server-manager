import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import type { BedrockStatus, ServerType } from '@shared/types'
import { instanceDir, readInstance } from '../store/instances'
import { listContent, contentInstall } from './content'

/**
 * One-click Bedrock crossplay: install GeyserMC (+ Floodgate where available) from
 * Modrinth so Bedrock/phone players can join a Java test server. Geyser listens on
 * its own UDP port (default 19132), so we surface the LAN address to join from a
 * phone on the same network. (TCP tunnels can't carry Bedrock's UDP traffic.)
 */

const DEFAULT_BEDROCK_PORT = 19132

/** Server types Geyser publishes builds for on Modrinth. */
const GEYSER_TYPES = new Set<ServerType>([
  'paper',
  'purpur',
  'folia',
  'fabric',
  'neoforge',
  'velocity',
  'bungeecord',
  'waterfall'
])

/** Floodgate (join without a Java account) ships for the plugin platforms. */
const FLOODGATE_TYPES = new Set<ServerType>(['paper', 'purpur', 'folia', 'velocity', 'bungeecord', 'waterfall'])

/** Places the Geyser config can live, per platform. */
const CONFIG_PATHS = [
  'plugins/Geyser-Spigot/config.yml',
  'plugins/Geyser-Velocity/config.yml',
  'plugins/Geyser-BungeeCord/config.yml',
  'plugins/geyser/config.yml',
  'config/Geyser-Fabric/config.yml',
  'config/Geyser-NeoForge/config.yml',
  'config/geyser/config.yml'
]

/** The Bedrock UDP port from Geyser's config, or the default before first run. */
function bedrockPort(dir: string): number {
  for (const rel of CONFIG_PATHS) {
    const path = join(dir, rel)
    if (!existsSync(path)) continue
    try {
      const m = readFileSync(path, 'utf-8').match(/bedrock:[\s\S]*?\bport:\s*(\d+)/)
      if (m) return Number(m[1])
    } catch {
      /* unreadable — fall through to default */
    }
  }
  return DEFAULT_BEDROCK_PORT
}

/** First non-internal IPv4 on the machine, for "join from your phone" instructions. */
function lanIp(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return null
}

export function getBedrockStatus(root: string, id: string): BedrockStatus {
  const inst = readInstance(root, id)
  if (!inst || !GEYSER_TYPES.has(inst.serverType)) {
    return { supported: false, installed: false, floodgate: false, port: DEFAULT_BEDROCK_PORT, lanAddress: null }
  }
  const files = listContent(root, id).map((f) => f.name.toLowerCase())
  const installed = files.some((f) => f.includes('geyser'))
  const floodgate = files.some((f) => f.includes('floodgate'))
  const port = bedrockPort(instanceDir(root, id))
  const ip = lanIp()
  return {
    supported: true,
    installed,
    floodgate,
    port,
    lanAddress: ip ? `${ip}:${port}` : null
  }
}

/** Install Geyser (+ Floodgate where available). Returns the new status + any soft failure. */
export async function installBedrock(
  root: string,
  id: string
): Promise<{ status: BedrockStatus; warning?: string }> {
  const inst = readInstance(root, id)
  if (!inst) throw new Error('Server not found')
  if (!GEYSER_TYPES.has(inst.serverType)) {
    throw new Error('Geyser has no build for this server type.')
  }

  await contentInstall(root, id, 'modrinth', 'geyser')

  let warning: string | undefined
  if (FLOODGATE_TYPES.has(inst.serverType)) {
    try {
      await contentInstall(root, id, 'modrinth', 'floodgate')
    } catch (err) {
      warning = `Geyser installed, but Floodgate failed: ${(err as Error).message}. Bedrock players will need a linked Java account.`
    }
  } else {
    warning = 'Floodgate isn’t available for this platform — Bedrock players need a Java account.'
  }
  return { status: getBedrockStatus(root, id), warning }
}
