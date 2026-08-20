import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// create.ts reaches app config + managed Java paths, which need Electron at import time.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { nextFreePort } = await import('../create')
const { addInstanceMeta, ensureRoot, instanceDir } = await import('../../store/instances')

let root: string

/** Write an instance.json so `nextFreePort` can see the port it occupies. */
function addServer(id: string, port: number): void {
  addInstanceMeta(root, { id, name: id, groupId: null })
  const dir = instanceDir(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'instance.json'), JSON.stringify({ id, name: id, port }), 'utf-8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bsm-create-'))
  ensureRoot(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('nextFreePort', () => {
  it('starts at 25565 when nothing is installed', () => {
    expect(nextFreePort(root)).toBe(25565)
  })

  it('skips ports already taken, including gaps', () => {
    addServer('a', 25565)
    addServer('b', 25567)
    expect(nextFreePort(root)).toBe(25566)
  })

  it('walks past a contiguous run', () => {
    addServer('a', 25565)
    addServer('b', 25566)
    addServer('c', 25567)
    expect(nextFreePort(root)).toBe(25568)
  })

  it('ignores index entries whose instance.json is missing', () => {
    addInstanceMeta(root, { id: 'ghost', name: 'ghost', groupId: null })
    expect(nextFreePort(root)).toBe(25565)
  })
})
