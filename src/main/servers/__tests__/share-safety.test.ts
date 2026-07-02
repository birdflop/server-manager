import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyShareSafetyFix, checkShareSafety } from '../share-safety'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bsm-safety-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeProps(lines: string[]): void {
  writeFileSync(join(dir, 'server.properties'), lines.join('\n') + '\n', 'utf-8')
}

describe('checkShareSafety', () => {
  it('flags offline-mode servers without a whitelist', () => {
    writeProps(['online-mode=false', 'white-list=false'])
    expect(checkShareSafety(dir, 'paper')).toEqual({
      checked: true,
      onlineMode: false,
      whitelist: false,
      risky: true
    })
  })

  it('accepts online-mode servers', () => {
    writeProps(['online-mode=true', 'white-list=false'])
    expect(checkShareSafety(dir, 'paper').risky).toBe(false)
  })

  it('accepts offline servers with a whitelist', () => {
    writeProps(['online-mode=false', 'white-list=true'])
    expect(checkShareSafety(dir, 'paper').risky).toBe(false)
  })

  it('treats a missing online-mode key as the vanilla default (true)', () => {
    writeProps(['motd=hi'])
    const safety = checkShareSafety(dir, 'paper')
    expect(safety.onlineMode).toBe(true)
    expect(safety.risky).toBe(false)
  })

  it('cannot check servers without server.properties', () => {
    expect(checkShareSafety(dir, 'paper')).toEqual({ checked: false, risky: false })
  })

  it('skips proxies', () => {
    writeProps(['online-mode=false'])
    expect(checkShareSafety(dir, 'velocity')).toEqual({ checked: false, risky: false })
  })
})

describe('applyShareSafetyFix', () => {
  it('enables online-mode', () => {
    writeProps(['online-mode=false', 'white-list=false'])
    const safety = applyShareSafetyFix(dir, 'paper', 'online-mode')
    expect(safety).toMatchObject({ onlineMode: true, risky: false })
  })

  it('enables the whitelist', () => {
    writeProps(['online-mode=false', 'white-list=false'])
    const safety = applyShareSafetyFix(dir, 'paper', 'whitelist')
    expect(safety).toMatchObject({ onlineMode: false, whitelist: true, risky: false })
  })
})
