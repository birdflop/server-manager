import type { ServerProvider } from './types'
import { paper } from './paper'
import { folia } from './folia'
import { purpur } from './purpur'
import { vanilla } from './vanilla'
import { fabric } from './fabric'
import { quilt } from './quilt'
import { forge } from './forge'
import { neoforge } from './neoforge'
import { velocity } from './velocity'
import { waterfall } from './waterfall'
import { bungeecord } from './bungeecord'

/**
 * Open registry of server-software providers, keyed by provider id. Built-ins
 * register below; app plugins can add or override providers at activation.
 */
const providers = new Map<string, ServerProvider>()

/** Register (or replace) a server-software provider. */
export function registerServerProvider(provider: ServerProvider): void {
  providers.set(provider.id, provider)
}

/** Remove a registered provider (plugin deactivation). No-op for unknown ids. */
export function unregisterServerProvider(id: string): void {
  providers.delete(id)
}

export function getProvider(type: string): ServerProvider {
  const provider = providers.get(type)
  if (!provider) throw new Error(`No provider for server type "${type}"`)
  return provider
}

/** Every registered provider (built-ins + plugin-registered). */
export function listServerProviders(): ServerProvider[] {
  return [...providers.values()]
}

for (const p of [
  paper,
  folia,
  purpur,
  vanilla,
  fabric,
  quilt,
  forge,
  neoforge,
  velocity,
  waterfall,
  bungeecord
]) {
  registerServerProvider(p)
}
