import { describe, expect, it } from 'vitest'
import {
  guessServerFromJar,
  mapBackup,
  mapFileEntry,
  mapPowerState,
  mapResources,
  mapServer,
  normalizePanelUrl,
  parseInvocation,
  parseWingsStats,
  sortFileEntries,
  type FileAttributes,
  type ServerAttributes
} from '../parse'

describe('normalizePanelUrl', () => {
  it('adds https and strips paths/trailing slashes', () => {
    expect(normalizePanelUrl('panel.birdflop.com')).toBe('https://panel.birdflop.com')
    expect(normalizePanelUrl('panel.birdflop.com/')).toBe('https://panel.birdflop.com')
    expect(normalizePanelUrl('https://panel.birdflop.com/account/api')).toBe(
      'https://panel.birdflop.com'
    )
    expect(normalizePanelUrl('  http://localhost:8080/admin ')).toBe('http://localhost:8080')
  })

  it('rejects empty or unparseable input', () => {
    expect(() => normalizePanelUrl('   ')).toThrow()
    expect(() => normalizePanelUrl('http://')).toThrow()
  })
})

describe('mapPowerState', () => {
  it('passes through known states and defaults to offline', () => {
    expect(mapPowerState('running')).toBe('running')
    expect(mapPowerState('starting')).toBe('starting')
    expect(mapPowerState('stopping')).toBe('stopping')
    expect(mapPowerState('offline')).toBe('offline')
    expect(mapPowerState('installing')).toBe('offline')
    expect(mapPowerState('')).toBe('offline')
  })
})

function serverAttrs(overrides: Partial<ServerAttributes> = {}): ServerAttributes {
  return {
    identifier: 'd3aac109',
    name: 'Survival',
    description: 'Main SMP',
    node: 'node-1',
    is_suspended: false,
    limits: { memory: 4096, disk: 10240, cpu: 200 },
    relationships: {
      allocations: {
        data: [
          {
            attributes: { ip: '10.0.0.5', ip_alias: 'mc.birdflop.com', port: 25565, is_default: true }
          },
          { attributes: { ip: '10.0.0.5', ip_alias: null, port: 25566, is_default: false } }
        ]
      }
    },
    ...overrides
  }
}

describe('mapServer', () => {
  it('maps attributes and picks the default allocation with its alias', () => {
    const server = mapServer(serverAttrs())
    expect(server).toEqual({
      identifier: 'd3aac109',
      name: 'Survival',
      description: 'Main SMP',
      node: 'node-1',
      address: 'mc.birdflop.com:25565',
      suspended: false,
      limits: { memoryMB: 4096, diskMB: 10240, cpuPct: 200 }
    })
  })

  it('falls back to the raw ip and tolerates missing allocations', () => {
    const noAlias = serverAttrs({
      relationships: {
        allocations: {
          data: [{ attributes: { ip: '10.0.0.5', ip_alias: null, port: 25566, is_default: false } }]
        }
      }
    })
    expect(mapServer(noAlias).address).toBe('10.0.0.5:25566')
    expect(mapServer(serverAttrs({ relationships: undefined })).address).toBeNull()
  })
})

describe('mapResources', () => {
  it('converts bytes to MB and normalizes the state', () => {
    const res = mapResources({
      current_state: 'running',
      resources: {
        memory_bytes: 1024 * 1024 * 1536,
        cpu_absolute: 42.35,
        disk_bytes: 1024 * 1024 * 800,
        uptime: 123456
      }
    })
    expect(res).toEqual({ state: 'running', cpuPct: 42.4, memMB: 1536, diskMB: 800, uptimeMs: 123456 })
  })
})

function fileAttrs(overrides: Partial<FileAttributes> = {}): FileAttributes {
  return {
    name: 'server.properties',
    size: 1234,
    is_file: true,
    is_symlink: false,
    mimetype: 'text/plain',
    modified_at: '2026-07-01T12:00:00+00:00',
    ...overrides
  }
}

describe('mapFileEntry', () => {
  it('builds root and nested paths and parses the mtime', () => {
    const root = mapFileEntry('', fileAttrs())
    expect(root.path).toBe('server.properties')
    expect(root.isDir).toBe(false)
    expect(root.mtimeMs).toBe(Date.parse('2026-07-01T12:00:00+00:00'))
    const nested = mapFileEntry('plugins/Essentials', fileAttrs({ name: 'config.yml' }))
    expect(nested.path).toBe('plugins/Essentials/config.yml')
  })

  it('treats non-files as directories and tolerates bad timestamps', () => {
    const dir = mapFileEntry('', fileAttrs({ name: 'plugins', is_file: false, modified_at: 'nope' }))
    expect(dir.isDir).toBe(true)
    expect(dir.mtimeMs).toBe(0)
  })
})

