import type { TunnelProviderId, TunnelProviderStatus } from '@shared/types'
import type { TunnelProvider } from './types'
import { birdflopProvider } from './birdflop'
import { boreProvider } from './bore'
import { ngrokProvider } from './ngrok'

// Birdflop first — it's the default self-hosted relay giving each user a stable
// subdomain; bore.pub is the no-account fallback; ngrok needs a token (and a card for TCP).
const PROVIDERS: Record<TunnelProviderId, TunnelProvider> = {
  birdflop: birdflopProvider,
  bore: boreProvider,
  ngrok: ngrokProvider
}

export function getTunnelProvider(id: TunnelProviderId): TunnelProvider {
  return PROVIDERS[id]
}

/** Availability of every provider, for the picker. */
export function listProviderStatuses(): Promise<TunnelProviderStatus[]> {
  return Promise.all(Object.values(PROVIDERS).map((p) => p.status()))
}
