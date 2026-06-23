import type { TunnelProviderId, TunnelProviderStatus } from '@shared/types'
import type { TunnelProvider } from './types'
import { boreProvider } from './bore'
import { ngrokProvider } from './ngrok'

// bore first — it's the free, no-account default; ngrok needs a token (and a card for TCP).
const PROVIDERS: Record<TunnelProviderId, TunnelProvider> = {
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
