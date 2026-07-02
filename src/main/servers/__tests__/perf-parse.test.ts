import { describe, expect, it } from 'vitest'
import { parseTps, parseMspt, isUnknownCommand } from '../perf-parse'

describe('parseTps', () => {
  it('reads Paper tps output', () => {
    expect(parseTps('§6TPS from last 1m, 5m, 15m: §a20.0, §a19.98, §a20.0')).toBe(20)
  })

  it('reads newer Paper output with a 5s window', () => {
    expect(parseTps('TPS from last 5s, 1m, 5m, 15m: 18.2, 19.5, 20.0, 20.0')).toBe(18.2)
  })

  it('reads spark tps output and clamps the catch-up asterisk value', () => {
    const out =
      'TPS from last 5s, 10s, 1m, 5m, 15m:\n 20.05*, 20.0, 19.9, 20.0, 20.0\n' +
      'Tick durations (min/med/95%ile/max) from last 10s, 1m:\n 1.2/2.4/5.0/10.3;  1.1/2.5/6.0/12.0'
    expect(parseTps(out)).toBe(20)
  })

  it('returns null for unrelated output', () => {
    expect(parseTps('Unknown command. Type "/help" for help.')).toBeNull()
  })
})

describe('parseMspt', () => {
  it('reads Paper mspt output', () => {
    expect(
      parseMspt('Server tick times (avg/min/max) from last 5s, 10s, 1m: 2.4/1.2/10.3, 2.5/1.1/12.0, 2.6/1.0/15.1')
    ).toBe(2.4)
  })

  it('reads the median from spark tick durations', () => {
    expect(
      parseMspt('Tick durations (min/med/95%ile/max) from last 10s, 1m: 1.2/2.4/5.0/10.3; 1.1/2.5/6.0/12.0')
    ).toBe(2.4)
  })

  it('returns null when there is no tick info', () => {
    expect(parseMspt('TPS from last 1m: 20.0')).toBeNull()
  })
})

describe('isUnknownCommand', () => {
  it('detects Bukkit and Brigadier unknown-command replies', () => {
    expect(isUnknownCommand('Unknown command. Type "/help" for help.')).toBe(true)
    expect(isUnknownCommand('Unknown or incomplete command, see below for error')).toBe(true)
    expect(isUnknownCommand('TPS from last 1m: 20.0')).toBe(false)
  })
})
