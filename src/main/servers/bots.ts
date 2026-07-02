import { BrowserWindow } from 'electron'
import type { Bot } from 'mineflayer'
import type { BotsOptions, BotsStatusEvent, Instance } from '@shared/types'
import { readServerProperties } from './properties'
import { instanceDir } from '../store/instances'
import { serverEvents } from './registry'

/**
 * Fake-player load testing: spawn N mineflayer bots that join the local server,
 * wander around, and chat, so plugins can be tested under real player load without
 * rounding up 20 friends. Offline-mode only (bots have no Mojang accounts); joins
 * are staggered so the login queue isn't hammered.
 */

const MAX_BOTS = 100
const JOIN_STAGGER_MS = 600
const MOVE_TICK_MS = 2500

interface Session {
  bots: Bot[]
  timers: ReturnType<typeof setTimeout>[]
  target: number
  connected: number
  stopping: boolean
  message?: string
}

const sessions = new Map<string, Session>()

function broadcast(id: string): void {
  const s = sessions.get(id)
  const event: BotsStatusEvent = {
    id,
    running: !!s,
    target: s?.target ?? 0,
    connected: s?.connected ?? 0,
    message: s?.message
  }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('bots:status', event)
}

export function botsStatus(id: string): BotsStatusEvent {
  const s = sessions.get(id)
  return {
    id,
    running: !!s,
    target: s?.target ?? 0,
    connected: s?.connected ?? 0,
    message: s?.message
  }
}

export async function startBots(root: string, instance: Instance, opts: BotsOptions): Promise<void> {
  if (sessions.has(instance.id)) throw new Error('Bots are already connected to this server.')

  const props = readServerProperties(instanceDir(root, instance.id))
  if ((props['online-mode'] ?? 'true').trim() !== 'false') {
    throw new Error(
      'Bots can only join offline-mode servers. Set online-mode=false in Properties, restart, and try again.'
    )
  }

  const count = Math.min(MAX_BOTS, Math.max(1, Math.round(opts.count)))
  // Loaded lazily — mineflayer is a hefty dependency and most sessions never use bots.
  const mineflayer = await import('mineflayer')

  const session: Session = { bots: [], timers: [], target: count, connected: 0, stopping: false }
  sessions.set(instance.id, session)
  broadcast(instance.id)

  for (let i = 0; i < count; i++) {
    session.timers.push(
      setTimeout(() => spawnBot(mineflayer, session, instance, i, opts), i * JOIN_STAGGER_MS)
    )
  }
}

function spawnBot(
  mineflayer: typeof import('mineflayer'),
  session: Session,
  instance: Instance,
  index: number,
  opts: BotsOptions
): void {
  if (session.stopping) return
  let bot: Bot
  try {
    bot = mineflayer.createBot({
      host: '127.0.0.1',
      port: instance.port,
      username: `TestBot_${index + 1}`,
      auth: 'offline',
      viewDistance: 'tiny',
      hideErrors: true
    })
  } catch (err) {
    session.message = (err as Error).message
    broadcast(instance.id)
    return
  }
  session.bots.push(bot)

  bot.once('spawn', () => {
    session.connected++
    session.message = undefined
    broadcast(instance.id)

    if (opts.move) {
      session.timers.push(
        setInterval(() => {
          try {
            // Random walk: new heading most ticks, occasional jumps and pauses.
            bot.look(Math.random() * Math.PI * 2, 0, false)
            bot.setControlState('forward', Math.random() > 0.2)
            bot.setControlState('jump', Math.random() > 0.8)
            bot.setControlState('sprint', Math.random() > 0.6)
          } catch {
            /* bot mid-disconnect */
          }
        }, MOVE_TICK_MS + Math.random() * 1000)
      )
    }
    if (opts.chat) {
      session.timers.push(
        setInterval(
          () => {
            try {
              bot.chat(`load test ping ${Math.floor(Math.random() * 1000)}`)
            } catch {
              /* bot mid-disconnect */
            }
          },
          15000 + Math.random() * 20000
        )
      )
    }
  })

  bot.on('kicked', (reason) => {
    session.message = `Kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`.slice(0, 200)
    broadcast(instance.id)
  })
  bot.on('error', (err) => {
    session.message = err.message?.slice(0, 200)
    broadcast(instance.id)
  })
  bot.on('end', () => {
    if (session.connected > 0) session.connected--
    if (!session.stopping) broadcast(instance.id)
  })
}

export function stopBots(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.stopping = true
  for (const t of session.timers) clearTimeout(t)
  for (const bot of session.bots) {
    try {
      bot.quit()
    } catch {
      /* already gone */
    }
  }
  sessions.delete(id)
  broadcast(id)
}

export function stopAllBots(): void {
  for (const id of [...sessions.keys()]) stopBots(id)
}

// Bots can't outlive their server.
serverEvents.on('status', ({ id, status }: { id: string; status: string }) => {
  if (status === 'stopping' || status === 'stopped') stopBots(id)
})
