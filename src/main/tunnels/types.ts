import type {
  BirdflopTunnelIdentity,
  TunnelInfo,
  TunnelProviderId,
  TunnelProviderStatus
} from '@shared/types'

/** A live tunnel that can be torn down. */
export interface TunnelHandle {
  stop(): void
}

/** Extra, provider-specific inputs for starting a tunnel (ignored by providers that don't need them). */
export interface TunnelStartOptions {
  /** Public port to expose (Birdflop). Defaults to the forwarded local port. */
  publicPort?: number
  /** Optional sub-label, e.g. "survival" (Birdflop). */
  label?: string
  /** Existing identity to authenticate with (Birdflop). Null/undefined = enroll a new one. */
  identity?: BirdflopTunnelIdentity | null
  /** Called when the relay issues a brand-new identity, so the caller can persist it. */
  onIdentity?: (identity: BirdflopTunnelIdentity) => void
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
   * `opts` carries provider-specific inputs (e.g. Birdflop identity/label).
   */
  start(
    port: number,
    onUpdate: (info: TunnelInfo) => void,
    opts?: TunnelStartOptions
  ): Promise<TunnelHandle>
}
