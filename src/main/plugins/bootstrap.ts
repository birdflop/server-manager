/**
 * Entry file forked as an Electron utilityProcess for plugins with
 * `"isolation": "process"`. Loads the plugin's entry module and hands it a
 * proxy PluginContext whose calls travel to the main process over the message
 * channel (see rpc.ts). No Electron APIs are available here — only Node.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type {
  ContentSourceDescriptor,
  HostToPluginMessage,
  PluginToHostMessage
} from './rpc'
import type { BirdflopPlugin, PluginContext, PluginServerEvent } from './api'

const port = process.parentPort

function post(msg: PluginToHostMessage): void {
  port.postMessage(msg)
}

let nextCallId = 1
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

/** Call a context method in the main process. */
function rpc(path: string, args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callId = nextCallId++
    pending.set(callId, { resolve, reject })
    post({ type: 'call', callId, path, args })
  })
}

let nextSubId = 1
const eventSubs = new Map<number, (event: PluginServerEvent) => void>()

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
/** `${kind}:${id}` → provider object with callable methods. */
const providers = new Map<string, Record<string, (...args: unknown[]) => unknown>>()

let plugin: BirdflopPlugin | null = null

function buildContext(pluginId: string, dir: string, appVersion: string): PluginContext {
  const call = (path: string) => (...args: unknown[]) => rpc(path, args)
  return {
    app: { version: appVersion },
    plugin: { id: pluginId, dir },
    servers: {
      list: call('servers.list') as PluginContext['servers']['list'],
      get: call('servers.get') as PluginContext['servers']['get'],
      status: call('servers.status') as PluginContext['servers']['status'],
      readConsole: call('servers.readConsole') as PluginContext['servers']['readConsole'],
      getPerformance: call('servers.getPerformance') as PluginContext['servers']['getPerformance'],
      start: call('servers.start') as PluginContext['servers']['start'],
      stop: call('servers.stop') as PluginContext['servers']['stop'],
      restart: call('servers.restart') as PluginContext['servers']['restart'],
      sendCommand: call('servers.sendCommand') as PluginContext['servers']['sendCommand'],
      onEvent: (cb) => {
        const subId = nextSubId++
        eventSubs.set(subId, cb)
        post({ type: 'subscribe', subId, path: 'servers.onEvent' })
        return () => {
          eventSubs.delete(subId)
          post({ type: 'unsubscribe', subId })
        }
      }
    },
    storage: {
      get: call('storage.get') as PluginContext['storage']['get'],
      set: call('storage.set') as PluginContext['storage']['set'],
      delete: call('storage.delete') as PluginContext['storage']['delete']
    },
    log: {
      info: (message) => void rpc('log.info', [message]).catch(() => {}),
      warn: (message) => void rpc('log.warn', [message]).catch(() => {}),
      error: (message) => void rpc('log.error', [message]).catch(() => {})
    },
    ipc: {
      handle: (verb, fn) => {
        ipcHandlers.set(verb, fn)
        post({ type: 'ipc-register', verb })
      },
      broadcast: (event, payload) => void rpc('ipc.broadcast', [event, payload]).catch(() => {})
    },
    content: {
      registerSource: (provider) => {
        providers.set(`content:${provider.id}`, provider as unknown as Record<string, (...args: unknown[]) => unknown>)
        const descriptor: ContentSourceDescriptor = {
          id: provider.id,
          label: provider.label,
          kinds: provider.kinds
        }
        post({ type: 'provider-register', kind: 'content', descriptor })
      }
    },
    software: {
      registerProvider: (provider) => {
        providers.set(`software:${provider.id}`, provider as unknown as Record<string, (...args: unknown[]) => unknown>)
        post({ type: 'provider-register', kind: 'software', descriptor: { id: provider.id } })
      }
    },
    tunnels: {
      registerProvider: () => {
        // Tunnel providers hold live callbacks + child processes that can't be
        // proxied over the bridge — run the plugin inline to provide one.
        throw new Error('tunnels.registerProvider is not available with "isolation": "process"')
      }
    }
  }
}

async function handleInvoke(
  msg: Extract<HostToPluginMessage, { type: 'invoke' }>
): Promise<unknown> {
  if (msg.kind === 'ipc') {
    const handler = ipcHandlers.get(msg.name)
    if (!handler) throw new Error(`No handler for "${msg.name}"`)
    return handler(...msg.args)
  }
  const provider = providers.get(`${msg.kind}:${msg.name}`)
  const method = msg.method ? provider?.[msg.method] : undefined
  if (!provider || typeof method !== 'function') {
    throw new Error(`No provider method "${msg.kind}:${msg.name}.${msg.method}"`)
  }
  return method.call(provider, ...msg.args)
}

port.on('message', (e: { data: HostToPluginMessage }) => {
  const msg = e.data
  switch (msg.type) {
    case 'init': {
      void (async () => {
        try {
          const req = createRequire(join(msg.dir, 'plugin.json'))
          const mod = req(msg.entry) as BirdflopPlugin | { default: BirdflopPlugin }
          plugin = ('default' in mod && mod.default ? mod.default : mod) as BirdflopPlugin
          if (typeof plugin.activate !== 'function') {
            throw new Error(`entry doesn't export an activate() function`)
          }
          await plugin.activate(buildContext(msg.pluginId, msg.dir, msg.appVersion))
          post({ type: 'ready' })
        } catch (err) {
          post({ type: 'activate-error', message: (err as Error).message })
        }
      })()
      break
    }
    case 'result': {
      const p = pending.get(msg.callId)
      if (!p) break
      pending.delete(msg.callId)
      if (msg.ok) p.resolve(msg.value)
      else p.reject(new Error(msg.error ?? 'Call failed'))
      break
    }
    case 'event': {
      for (const [subId, cb] of eventSubs) {
        if (subId === msg.subId) cb(msg.payload as PluginServerEvent)
      }
      break
    }
    case 'invoke':
      void handleInvoke(msg)
        .then((value) => post({ type: 'result', callId: msg.callId, ok: true, value }))
        .catch((err: Error) => post({ type: 'result', callId: msg.callId, ok: false, error: err.message }))
      break
    case 'shutdown':
      void (async () => {
        try {
          await plugin?.deactivate?.()
        } finally {
          process.exit(0)
        }
      })()
      break
  }
})
