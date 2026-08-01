// Typed client for the Pterodactyl (and Pelican) client API. The panel URL
// lives in the app config; the client API key lives in the encrypted secrets
// store and never leaves the main process.

import { basename } from 'node:path'
import { readFile as readLocalFile } from 'node:fs/promises'
import type {
  FileEntry,
  FileReadResult,
  PteroAccount,
  PteroBackup,
  PteroConnection,
  PteroPowerAction,
  PteroResources,
  PteroServer
} from '@shared/types'
import { getConfig, setConfig } from '../config'
import { getSecret, setSecret } from '../secrets'
import {
  mapBackup,
  mapFileEntry,
  mapResources,
  mapServer,
  normalizePanelUrl,
  sortFileEntries,
  type BackupAttributes,
  type FileAttributes,
  type ResourcesAttributes,
  type ServerAttributes
} from './parse'

/** Panel account cached after the key was last verified (cleared on disconnect). */
let cachedAccount: PteroAccount | null = null

/** The saved panel credentials, or null when not connected. */
function credentials(): { panelUrl: string; apiKey: string } | null {
  const panelUrl = getConfig().pterodactylPanelUrl
  const apiKey = getSecret('pterodactyl-api-key')
  return panelUrl && apiKey ? { panelUrl, apiKey } : null
}

/** The panel origin, for callers that need it (websocket Origin header). */
export function panelOrigin(): string | null {
  return getConfig().pterodactylPanelUrl
}

interface PteroErrorBody {
  errors?: { code?: string; detail?: string }[]
}

/** GET/POST a client API route, translating failures into friendly errors. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const creds = credentials()
  if (!creds) throw new Error('Not connected to a panel')
  return requestWith(creds.panelUrl, creds.apiKey, path, init)
}

async function requestWith<T>(
  panelUrl: string,
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await responseWith(panelUrl, apiKey, path, init)
  // 204 No Content (power/command acknowledgements)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Like request(), but hands back the raw Response (file contents, etc.). */
async function response(path: string, init?: RequestInit): Promise<Response> {
  const creds = credentials()
  if (!creds) throw new Error('Not connected to a panel')
  return responseWith(creds.panelUrl, creds.apiKey, path, init)
}

async function responseWith(
  panelUrl: string,
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${panelUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...init?.headers
      }
    })
  } catch (err) {
    // Deliberate aborts (canceled clone) must reach the caller as aborts.
    if (err instanceof Error && err.name === 'AbortError') throw err
    throw new Error(`Could not reach ${panelUrl} — check the URL and your connection`)
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as PteroErrorBody).errors?.[0]?.detail ?? ''
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) throw new Error('The panel rejected the API key — check it and try again')
    if (res.status === 403) throw new Error(detail || 'The API key is not allowed to do that')
    if (res.status === 404) throw new Error(detail || 'Not found — it may have been removed')
    if (res.status === 429) throw new Error('The panel is rate-limiting requests — try again shortly')
    throw new Error(detail || `Panel request failed (HTTP ${res.status})`)
  }
  return res
}

// ---- Response shapes (the slices of the panel API we consume) ----

interface AccountResponse {
  attributes: { username: string; email: string; admin: boolean }
}

interface ServerListResponse {
  data: { attributes: ServerAttributes }[]
  meta: { pagination: { current_page: number; total_pages: number } }
}

// ---- Public API ----

/** Verify + persist panel credentials. Throws (persisting nothing) on failure. */
export async function connect(panelUrlInput: string, apiKey: string): Promise<PteroConnection> {
  const panelUrl = normalizePanelUrl(panelUrlInput)
  const key = apiKey.trim()
  if (!key) throw new Error('Enter a client API key')
  const account = await requestWith<AccountResponse>(panelUrl, key, '/api/client/account')
  cachedAccount = {
    username: account.attributes.username,
    email: account.attributes.email,
    admin: account.attributes.admin
  }
  setConfig({ pterodactylPanelUrl: panelUrl })
  setSecret('pterodactyl-api-key', key)
  return status()
}

/** Forget the saved credentials. */
export function disconnect(): void {
  cachedAccount = null
  setSecret('pterodactyl-api-key', null)
  setConfig({ pterodactylPanelUrl: null })
}

