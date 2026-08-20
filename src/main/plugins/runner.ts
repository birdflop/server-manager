import { app, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { Build, ContentSearchHit } from '@shared/types'
import type { ResolvedContentDownload } from '../content/types'
import type { InstallSpec } from '../software/types'
import { createPluginContext } from './context'
import { createPluginLogger } from './log'
import type { PluginManifest } from './manifest'
import type {
  ContentSourceDescriptor,
  HostToPluginMessage,
  PluginToHostMessage,
  SoftwareProviderDescriptor
} from './rpc'

/** How long the child gets to load + activate before the plugin is failed. */
const READY_TIMEOUT_MS = 10_000
/** Grace period between the shutdown message and a hard kill. */
const SHUTDOWN_GRACE_MS = 3_000

export interface PluginProcessHandle {
  stop(): void
}

/** Context method paths the child may call directly. */
const CALLABLE = /^(servers|groups|storage|log|software)\.[a-zA-Z]+$/

/**
 * Methods that look callable but take live callbacks or objects that can't cross
 * the bridge — they have their own message types (subscribe/provider-register).
 */
const BRIDGE_EXCLUDED = new Set(['servers.onEvent', 'software.registerProvider'])

/**
 * Fork a plugin into an Electron utilityProcess and bridge its PluginContext
 * over the message channel. The real context lives here in the main process —
 * the child only ever sees a proxy — so permission checks and registration
 * cleanup work exactly like inline plugins.
 */
export function startPluginProcess(
  manifest: PluginManifest,
  dir: string,
  onCrash?: (message: string) => void
): Promise<PluginProcessHandle> {
  const log = createPluginLogger(manifest.id)
  const handle = createPluginContext(manifest)
  handle.ctx.plugin.dir = dir

  const child: UtilityProcess = utilityProcess.fork(
    join(__dirname, 'plugin-bootstrap.js'),
    [],
    { serviceName: `bsm-plugin-${manifest.id}` }
  )

  // Host-initiated calls into the child (renderer IPC + provider methods).
  let nextCallId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const subscriptions = new Map<number, () => void>()
  let stopped = false

  function post(msg: HostToPluginMessage): void {
    try {
      child.postMessage(msg)
    } catch {
      /* child already gone */
    }
  }

  function invokeChild(
    kind: 'ipc' | 'content' | 'software',
    name: string,
    method: string | undefined,
    args: unknown[]
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const callId = nextCallId++
      pending.set(callId, { resolve, reject })
      post({ type: 'invoke', callId, kind, name, method, args })
    })
  }

  function teardown(): void {
    for (const p of pending.values()) p.reject(new Error('Plugin process stopped'))
    pending.clear()
    subscriptions.clear()
    handle.dispose()
  }

  /** Dispatch a child → host context call against the real context. */
  async function dispatchCall(path: string, args: unknown[]): Promise<unknown> {
    if (path === 'ipc.broadcast') {
      handle.ctx.ipc.broadcast(args[0] as string, args[1])
      return undefined
    }
    if (!CALLABLE.test(path) || BRIDGE_EXCLUDED.has(path)) {
      throw new Error(`"${path}" can't be called over the plugin bridge`)
    }
    const [group, method] = path.split('.') as [
      'servers' | 'groups' | 'storage' | 'log' | 'software',
      string
    ]
    const api = handle.ctx[group] as unknown as Record<string, (...a: unknown[]) => unknown>
    const fn = api[method]
    if (typeof fn !== 'function') throw new Error(`Unknown context method "${path}"`)
    return fn(...args)
  }

  function onMessage(msg: PluginToHostMessage, markReady: () => void, failReady: (e: Error) => void): void {
    switch (msg.type) {
      case 'ready':
        markReady()
        break
      case 'activate-error':
        failReady(new Error(msg.message))
        break
      case 'call':
        void dispatchCall(msg.path, msg.args)
          .then((value) => post({ type: 'result', callId: msg.callId, ok: true, value }))
          .catch((err: Error) =>
            post({ type: 'result', callId: msg.callId, ok: false, error: err.message })
          )
        break
      case 'subscribe': {
        if (msg.path !== 'servers.onEvent') break
        try {
          const unsub = handle.ctx.servers.onEvent((payload) =>
            post({ type: 'event', subId: msg.subId, payload })
          )
          subscriptions.set(msg.subId, unsub)
        } catch (err) {
          log.error(`subscribe failed: ${(err as Error).message}`)
        }
        break
      }
      case 'unsubscribe':
        subscriptions.get(msg.subId)?.()
        subscriptions.delete(msg.subId)
        break
      case 'ipc-register':
        handle.ctx.ipc.handle(msg.verb, (...args) => invokeChild('ipc', msg.verb, undefined, args))
        break
      case 'provider-register':
        if (msg.kind === 'content') {
          const d = msg.descriptor as ContentSourceDescriptor
          handle.ctx.content.registerSource({
            id: d.id,
            label: d.label,
            kinds: d.kinds,
            search: (query, ctx) =>
              invokeChild('content', d.id, 'search', [query, ctx]) as Promise<ContentSearchHit[]>,
            resolve: (projectId, ctx) =>
              invokeChild('content', d.id, 'resolve', [projectId, ctx]) as Promise<ResolvedContentDownload>
          })
        } else {
          const d = msg.descriptor as SoftwareProviderDescriptor
          handle.ctx.software.registerProvider({
            id: d.id,
            listGameVersions: () =>
              invokeChild('software', d.id, 'listGameVersions', []) as Promise<string[]>,
            listBuilds: (mc) => invokeChild('software', d.id, 'listBuilds', [mc]) as Promise<Build[]>,
            resolveInstall: (mc, buildId) =>
              invokeChild('software', d.id, 'resolveInstall', [mc, buildId]) as Promise<InstallSpec>
          })
        }
        break
      case 'result': {
        const p = pending.get(msg.callId)
        if (!p) break
        pending.delete(msg.callId)
        if (msg.ok) p.resolve(msg.value)
        else p.reject(new Error(msg.error ?? 'Plugin call failed'))
        break
      }
    }
  }

  return new Promise<PluginProcessHandle>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      teardown()
      reject(new Error(`plugin process didn't become ready within ${READY_TIMEOUT_MS / 1000}s`))
    }, READY_TIMEOUT_MS)

    const markReady = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        stop: () => {
          stopped = true
          post({ type: 'shutdown' })
          setTimeout(() => {
            try {
              child.kill()
            } catch {
              /* already exited */
            }
          }, SHUTDOWN_GRACE_MS)
          teardown()
        }
      })
    }
    const failReady = (err: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      teardown()
      reject(err)
    }

    child.on('message', (msg: PluginToHostMessage) => onMessage(msg, markReady, failReady))
    child.on('exit', (code) => {
      if (!settled) {
        failReady(new Error(`plugin process exited during startup (code ${code})`))
        return
      }
      if (!stopped) {
        log.error(`plugin process exited unexpectedly (code ${code})`)
        teardown()
        onCrash?.(`plugin process exited unexpectedly (code ${code})`)
      }
    })

    post({
      type: 'init',
      pluginId: manifest.id,
      dir,
      entry: join(dir, manifest.main),
      appVersion: app.getVersion()
    })
  })
}
