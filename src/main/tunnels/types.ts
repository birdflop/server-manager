import type { TunnelInfo, TunnelProviderId, TunnelProviderStatus } from '@shared/types'

/** A live tunnel that can be torn down. */
export interface TunnelHandle {
  stop(): void
}

/**
 * A way to expose a local server (127.0.0.1:<port>) to the public internet.
 * Implementations (bore, ngrok, …) hide how the agent runs and how the public
 * address is discovered behind this interface — mirrors the software `getProvider` pattern.
 */
export interface TunnelProvider {
  id: TunnelProviderId
  label: string
  /** Current availability — whether a tunnel can be started right now, and what's missing. */
  status(): Promise<TunnelProviderStatus>
  /**
   * Open a tunnel to `127.0.0.1:<port>`, reporting state changes through `onUpdate`.
   * Resolves once the agent has been spawned (the tunnel may still be coming online).
   */
  start(port: number, onUpdate: (info: TunnelInfo) => void): Promise<TunnelHandle>
}
