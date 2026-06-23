import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const USER_AGENT = 'BirdflopServerManager/0.1 (+https://birdflop.com)'

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
  return res.text()
}

/** Stream a URL to a file, reporting (received, total) bytes as it goes. */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number) => void
): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`Download ${url} failed: ${res.status} ${res.statusText}`)
  }
  const total = Number(res.headers.get('content-length')) || 0
  let received = 0
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  if (onProgress) {
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length
      onProgress(received, total)
    })
  }
  await pipeline(nodeStream, createWriteStream(dest))
}