/** Connection state; verifies the saved key against the panel on first call. */
export async function status(): Promise<PteroConnection> {
  const creds = credentials()
  if (!creds) return { connected: false, panelUrl: null, account: null }
  if (!cachedAccount) {
    try {
      const account = await request<AccountResponse>('/api/client/account')
      cachedAccount = {
        username: account.attributes.username,
        email: account.attributes.email,
        admin: account.attributes.admin
      }
    } catch {
      // Panel unreachable or key revoked — still "configured", just unverified.
      return { connected: true, panelUrl: creds.panelUrl, account: null }
    }
  }
  return { connected: true, panelUrl: creds.panelUrl, account: cachedAccount }
}

/** Every server the account can access (follows pagination). */
export async function listServers(): Promise<PteroServer[]> {
  const servers: PteroServer[] = []
  for (let page = 1, totalPages = 1; page <= totalPages; page++) {
    const res = await request<ServerListResponse>(`/api/client?page=${page}&per_page=50`)
    totalPages = res.meta.pagination.total_pages
    servers.push(...res.data.map((s) => mapServer(s.attributes)))
  }
  return servers
}

/** Full details for one server, including its startup command and limits. */
export async function serverDetails(
  serverId: string
): Promise<{ name: string; invocation: string; memoryMB: number }> {
  const res = await request<{ attributes: ServerAttributes & { invocation?: string | null } }>(
    `/api/client/servers/${serverId}`
  )
  return {
    name: res.attributes.name,
    invocation: res.attributes.invocation ?? '',
    memoryMB: res.attributes.limits.memory
  }
}

/** Point-in-time state + resource usage for one server. */
export async function resources(serverId: string): Promise<PteroResources> {
  const res = await request<{ attributes: ResourcesAttributes }>(
    `/api/client/servers/${serverId}/resources`
  )
  return mapResources(res.attributes)
}

/** Send a power signal. */
export async function power(serverId: string, action: PteroPowerAction): Promise<void> {
  await request(`/api/client/servers/${serverId}/power`, {
    method: 'POST',
    body: JSON.stringify({ signal: action })
  })
}

/** Send a console command over HTTP (works without an open websocket). */
export async function sendCommand(serverId: string, command: string): Promise<void> {
  await request(`/api/client/servers/${serverId}/command`, {
    method: 'POST',
    body: JSON.stringify({ command })
  })
}

/** One-time credentials for the server's Wings websocket. */
export async function websocketDetails(
  serverId: string
): Promise<{ token: string; socketUrl: string }> {
  const res = await request<{ data: { token: string; socket: string } }>(
    `/api/client/servers/${serverId}/websocket`
  )
  return { token: res.data.token, socketUrl: res.data.socket }
}

// ---- Remote files ----

/** Files larger than this aren't opened in the built-in editor (mirrors local files.ts). */
const MAX_EDIT_BYTES = 2 * 1024 * 1024

/** The panel expects file/directory params rooted at "/" and url-encoded. */
function fileParam(path: string): string {
  return encodeURIComponent('/' + path.replace(/^\/+/, ''))
}

/** List a remote directory ("" = server root). Dirs first, like the local browser. */
export async function listFiles(serverId: string, dir: string): Promise<FileEntry[]> {
  const res = await request<{ data: { attributes: FileAttributes }[] }>(
    `/api/client/servers/${serverId}/files/list?directory=${fileParam(dir)}`
  )
  return sortFileEntries(res.data.map((f) => mapFileEntry(dir, f.attributes)))
}

