import { describe, expect, it } from 'vitest'
import type { Instance } from '@shared/types'
import { previewLaunch, tokenizeCommand } from '../launch'

function inst(overrides: Partial<Instance> = {}): Instance {
  return {
    id: 'test',
    name: 'Test',
    serverType: 'paper',
    mcVersion: '1.21.4',
    build: '100',
    launchKind: 'jar',
    launchJar: 'paper.jar',
    port: 25565,
    ramMB: 4096,
    javaPath: 'C:\\java\\bin\\java.exe',
    jvmArgs: ['-XX:+UseG1GC'],
    eulaAccepted: true,
    createdAt: 0,
    ...overrides
  }
}

describe('tokenizeCommand', () => {
  it('splits on whitespace and honors quotes', () => {
    expect(tokenizeCommand('java -jar server.jar nogui')).toEqual([
      'java',
      '-jar',
      'server.jar',
      'nogui'
    ])
    expect(tokenizeCommand('"C:\\Program Files\\java.exe"  -jar \'my server.jar\'')).toEqual([
      'C:\\Program Files\\java.exe',
      '-jar',
      'my server.jar'
    ])
    expect(tokenizeCommand('   ')).toEqual([])
  })
})

describe('previewLaunch (jar)', () => {
  it('assembles java + memory + jvm args + jar + default nogui', () => {
    const p = previewLaunch(inst(), 'D:\\srv')
    expect(p.command).toBe('C:\\java\\bin\\java.exe')
    expect(p.args).toEqual([
      '-Dterminal.ansi=true',
      '-Xmx4096M',
      '-Xms4096M',
      '-XX:+UseG1GC',
      '-jar',
      'paper.jar',
      'nogui'
    ])
    expect(p.overridden).toBe(false)
    expect(p.userJvmArgs).toBeUndefined()
  })

  it('omits nogui for proxies and honors explicit game args', () => {
    const proxy = previewLaunch(inst({ serverType: 'velocity', launchJar: 'velocity.jar' }), 'D:\\srv')
    expect(proxy.args.at(-1)).toBe('velocity.jar')
    const custom = previewLaunch(inst({ gameArgs: ['nogui', '--forceUpgrade'] }), 'D:\\srv')
    expect(custom.args.slice(-2)).toEqual(['nogui', '--forceUpgrade'])
  })

  it('includes the JDWP agent when debugging is enabled', () => {
    const p = previewLaunch(inst({ debug: { enabled: true, port: 5005, suspend: false } }), 'D:\\srv')
    expect(p.args.some((a) => a.startsWith('-agentlib:jdwp='))).toBe(true)
  })
})

describe('previewLaunch (override)', () => {
  it('uses the custom command verbatim, quote-aware', () => {
    const p = previewLaunch(
      inst({ launchOverride: 'java -Xmx2G -jar "my server.jar" nogui' }),
      'D:\\srv'
    )
    expect(p.overridden).toBe(true)
    expect(p.command).toBe('java')
    expect(p.args).toEqual(['-Xmx2G', '-jar', 'my server.jar', 'nogui'])
  })

  it('falls back to the generated command when the override is blank', () => {
    const p = previewLaunch(inst({ launchOverride: '   ' }), 'D:\\srv')
    expect(p.overridden).toBe(false)
    expect(p.command).toBe('C:\\java\\bin\\java.exe')
  })
})

describe('previewLaunch (args-file)', () => {
  it('previews the argfile launch and exposes the user_jvm_args content', () => {
    const p = previewLaunch(
      inst({ launchKind: 'args-file', launchJar: undefined, serverType: 'neoforge' }),
      'Z:\\does-not-exist'
    )
    expect(p.command).toBe('C:\\java\\bin\\java.exe')
    expect(p.args[0]).toBe('@user_jvm_args.txt')
    expect(p.args[1]).toBe('@<launch args file not found>')
    expect(p.args.at(-1)).toBe('nogui')
    expect(p.userJvmArgs).toContain('-Xmx4096M')
    expect(p.userJvmArgs).toContain('-XX:+UseG1GC')
  })
})
