import type { TunnelProviderStatus } from '@shared/types'
import type { TunnelProvider } from './types'
import { birdflopProvider } from './birdflop'
import { boreProvider } from './bore'
import { ngrokProvider } from './ngrok'

/**
 * Open registry of tunnel providers, keyed by provider id. Built-ins register
 * below (Birdflop first — it's the default self-hosted relay giving each user a
 * stable subdomain; bore.pub is the no-account fallback; ngrok needs a token and
 * a card for TCP). App plugins can add providers at activation.
 */
const providers = new Map<string, TunnelProvider>()

/** Register (or replace) a tunnel provider. */
export function registerTunnelProvider(provider: TunnelProvider): void {
  providers.set(provider.id, provider)
}

/** Remove a registered tunnel provider (plugin deactivation). No-op for unknown ids. */
export function unregisterTunnelProvider(id: string): void {
  providers.delete(id)
}

export function getTunnelProvider(id: string): TunnelProvider {
  const provider = providers.get(id)
  if (!provider) throw new Error(`No tunnel provider "${id}"`)
  return provider
}

/** Availability of every provider, for the picker. */
export function listProviderStatuses(): Promise<TunnelProviderStatus[]> {
  return Promise.all([...providers.values()].map((p) => p.status()))
}

for (const p of [birdflopProvider, boreProvider, ngrokProvider]) registerTunnelProvider(p)
