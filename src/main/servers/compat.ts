import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { CompatCell, CompatRun, CompatRunOptions, Instance, ServerStatus } from '@shared/types'
import { readInstance, instanceDir } from '../store/instances'
import * as servers from './registry'
import { serverEvents, setQuiet } from './registry'
import { scanStartupIssues, evaluateSmoke } from './compat-scan'

/**
 * Compatibility runs: boot each server of a test matrix in turn, wait for the ready
 * line, scan startup output for plugin/mod load failures, fire optional smoke
 * commands, then stop it and grade the result. One run at a time, sequential boots
 * (so RAM use stays at one server's worth), progress broadcast to the renderer.
 */

const DEFAULT_READY_TIMEOUT_MS = 180_000
/** Grace period after the ready line so late async load errors still land in the scan. */
const SETTLE_MS = 1500
/** How long to collect console output after sending a smoke command. */
const SMOKE_WINDOW_MS = 4000
/** Cap on waiting for a graceful stop (the registry force-kills at 12s). */
const STOP_TIMEOUT_MS = 20_000

let current: CompatRun | null = null
let cancelled = false

type StartOutcome =
  | { kind: 'ready' }
  | { kind: 'exit'; code: number | null }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }

export function getCompatRun(): CompatRun | null {
  return current
}

export function cancelCompatRun(): void {
  if (current?.state === 'running') cancelled = true
}

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('compat:progress', current)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Start a run and return its initial snapshot; cells fill in via compat:progress events. */
export function startCompatRun(root: string, instanceIds: string[], opts: CompatRunOptions): CompatRun {
  if (current?.state === 'running') throw new Error('A compatibility run is already in progress.')
  cancelled = false
  const cells: CompatCell[] = instanceIds.map((id) => {
    const inst = readInstance(root, id)
    return {
      instanceId: id,
      name: inst?.name ?? id,
      mcVersion: inst?.mcVersion ?? '?',
      status: 'queued',
      issues: [],
      smoke: []
    }
  })
  current = {
    id: randomUUID(),
    startedAt: Date.now(),
    state: 'running',
    readyTimeoutMs: opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
    smokeCommands: (opts.smokeCommands ?? []).map((c) => c.trim()).filter(Boolean),
    cells
  }
  void runAll(root, current)
  return current
}

async function runAll(root: string, run: CompatRun): Promise<void> {
  for (const cell of run.cells) {
    if (cancelled) {
      cell.status = 'skipped'
      cell.message = 'Cancelled'
      continue
    }
    try {
      await runCell(root, run, cell)
    } catch (err) {
      cell.status = 'fail'
      cell.message = err instanceof Error ? err.message : String(err)
    }
    broadcast()
  }
  run.state = cancelled ? 'cancelled' : 'done'
  broadcast()
}

async function runCell(root: string, run: CompatRun, cell: CompatCell): Promise<void> {
  const inst = readInstance(root, cell.instanceId)
  if (!inst) {
    cell.status = 'fail'
    cell.message = 'Server no longer exists'
    return
  }
  if (servers.isRunning(inst.id)) {
    cell.status = 'skipped'
    cell.message = 'Already running — stop it first'
    return
  }

  const dir = instanceDir(root, inst.id)
  let output = ''
  const onOutput = (e: { id: string; chunk: string }): void => {
    if (e.id === inst.id) output += e.chunk
  }
  serverEvents.on('output', onOutput)
  setQuiet(inst.id, true)
  cell.status = 'starting'
  broadcast()

  const t0 = Date.now()
  try {
    const outcome = await startAndAwaitReady(inst, dir, run.readyTimeoutMs)

    if (outcome.kind === 'cancelled') {
      await stopAndWait(inst.id)
      cell.status = 'skipped'
      cell.message = 'Cancelled'
      return
    }
    if (outcome.kind === 'exit') {
      cell.status = 'fail'
      cell.exitCode = outcome.code
      cell.message = `Exited during startup (code ${outcome.code ?? 'unknown'})`
      cell.issues = scanStartupIssues(output)
      return
    }
    if (outcome.kind === 'timeout') {
      await stopAndWait(inst.id)
      cell.status = 'fail'
      cell.message = `Not ready after ${Math.round(run.readyTimeoutMs / 1000)}s`
      cell.issues = scanStartupIssues(output)
      return
    }

    cell.readyMs = Date.now() - t0
    await sleep(SETTLE_MS)

    if (!cancelled && run.smokeCommands.length) {
      cell.status = 'testing'
      broadcast()
      for (const command of run.smokeCommands) {
        if (cancelled) break
        const before = output.length
        servers.sendCommand(inst.id, command)
        await sleep(SMOKE_WINDOW_MS)
        const graded = evaluateSmoke(output.slice(before))
        cell.smoke.push({ command, ok: graded.ok, output: graded.excerpt })
        broadcast()
      }
    }

    cell.issues = scanStartupIssues(output)
    cell.status = 'stopping'
    broadcast()
    await stopAndWait(inst.id)

    const hasErrors = cell.issues.some((i) => i.severity === 'error')
    const smokeFailed = cell.smoke.some((s) => !s.ok)
    if (hasErrors) {
      cell.status = 'fail'
      cell.message = 'Errors during startup'
    } else if (smokeFailed) {
      cell.status = 'fail'
      cell.message = 'Smoke command failed'
    } else if (cell.issues.length) {
      cell.status = 'warn'
      cell.message = 'Started with warnings'
    } else {
      cell.status = 'pass'
      cell.message = `Ready in ${(cell.readyMs / 1000).toFixed(1)}s`
    }
  } finally {
    serverEvents.off('output', onOutput)
    setQuiet(inst.id, false)
    // Safety net — a compat run must never leave a test server behind.
    if (servers.isRunning(inst.id)) servers.stop(inst.id)
  }
}

/** Launch a server and resolve on ready line, early exit, timeout, or run cancellation. */
function startAndAwaitReady(inst: Instance, dir: string, timeoutMs: number): Promise<StartOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (v: StartOutcome): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(v)
    }
    const onStatus = (e: { id: string; status: ServerStatus }): void => {
      if (e.id !== inst.id) return
      if (e.status === 'running') finish({ kind: 'ready' })
      // Launch failures never spawn a child, so no 'closed' event follows — catch them here.
      else if (e.status === 'stopped') finish({ kind: 'exit', code: null })
    }
    const onClosed = (e: { id: string; code: number | null }): void => {
      if (e.id === inst.id) finish({ kind: 'exit', code: e.code })
    }
    const timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs)
    const cancelPoll = setInterval(() => {
      if (cancelled) finish({ kind: 'cancelled' })
    }, 500)
    const cleanup = (): void => {
      clearTimeout(timer)
      clearInterval(cancelPoll)
      serverEvents.off('status', onStatus)
      serverEvents.off('closed', onClosed)
    }
    serverEvents.on('status', onStatus)
    serverEvents.on('closed', onClosed)
    servers.start(inst, dir)
  })
}

/** Gracefully stop a server and wait for it to fully exit (bounded). */
function stopAndWait(id: string): Promise<void> {
  if (!servers.isRunning(id)) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      serverEvents.off('status', onStatus)
      resolve()
    }
    const onStatus = (e: { id: string; status: ServerStatus }): void => {
      if (e.id === id && e.status === 'stopped') done()
    }
    const timer = setTimeout(done, STOP_TIMEOUT_MS)
    serverEvents.on('status', onStatus)
    servers.stop(id)
  })
}
