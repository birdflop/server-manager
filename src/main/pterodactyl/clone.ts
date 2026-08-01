// Clone a remote panel server into a local instance: ask Wings to tar.gz the
// whole server, download that single archive, extract it into a fresh instance
// folder, and register it — a 1:1 local test copy without per-file transfers.

import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import * as tar from 'tar'
import type {
  InstallProgress,
  Instance,
  ManagerIndex,
  PteroClonePayload,
  PteroClonePrefill
} from '@shared/types'
import { isProxy } from '@shared/software'
import { addInstanceMeta, instanceDir, writeInstance } from '../store/instances'
import { setServerProperties } from '../servers/properties'
import {
  compressFiles,
  deleteFiles,
  fileDownloadUrl,
  listFiles,
  readFile as readRemoteFile,
  serverDetails
} from './api'
import { guessServerFromJar, parseInvocation } from './parse'

/** Leftovers from earlier compress runs (ours or the panel UI's) — never re-archive them. */
const ARCHIVE_NAME = /^archive-.*\.(tar\.gz|zip)$/i

/** Inspect a remote server and suggest local clone settings for the dialog. */
export async function prepareClone(serverId: string): Promise<PteroClonePrefill> {
  const details = await serverDetails(serverId)
  const inv = parseInvocation(details.invocation)
  const guess = inv.launchJar ? guessServerFromJar(inv.launchJar) : {}
  let port = 25565
  try {
    const props = await readRemoteFile(serverId, 'server.properties')
    if (props.ok) {
      const m = props.content.match(/^server-port=(\d+)/m)
      if (m) port = Number(m[1])
    }
  } catch {
    /* proxies and fresh servers have no server.properties */
  }
  return {
    name: `${details.name} (local test)`,
    // Panel limit of 0 = unlimited; fall back to a sane default, clamp to the slider range.
    ramMB: details.memoryMB > 0 ? Math.min(Math.max(details.memoryMB, 512), 16384) : 2048,
    port,
    launchKind: inv.launchKind,
    launchJar: inv.launchJar,
    jvmArgs: inv.jvmArgs,
    serverType: guess.serverType,
    mcVersion: guess.mcVersion
  }
}

/** Throw when the user canceled the clone (checked between the long phases). */
function checkCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Clone canceled')
}

/** Copy a remote server 1:1 into a new local instance. Abort via the signal. */
export async function cloneServer(
  root: string,
  payload: PteroClonePayload,
  send: (p: InstallProgress) => void,
  signal?: AbortSignal
): Promise<{ instance: Instance; index: ManagerIndex }> {
  try {
    return await run(root, payload, send, signal)
  } catch (err) {
    // An abort surfaces as whatever the in-flight step threw — report it as a cancel.
    const message = signal?.aborted
      ? 'Clone canceled'
      : err instanceof Error
        ? err.message
        : String(err)
    send({ phase: 'error', message })
    throw signal?.aborted ? new Error(message) : err
  }
}

async function run(
  root: string,
  payload: PteroClonePayload,
  send: (p: InstallProgress) => void,
  signal?: AbortSignal
): Promise<{ instance: Instance; index: ManagerIndex }> {
  // 1. One server-side archive instead of thousands of per-file downloads.
  send({ phase: 'resolve', message: 'Creating archive on the panel… (can take a while)' })
  const rootEntries = await listFiles(payload.serverId, '')
  const names = rootEntries.map((e) => e.name).filter((n) => !ARCHIVE_NAME.test(n))
  if (names.length === 0) throw new Error('The remote server has no files to copy')
  const archiveName = await compressFiles(payload.serverId, '', names, signal)

  // 2. Stream the archive to a temp file, then clean it off the remote server.
  const tmp = join(app.getPath('temp'), `bsm-clone-${randomUUID()}.tar.gz`)
  try {
    const url = await fileDownloadUrl(payload.serverId, archiveName)
    await downloadTo(url, tmp, send, signal)
  } finally {
    void deleteFiles(payload.serverId, '', [archiveName]).catch(() => undefined)
  }

  // 3. Extract into a fresh instance folder and register it.
  checkCanceled(signal)
  const id = randomUUID()
  const dir = instanceDir(root, id)
  try {
    send({ phase: 'install', message: 'Extracting server files…' })
    mkdirSync(dir, { recursive: true })
    await tar.x({ file: tmp, cwd: dir })

    send({ phase: 'configure', message: 'Configuring the local copy…' })
    if (!isProxy(payload.serverType)) {
      setServerProperties(dir, { 'server-port': payload.port })
    }
    const instance: Instance = {
      id,
      name: payload.name,
      serverType: payload.serverType,
      mcVersion: payload.mcVersion,
      build: 'cloned',
      launchKind: payload.launchKind,
      launchJar: payload.launchJar,
      port: payload.port,
      ramMB: payload.ramMB,
      javaPath: payload.javaPath,
      jvmArgs: payload.jvmArgs,
      eulaAccepted: existsSync(join(dir, 'eula.txt')),
      createdAt: Date.now()
    }
    writeInstance(root, instance)
    const index = addInstanceMeta(root, { id, name: instance.name, groupId: payload.groupId })
    send({ phase: 'done' })
    return { instance, index }
  } catch (err) {
    // Don't leave a half-extracted orphan folder behind.
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* ignore */
    }
  }
}

/** Stream a (signed, unauthenticated) archive URL to disk with throttled progress. */
async function downloadTo(
  url: string,
  dest: string,
  send: (p: InstallProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch {
    checkCanceled(signal)
    throw new Error('Could not reach the node to download the archive')
  }
  if (!res.ok || !res.body) throw new Error(`Archive download failed (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length') ?? 0) || undefined
  let received = 0
  let lastSent = 0
  send({ phase: 'download', received, total, message: 'Downloading server archive…' })
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    // Throttle IPC chatter: multi-GB downloads produce tens of thousands of chunks.
    if (Date.now() - lastSent >= 250) {
      lastSent = Date.now()
      send({ phase: 'download', received, total, message: 'Downloading server archive…' })
    }
  })
  await pipeline(body, createWriteStream(dest))
  send({ phase: 'download', received, total, message: 'Download complete' })
}
