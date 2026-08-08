/**
 * Message protocol between the main process (runner.ts) and a process-isolated
 * plugin (bootstrap.ts) over the utilityProcess message channel.
 *
 * The child gets a proxy PluginContext whose method calls become 'call'
 * messages; subscriptions, renderer-IPC handlers, and provider registrations
 * flow the other way as host-initiated 'invoke' messages.
 */

/** Provider shapes that survive serialization (methods are invoked back over RPC). */
export interface ContentSourceDescriptor {
  id: string
  label: string
  kinds: ('plugins' | 'mods')[]
}

export interface SoftwareProviderDescriptor {
  id: string
}

export type HostToPluginMessage =
  | {
      type: 'init'
      pluginId: string
      dir: string
      /** Absolute path of the entry file to require. */
      entry: string
      appVersion: string
    }
  | { type: 'result'; callId: number; ok: boolean; value?: unknown; error?: string }
  | { type: 'event'; subId: number; payload: unknown }
  | {
      type: 'invoke'
      callId: number
      kind: 'ipc' | 'content' | 'software'
      /** ipc: the verb; providers: the provider id. */
      name: string
      /** Provider method (search/resolve/listGameVersions/…). Unused for ipc. */
      method?: string
      args: unknown[]
    }
  | { type: 'shutdown' }

export type PluginToHostMessage =
  | { type: 'ready' }
  | { type: 'activate-error'; message: string }
  | { type: 'call'; callId: number; path: string; args: unknown[] }
  | { type: 'subscribe'; subId: number; path: string }
  | { type: 'unsubscribe'; subId: number }
  | { type: 'ipc-register'; verb: string }
  | {
      type: 'provider-register'
      kind: 'content' | 'software'
      descriptor: ContentSourceDescriptor | SoftwareProviderDescriptor
    }
  | { type: 'result'; callId: number; ok: boolean; value?: unknown; error?: string }
