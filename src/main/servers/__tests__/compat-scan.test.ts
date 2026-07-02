import { describe, expect, it } from 'vitest'
import { evaluateSmoke, scanStartupIssues, stripAnsi } from '../compat-scan'

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\x1b[33m[WARN] hi\x1b[0m')).toBe('[WARN] hi')
  })
})

describe('scanStartupIssues', () => {
  it('flags Bukkit plugin load failures as errors', () => {
    const issues = scanStartupIssues(
      [
        '[12:00:01 INFO]: Loading libraries, please wait...',
        "[12:00:05 ERROR]: Could not load 'plugins/MyPlugin.jar' in folder 'plugins'",
        'org.bukkit.plugin.InvalidPluginException: Unsupported API version 1.99'
      ].join('\n')
    )
    expect(issues.some((i) => i.severity === 'error' && i.line.includes("Could not load"))).toBe(
      true
    )
    expect(issues.some((i) => i.line.includes('Unsupported API version'))).toBe(true)
  })

  it('flags Fabric mod resolution failures as errors', () => {
    const issues = scanStartupIssues(
      'net.fabricmc.loader.impl.FormattedException: Mod resolution failed\nIncompatible mods found!'
    )
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(2)
  })

  it('treats generic ERROR lines as warnings', () => {
    const issues = scanStartupIssues('[12:00:05 ERROR]: Something odd happened')
    expect(issues).toEqual([
      { severity: 'warn', line: '[12:00:05 ERROR]: Something odd happened' }
    ])
  })

  it('keeps exception headlines but skips stack frames', () => {
    const issues = scanStartupIssues(
      [
        'java.lang.NullPointerException: boom',
        '\tat com.example.MyPlugin.onEnable(MyPlugin.java:10)',
        '\tat java.base/java.lang.Thread.run(Thread.java:840)',
        '\t... 12 more'
      ].join('\n')
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].line).toContain('NullPointerException')
  })

  it('reads through ANSI colors and dedupes repeats', () => {
    const line = "\x1b[91m[ERROR]: Could not load 'plugins/X.jar'\x1b[0m"
    const issues = scanStartupIssues(`${line}\n${line}\n${line}`)
    expect(issues).toHaveLength(1)
  })

  it('returns nothing for a clean startup', () => {
    const issues = scanStartupIssues(
      [
        '[12:00:01 INFO]: Preparing level "world"',
        '[12:00:02 INFO]: [MyPlugin] Enabling MyPlugin v1.0',
        '[12:00:03 INFO]: Done (2.345s)! For help, type "help"'
      ].join('\n')
    )
    expect(issues).toEqual([])
  })
})

describe('evaluateSmoke', () => {
  it('fails on unknown commands (plugin never registered it)', () => {
    expect(evaluateSmoke('[12:00 INFO]: Unknown command. Type "/help" for help.').ok).toBe(false)
    expect(
      evaluateSmoke('[12:00 INFO]: Unknown or incomplete command, see below for error').ok
    ).toBe(false)
  })

  it('fails when the command threw', () => {
    expect(
      evaluateSmoke(
        '[12:00 ERROR]: null\norg.bukkit.command.CommandException: Unhandled exception'
      ).ok
    ).toBe(false)
  })

  it('passes normal command output and keeps an excerpt', () => {
    const res = evaluateSmoke('\x1b[32m[12:00 INFO]: MyPlugin version 1.2.3\x1b[0m')
    expect(res.ok).toBe(true)
    expect(res.excerpt).toBe('[12:00 INFO]: MyPlugin version 1.2.3')
  })
})
