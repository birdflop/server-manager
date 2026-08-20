import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginManifest } from '../manifest'

let root = ''
const sent: Array<[string, unknown]> = []

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
  ipcMain: { handle: () => {}, removeHandler: () => {} },
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: (ch: string, p: unknown) => void sent.push([ch, p]) } }]
  }
}))
vi.mock('../../config', () => ({ getConfig: () => ({ rootPath: root, defaultRamMB: 2048 }) }))

const { createPluginContext } = await import('../context')
const { addInstanceMeta, ensureRoot, instanceDir, readIndex } = await import('../../store/instances')

function manifest(...permissions: string[]): PluginManifest {
  return { id: 'test-plugin', name: 'Test', version: '1.0.0', main: 'index.js', permissions }
}

/** An instance in the index with a matching instance.json on disk. */
function addServer(id: string, name: string, groupId: string | null = null): void {
  addInstanceMeta(root, { id, name, groupId })
  const dir = instanceDir(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'instance.json'),
    JSON.stringify({ id, name, serverType: 'paper', mcVersion: '1.21.4', port: 25565 }),
    'utf-8'
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bsm-ctx-'))
  ensureRoot(root)
  sent.length = 0
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('permission gating', () => {
  it('rejects group and server mutations without servers:manage', async () => {
    const { ctx, dispose } = createPluginContext(manifest('servers:read', 'servers:control'))
    await expect(ctx.groups.create('nope')).rejects.toThrow(/servers:manage/)
    await expect(ctx.servers.rename('x', 'y')).rejects.toThrow(/servers:manage/)
    await expect(ctx.servers.delete('x')).rejects.toThrow(/servers:manage/)
    await expect(ctx.servers.move('x', null)).rejects.toThrow(/servers:manage/)
    dispose()
  })

  it('rejects reads without servers:read', async () => {
    const { ctx, dispose } = createPluginContext(manifest('servers:manage'))
    await expect(ctx.groups.list()).rejects.toThrow(/servers:read/)
    await expect(ctx.software.listTypes()).rejects.toThrow(/servers:read/)
    dispose()
  })
})

describe('groups', () => {
  it('creates, lists with members, renames, and deletes without losing servers', async () => {
    const { ctx, dispose } = createPluginContext(manifest('servers:read', 'servers:manage'))

    const group = await ctx.groups.create('Testing')
    expect(group.name).toBe('Testing')
    expect(group.serverIds).toEqual([])

    addServer('s1', 'Paper Dev', group.id)
    expect(await ctx.groups.list()).toEqual([{ id: group.id, name: 'Testing', serverIds: ['s1'] }])

    await ctx.groups.rename(group.id, 'Renamed')
    expect((await ctx.groups.list())[0].name).toBe('Renamed')

    await ctx.groups.delete(group.id)
    expect(await ctx.groups.list()).toEqual([])
    // The server survives, just ungrouped.
    expect(readIndex(root).instances.map((m) => [m.id, m.groupId])).toEqual([['s1', null]])

    dispose()
  })

  it('reports unknown ids instead of silently no-op-ing', async () => {
    const { ctx, dispose } = createPluginContext(manifest('servers:read', 'servers:manage'))
    await expect(ctx.groups.rename('ghost', 'x')).rejects.toThrow(/No group with id "ghost"/)
    await expect(ctx.groups.delete('ghost')).rejects.toThrow(/No group with id "ghost"/)
    await expect(ctx.groups.create('  ')).rejects.toThrow(/needs a name/)
    dispose()
  })
})

describe('servers', () => {
  it('renames and moves between groups, reporting the group in list()', async () => {
    const { ctx, dispose } = createPluginContext(manifest('servers:read', 'servers:manage'))
    const group = await ctx.groups.create('Testing')
    addServer('s1', 'Paper Dev')

    expect((await ctx.servers.list())[0].groupId).toBeNull()

    await ctx.servers.move('s1', group.id)
    expect((await ctx.servers.get('s1'))?.groupId).toBe(group.id)

    await ctx.servers.rename('s1', 'Renamed')
    expect((await ctx.servers.get('s1'))?.name).toBe('Renamed')
    expect(readIndex(root).instances[0].name).toBe('Renamed')

    await ctx.servers.move('s1', null)
    expect((await ctx.servers.get('s1'))?.groupId).toBeNull()
    dispose()
  })

  it('rejects unknown servers and unknown move targets', async () => {
    const { ctx, dispose } = createPluginContext(manifest('servers:read', 'servers:manage'))
    addServer('s1', 'Paper Dev')
    await expect(ctx.servers.rename('ghost', 'x')).rejects.toThrow(/No server with id "ghost"/)
    await expect(ctx.servers.delete('ghost')).rejects.toThrow(/No server with id "ghost"/)
    await expect(ctx.servers.move('s1', 'ghost')).rejects.toThrow(/No group with id "ghost"/)
    dispose()
  })

  it('deletes the folder along with the index entry', async () => {
    const { ctx, dispose } = createPluginContext(manifest('servers:read', 'servers:manage'))
    addServer('s1', 'Paper Dev')
    await ctx.servers.delete('s1')
    expect(readIndex(root).instances).toEqual([])
    expect(await ctx.servers.list()).toEqual([])
    dispose()
  })
})

describe('index broadcasts', () => {
  it('tells open windows about every mutation so the sidebar stays current', async () => {
    const { ctx, dispose } = createPluginContext(manifest('servers:read', 'servers:manage'))
    addServer('s1', 'Paper Dev')
    const group = await ctx.groups.create('Testing')
    await ctx.servers.move('s1', group.id)
    await ctx.servers.rename('s1', 'Renamed')
    await ctx.servers.delete('s1')
    await ctx.groups.delete(group.id)

    expect(sent.map(([channel]) => channel)).toEqual(Array(5).fill('index:changed'))
    dispose()
  })
})
