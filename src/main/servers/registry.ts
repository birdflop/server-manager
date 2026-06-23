import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { BrowserWindow, Notification } from 'electron'
import pidusage from 'pidusage'
import type { Instance, ServerStatus } from '@shared/types'
import { readyPatternFor, stopCommandFor } from '@shared/software'
import { buildLaunch } from './launch'
import { diagnose } from './diagnose'
import { getConfig } from '../config'

interface Running {
  child: ChildProcessWithoutNullStreams
  status: ServerStatus
  buffer: string
  instance: Instance
  dir: string
  /** True when the user explicitly stopped/restarted (so close isn't treated as a crash). */
  userStopped: boolean
}

const running = new Map<string, Running>()
const MAX_BUFFER = 256 * 1024
let statsTimer: ReturnType<typeof setInterval> | null = null

function notify(title: string, body: string): void {
  if (!getConfig().notifications) return
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

/** Poll CPU/memory for every running server and broadcast it. */
function ensureStatsPolling(): void {
  if (statsTimer) return
  statsTimer = setInterval(() => {
    for (const [id, r] of running) {
      if (r.status === 'stopped' || !r.child.pid) continue
      pidusage(r.child.pid)
        .then((s) =>
          broadcast('server:stats', { id, cpu: Math.round(s.cpu), memMB: Math.round(s.memory / 1048576) })
        )
        .catch(() => {
          /* process may have just exited */
        })
    }
  }, 2000)
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

function setStatus(id: string, status: ServerStatus): void {
  const r = running.get(id)
  if (r) r.status = status
  broadcast('server:status', { id, status })
}

function appendOutput(id: string, chunk: string): void {
  const r = running.get(id)
  if (!r) return
  r.buffer += chunk
  if (r.buffer.length > MAX_BUFFER) r.buffer = r.buffer.slice(-MAX_BUFFER)
  broadcast('server:output', { id, chunk })
}

export function isRunning(id: string): boolean {
  const r = running.get(id)
  return !!r && r.status !== 'stopped'
}

export function statusOf(id: string): ServerStatus {
  return running.get(id)?.status ?? 'stopped'
}

export function bufferOf(id: string): string {
  return running.get(id)?.buffer ?? ''
}

export function clearBuffer(id: string): void {
  const r = running.get(id)
  if (r) r.buffer = ''
}

export function runningIds(): string[] {
  return [...running.entries()].filter(([, r]) => r.status !== 'stopped').map(([id]) => id)
}

export function start(instance: Instance, dir: string): void {
  if (isRunning(instance.id)) return

  let cmd
  try {
    cmd = buildLaunch(instance, dir)
  } catch (err) {
    const prev = running.get(instance.id)
    running.set(instance.id, {
      child: prev?.child as ChildProcessWithoutNullStreams,
      status: 'stopped',
      buffer: (prev?.buffer ?? '') + `\n[launch error] ${(err as Error).message}\n`,
      instance,
      dir,
      userStopped: true
    })
    broadcast('server:output', {
      id: instance.id,
      chunk: `\n[launch error] ${(err as Error).message}\n`
    })
    setStatus(instance.id, 'stopped')
    return
  }

  const child = spawn(cmd.command, cmd.args, { cwd: dir })
  const r: Running = {
    child,
    status: 'starting',
    buffer: running.get(instance.id)?.buffer ?? '',
    instance,
    dir,
    userStopped: false
  }
  running.set(instance.id, r)
  setStatus(instance.id, 'starting')
  ensureStatsPolling()

  const readyPattern = readyPatternFor(instance.serverType)
  const onData = (d: Buffer): void => {
    const text = d.toString()
    appendOutput(instance.id, text)
    if (r.status === 'starting' && readyPattern.test(text)) {
      setStatus(instance.id, 'running')
      notify(instance.name, 'Server is ready.')
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('error', (err) => {
    appendOutput(instance.id, `\n[process error] ${err.message}\n`)
    setStatus(instance.id, 'stopped')
  })
  child.on('close', (code) => {
    appendOutput(instance.id, `\n[process exited with code ${code ?? 'unknown'}]\n`)
    const crashed = !r.userStopped && code !== 0
    setStatus(instance.id, 'stopped')

    // Diagnose abnormal exits (even clean-code ones with a known fatal marker, e.g. EULA).
    if (!r.userStopped) {
      const dx = diagnose(r.buffer, code, instance)
      if (dx) {
        appendOutput(
          instance.id,
          `\n\x1b[33m── ${dx.title} ──\x1b[0m\n${dx.hint}\n`
        )
        broadcast('server:diagnosis', { id: instance.id, code, title: dx.title, hint: dx.hint })
      }
    }

    if (crashed) {
      notify(instance.name, `Server stopped unexpectedly (exit code ${code ?? 'unknown'}).`)
      if (getConfig().autoRestartOnCrash) {
        appendOutput(instance.id, '\n[auto-restarting after crash…]\n')
        setTimeout(() => start(instance, dir), 1500)
      }
    }
  })
}

export function sendCommand(id: string, command: string): void {
  const r = running.get(id)
  if (r && r.status !== 'stopped' && r.child.stdin.writable) {
    r.child.stdin.write(command.endsWith('\n') ? command : command + '\n')
  }
}

export function stop(id: string): void {
  const r = running.get(id)
  if (!r || r.status === 'stopped') return
  r.userStopped = true
  setStatus(id, 'stopping')
  try {
    if (r.child.stdin.writable) r.child.stdin.write(`${stopCommandFor(r.instance.serverType)}\n`)
  } catch {
    /* fall through to force-kill */
  }
  setTimeout(() => {
    if (running.get(id)?.status !== 'stopped') {
      try {
        r.child.kill()
      } catch {
        /* ignore */
      }
    }
  }, 12000)
}

export function restart(instance: Instance, dir: string): void {
  const r = running.get(instance.id)
  if (!r || r.status === 'stopped') {
    start(instance, dir)
    return
  }
  r.child.once('close', () => start(instance, dir))
  stop(instance.id)
}

/** Kill every running server (used on app quit). */
export function stopAll(): void {
  for (const [, r] of running) {
    try {
      r.child.kill()
    } catch {
      /* ignore */
    }
  }
}
