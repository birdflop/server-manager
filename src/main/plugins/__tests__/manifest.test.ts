import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readManifest, checkEngine } from '../manifest'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bsm-plugin-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writePlugin(manifest: unknown, entry = 'index.js'): void {
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest), 'utf-8')
  if (entry) writeFileSync(join(dir, entry), 'module.exports = { activate() {} }', 'utf-8')
}

describe('readManifest', () => {
  it('accepts a minimal valid manifest and fills defaults', () => {
    writePlugin({ id: 'my-plugin', name: 'My Plugin', version: '1.0.0', main: 'index.js' })
    const m = readManifest(dir)
    expect(m.id).toBe('my-plugin')
    expect(m.isolation).toBe('inline')
    expect(m.permissions).toEqual([])
  })

  it('keeps declared permissions and isolation', () => {
    writePlugin({
      id: 'iso',
      name: 'Iso',
      version: '2.1.0',
      main: 'index.js',
      isolation: 'process',
      permissions: ['servers:read', 'servers:control']
    })
    const m = readManifest(dir)
    expect(m.isolation).toBe('process')
    expect(m.permissions).toEqual(['servers:read', 'servers:control'])
  })

  it('rejects a missing plugin.json', () => {
    expect(() => readManifest(dir)).toThrow(/missing/)
  })

  it('rejects invalid JSON', () => {
    writeFileSync(join(dir, 'plugin.json'), '{ nope', 'utf-8')
    expect(() => readManifest(dir)).toThrow(/valid JSON/)
  })

  it('rejects bad ids', () => {
    for (const id of ['', 'Has Spaces', 'UPPER', 'dots.not.allowed', '-leading']) {
      writePlugin({ id, name: 'x', version: '1.0.0', main: 'index.js' })
      expect(() => readManifest(dir), `id "${id}"`).toThrow(/"id"/)
    }
  })

  it('rejects a main path escaping the plugin folder', () => {
    writePlugin({ id: 'esc', name: 'x', version: '1.0.0', main: '../outside.js' })
    expect(() => readManifest(dir)).toThrow(/inside the plugin folder/)
  })

  it('rejects a missing entry file', () => {
    writeFileSync(
      join(dir, 'plugin.json'),
      JSON.stringify({ id: 'gone', name: 'x', version: '1.0.0', main: 'nope.js' }),
      'utf-8'
    )
    expect(() => readManifest(dir)).toThrow(/doesn't exist/)
  })

  it('rejects unknown isolation values', () => {
    writePlugin({ id: 'iso', name: 'x', version: '1.0.0', main: 'index.js', isolation: 'vm' })
    expect(() => readManifest(dir)).toThrow(/isolation/)
  })

  it('accepts an entry in a subfolder', () => {
    mkdirSync(join(dir, 'dist'))
    writeFileSync(join(dir, 'dist', 'index.js'), '', 'utf-8')
    writeFileSync(
      join(dir, 'plugin.json'),
      JSON.stringify({ id: 'sub', name: 'x', version: '1.0.0', main: 'dist/index.js' }),
      'utf-8'
    )
    expect(readManifest(dir).main).toBe('dist/index.js')
  })
})

describe('checkEngine', () => {
  it('passes when no range is declared', () => {
    expect(checkEngine(undefined, '0.8.0')).toBeNull()
  })

  it('handles >= ranges', () => {
    expect(checkEngine('>=0.9.0', '0.9.0')).toBeNull()
    expect(checkEngine('>=0.9.0', '0.10.1')).toBeNull()
    expect(checkEngine('>=0.9.0', '1.0.0')).toBeNull()
    expect(checkEngine('>=0.9.0', '0.8.5')).toMatch(/needs app version/)
  })

  it('treats ^ as at-least', () => {
    expect(checkEngine('^1.2.0', '1.3.0')).toBeNull()
    expect(checkEngine('^1.2.0', '1.1.0')).toMatch(/needs app version/)
  })

  it('handles exact versions', () => {
    expect(checkEngine('0.9.0', '0.9.0')).toBeNull()
    expect(checkEngine('0.9.0', '0.9.1')).toMatch(/needs app version/)
  })
})
