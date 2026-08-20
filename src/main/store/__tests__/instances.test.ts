import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addInstanceMeta,
  deleteInstance,
  ensureRoot,
  instanceDir,
  isExternalInstance,
  readIndex,
  relocateInstance
} from '../instances'

const ID = '11111111-2222-3333-4444-555555555555'

let root: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bsm-root-'))
  outside = mkdtempSync(join(tmpdir(), 'bsm-outside-'))
  ensureRoot(root)
  addInstanceMeta(root, { id: ID, name: 'Test', groupId: null })
  mkdirSync(instanceDir(root, ID), { recursive: true })
  writeFileSync(join(instanceDir(root, ID), 'marker.txt'), 'hello', 'utf-8')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('instanceDir', () => {
  it('uses the managed layout when the index has no path', () => {
    expect(instanceDir(root, ID)).toBe(join(root, 'instances', ID))
    expect(isExternalInstance(root, ID)).toBe(false)
  })

  it('honors a path override written into the index', () => {
    const dest = join(outside, 'server')
    const index = readIndex(root)
    index.instances[0].path = dest
    writeFileSync(join(root, 'birdflop-manager.json'), JSON.stringify(index), 'utf-8')

    expect(instanceDir(root, ID)).toBe(dest)
    expect(isExternalInstance(root, ID)).toBe(true)
  })
})

describe('relocateInstance', () => {
  it('moves the folder and records it in the index', () => {
    const dest = join(outside, 'Aether', 'server')
    relocateInstance(root, ID, dest)

    expect(readFileSync(join(dest, 'marker.txt'), 'utf-8')).toBe('hello')
    expect(existsSync(join(root, 'instances', ID))).toBe(false)
    expect(instanceDir(root, ID)).toBe(dest)
    expect(readIndex(root).instances[0].path).toBe(dest)
  })

  it('drops the override when moved back under the data root', () => {
    relocateInstance(root, ID, join(outside, 'server'))
    relocateInstance(root, ID, join(root, 'instances', ID))

    expect(isExternalInstance(root, ID)).toBe(false)
    expect(readIndex(root).instances[0].path).toBeUndefined()
    expect(existsSync(join(root, 'instances', ID, 'marker.txt'))).toBe(true)
  })

  it('refuses a destination that already has files in it', () => {
    const dest = join(outside, 'occupied')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'keep.txt'), 'mine', 'utf-8')

    expect(() => relocateInstance(root, ID, dest)).toThrow(/isn't empty/)
    expect(existsSync(join(root, 'instances', ID, 'marker.txt'))).toBe(true)
  })

  it('refuses to move a folder inside itself', () => {
    expect(() => relocateInstance(root, ID, join(instanceDir(root, ID), 'nested'))).toThrow(
      /into itself/
    )
  })
})

describe('deleteInstance', () => {
  it('deletes the folder of a managed instance', () => {
    const dir = instanceDir(root, ID)
    deleteInstance(root, ID)

    expect(existsSync(dir)).toBe(false)
    expect(readIndex(root).instances).toHaveLength(0)
  })

  it('only unlinks an external instance, leaving the files alone', () => {
    const dest = join(outside, 'server')
    relocateInstance(root, ID, dest)
    deleteInstance(root, ID)

    expect(readIndex(root).instances).toHaveLength(0)
    expect(readFileSync(join(dest, 'marker.txt'), 'utf-8')).toBe('hello')
  })
})