describe('sortFileEntries', () => {
  it('puts directories first, then names case-insensitively', () => {
    const sorted = sortFileEntries([
      mapFileEntry('', fileAttrs({ name: 'b.txt' })),
      mapFileEntry('', fileAttrs({ name: 'world', is_file: false })),
      mapFileEntry('', fileAttrs({ name: 'A.txt' })),
      mapFileEntry('', fileAttrs({ name: 'Plugins', is_file: false }))
    ])
    expect(sorted.map((e) => e.name)).toEqual(['Plugins', 'world', 'A.txt', 'b.txt'])
  })
})

describe('mapBackup', () => {
  it('maps attributes and leaves completedAt null while running', () => {
    const done = mapBackup({
      uuid: 'abc-123',
      name: 'Daily',
      bytes: 2048,
      is_successful: true,
      is_locked: false,
      created_at: '2026-07-01T00:00:00+00:00',
      completed_at: '2026-07-01T00:05:00+00:00'
    })
    expect(done.size).toBe(2048)
    expect(done.completedAt).toBe(Date.parse('2026-07-01T00:05:00+00:00'))
    const running = mapBackup({
      uuid: 'def-456',
      name: 'Now',
      bytes: 0,
      is_successful: true,
      is_locked: true,
      created_at: '2026-07-01T00:00:00+00:00',
      completed_at: null
    })
    expect(running.completedAt).toBeNull()
    expect(running.locked).toBe(true)
  })
})

describe('parseInvocation', () => {
  it('parses a jar launch and keeps non-memory JVM flags', () => {
    const inv = parseInvocation(
      'java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false --add-modules=jdk.incubator.vector -jar paper-1.21.4-131.jar nogui'
    )
    expect(inv.launchKind).toBe('jar')
    expect(inv.launchJar).toBe('paper-1.21.4-131.jar')
    expect(inv.jvmArgs).toEqual(['-Dterminal.jline=false', '--add-modules=jdk.incubator.vector'])
  })

  it('detects Forge-style args-file launches', () => {
    const inv = parseInvocation(
      'java -Xms128M @user_jvm_args.txt @libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt nogui'
    )
    expect(inv.launchKind).toBe('args-file')
    expect(inv.launchJar).toBeUndefined()
  })

  it('falls back to args-file when nothing recognizable is found', () => {
    expect(parseInvocation('').launchKind).toBe('args-file')
    expect(parseInvocation('./start.sh').launchKind).toBe('args-file')
  })
})

describe('guessServerFromJar', () => {
  it('recognizes common server jars with versions', () => {
    expect(guessServerFromJar('paper-1.21.4-131.jar')).toEqual({
      serverType: 'paper',
      mcVersion: '1.21.4'
    })
    expect(guessServerFromJar('purpur-1.20.6-2223.jar')).toEqual({
      serverType: 'purpur',
      mcVersion: '1.20.6'
    })
    // Calendar-style Minecraft versions parse too.
    expect(guessServerFromJar('paper-26.2-10.jar')).toEqual({
      serverType: 'paper',
      mcVersion: '26.2'
    })
    expect(guessServerFromJar('minecraft_server.1.21.1.jar')).toEqual({
      serverType: 'vanilla',
      mcVersion: '1.21.1'
    })
    expect(guessServerFromJar('velocity-3.4.0-SNAPSHOT-463.jar').serverType).toBe('velocity')
  })

  it('recognizes types without versions and gives up gracefully', () => {
    expect(guessServerFromJar('fabric-server-launch.jar').serverType).toBe('fabric')
    expect(guessServerFromJar('BungeeCord.jar').serverType).toBe('bungeecord')
    expect(guessServerFromJar('server.jar')).toEqual({})
  })
})

describe('parseWingsStats', () => {
  it('parses a wings stats frame', () => {
    const raw = JSON.stringify({
      memory_bytes: 1024 * 1024 * 512,
      cpu_absolute: 12.34,
      disk_bytes: 1024 * 1024 * 100,
      state: 'running',
      uptime: 5000
    })
    expect(parseWingsStats(raw)).toEqual({
      state: 'running',
      cpuPct: 12.3,
      memMB: 512,
      diskMB: 100,
      uptimeMs: 5000
    })
  })

  it('returns null on malformed frames and defaults missing fields', () => {
    expect(parseWingsStats('not json')).toBeNull()
    expect(parseWingsStats('{}')).toEqual({
      state: 'offline',
      cpuPct: 0,
      memMB: 0,
      diskMB: 0,
      uptimeMs: 0
    })
  })
})