/** Read a remote file for the editor, reporting binary/oversize instead of throwing. */
export async function readFile(serverId: string, path: string): Promise<FileReadResult> {
  let res: Response
  try {
    res = await response(`/api/client/servers/${serverId}/files/contents?file=${fileParam(path)}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: msg.startsWith('Not found') ? 'missing' : 'error', size: 0 }
  }
  // Bail before downloading when the panel tells us the size up front.
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_EDIT_BYTES) {
    await res.body?.cancel()
    return { ok: false, reason: 'too-large', size: declared }
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_EDIT_BYTES) return { ok: false, reason: 'too-large', size: buf.length }
  // A NUL byte in the first chunk is the classic, cheap "this is binary" heuristic.
  if (buf.subarray(0, Math.min(buf.length, 8000)).includes(0)) {
    return { ok: false, reason: 'binary', size: buf.length }
  }
  return { ok: true, content: buf.toString('utf-8'), size: buf.length }
}

/** Write text content to a remote file (creates it if missing). */
export async function writeFile(serverId: string, path: string, content: string): Promise<void> {
  await request(`/api/client/servers/${serverId}/files/write?file=${fileParam(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: content
  })
}

/** Rename a file/folder within a remote directory (names, not paths). */
export async function renameFile(
  serverId: string,
  dir: string,
  from: string,
  to: string
): Promise<void> {
  await request(`/api/client/servers/${serverId}/files/rename`, {
    method: 'PUT',
    body: JSON.stringify({ root: '/' + dir, files: [{ from, to }] })
  })
}

/** Delete files/folders within a remote directory. */
export async function deleteFiles(serverId: string, dir: string, names: string[]): Promise<void> {
  await request(`/api/client/servers/${serverId}/files/delete`, {
    method: 'POST',
    body: JSON.stringify({ root: '/' + dir, files: names })
  })
}

/** Create a folder within a remote directory. */
export async function createFolder(serverId: string, dir: string, name: string): Promise<void> {
  await request(`/api/client/servers/${serverId}/files/create-folder`, {
    method: 'POST',
    body: JSON.stringify({ root: '/' + dir, name })
  })
}

/**
 * Ask Wings to tar.gz files within a remote directory; resolves with the archive's
 * filename once it's built. Can take minutes on large servers.
 */
export async function compressFiles(
  serverId: string,
  dir: string,
  names: string[],
  signal?: AbortSignal
): Promise<string> {
  const res = await request<{ attributes: FileAttributes }>(
    `/api/client/servers/${serverId}/files/compress`,
    { method: 'POST', body: JSON.stringify({ root: '/' + dir, files: names }), signal }
  )
  return res.attributes.name
}

/** Signed one-time URL to download a remote file (open in the browser). */
export async function fileDownloadUrl(serverId: string, path: string): Promise<string> {
  const res = await request<{ attributes: { url: string } }>(
    `/api/client/servers/${serverId}/files/download?file=${fileParam(path)}`
  )
  return res.attributes.url
}

/** Upload local files into a remote directory via the panel's signed upload URL. */
export async function uploadFiles(
  serverId: string,
  dir: string,
  localPaths: string[]
): Promise<void> {
  const res = await request<{ attributes: { url: string } }>(
    `/api/client/servers/${serverId}/files/upload`
  )
  const form = new FormData()
  for (const p of localPaths) {
    form.append('files', new Blob([await readLocalFile(p)]), basename(p))
  }
  const upload = await fetch(`${res.attributes.url}&directory=${fileParam(dir)}`, {
    method: 'POST',
    body: form
  })
  if (!upload.ok) throw new Error(`Upload failed (HTTP ${upload.status})`)
}

// ---- Remote backups ----

/** Backups for a server, newest first. */
export async function listBackups(serverId: string): Promise<PteroBackup[]> {
  const res = await request<{ data: { attributes: BackupAttributes }[] }>(
    `/api/client/servers/${serverId}/backups?per_page=50`
  )
  return res.data.map((b) => mapBackup(b.attributes)).sort((a, b) => b.createdAt - a.createdAt)
}

/** Start a backup (the panel finishes it asynchronously). */
export async function createBackup(serverId: string): Promise<void> {
  await request(`/api/client/servers/${serverId}/backups`, {
    method: 'POST',
    body: JSON.stringify({})
  })
}

/** Restore a backup over the server's current files. */
export async function restoreBackup(serverId: string, uuid: string): Promise<void> {
  await request(`/api/client/servers/${serverId}/backups/${uuid}/restore`, {
    method: 'POST',
    body: JSON.stringify({ truncate: false })
  })
}

export async function deleteBackup(serverId: string, uuid: string): Promise<void> {
  await request(`/api/client/servers/${serverId}/backups/${uuid}`, { method: 'DELETE' })
}

/** Signed one-time URL to download a backup archive (open in the browser). */
export async function backupDownloadUrl(serverId: string, uuid: string): Promise<string> {
  const res = await request<{ attributes: { url: string } }>(
    `/api/client/servers/${serverId}/backups/${uuid}/download`
  )
  return res.attributes.url
}
