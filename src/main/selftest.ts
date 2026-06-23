import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import type { Instance, ServerType } from '@shared/types'
import { getProvider } from './software'
import { detectJava } from './java/detect'
import { ensureJava } from './java/adoptium'
import { requiredJavaMajor } from './java/requirements'
import { installServer } from './servers/install'
import { writeEula, setServerProperties } from './servers/properties'
import * as servers from './servers/registry'
import { downloadFile } from './util/net'
import { searchModrinth, resolveModrinthDownload } from './modrinth'
import { searchHangar, resolveHangarDownload } from './hangar'
import { searchSpiget, resolveSpigetDownload } from './spiget'
import { createBackup, listBackups, restoreBackup } from './servers/backups'
import { importInstance } from './store/instances'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const TYPES: ServerType[] = [
  'paper',
  'purpur',
  'vanilla',
  'fabric',
  'quilt',
  'forge',
  'neoforge',
  'velocity',
  'waterfall',
  'bungeecord'
]

/** Dev-only integration check: exercises every provider + Java detection against the real world. */
export async function runSelfTest(): Promise<void> {
  console.log('\n=== PROVIDER SELF-TEST ===')
  for (const type of TYPES) {
    try {
      const provider = getProvider(type)
      const versions = await provider.listGameVersions()
      const mc = versions[0]
      const builds = await provider.listBuilds(mc)
      const build = builds[0]
      const spec = await provider.resolveInstall(mc, build.id)
      console.log(
        `[${type}] versions=${versions.length} (newest ${mc}); builds=${builds.length} (newest ${build.label}); ` +
          `install=${spec.kind} -> ${spec.fileName}`
      )
      console.log(`         url: ${spec.url}`)
    } catch (err) {
      console.error(`[${type}] FAILED:`, err instanceof Error ? err.message : err)
    }
  }

  console.log('\n=== JAVA REQUIREMENTS ===')
  for (const mc of ['1.16.5', '1.18.2', '1.20.4', '1.20.6', '1.21.4']) {
    console.log(`  ${mc} -> Java ${requiredJavaMajor(mc)}`)
  }

  console.log('\n=== DETECTED JAVA ===')
  const javas = detectJava()
  if (javas.length === 0) console.log('  (none found)')
  for (const j of javas) {
    console.log(`  Java ${j.major} (${j.version})${j.managed ? ' [managed]' : ''} -> ${j.path}`)
  }
  if (process.env.BSM_TESTJAVA) {
    const major = Number(process.env.BSM_TESTJAVA)
    console.log(`\n=== ADOPTIUM DOWNLOAD TEST (Java ${major}) ===`)
    try {
      let lastPhase = ''
      const install = await ensureJava(major, (p) => {
        if (p.phase !== lastPhase) {
          lastPhase = p.phase
          console.log(`  ${p.phase}${p.total ? ` (${Math.round(p.total / 1e6)} MB)` : ''}`)
        }
      })
      console.log(`  installed Java ${install.major} -> ${install.path}`)
    } catch (err) {
      console.error('  FAILED:', err instanceof Error ? err.message : err)
    }
  }

  if (process.env.BSM_TESTCREATE) {
    console.log('\n=== CREATE PIPELINE TEST (Paper) ===')
    try {
      const dir = join(tmpdir(), `bsm-create-${Date.now()}`)
      mkdirSync(dir, { recursive: true })
      const provider = getProvider('paper')
      const mc = (await provider.listGameVersions())[0]
      const builds = await provider.listBuilds(mc)
      const spec = await provider.resolveInstall(mc, builds[0].id)
      const result = await installServer(dir, spec, 'java', (p) => {
        if (p.phase !== 'download') console.log(`  ${p.phase}`)
      })
      writeEula(dir, true)
      setServerProperties(dir, { 'server-port': 25599 })
      console.log(`  launchKind=${result.launchKind} jar=${result.launchJar}`)
      console.log(`  files: ${readdirSync(dir).join(', ')}`)
      console.log(`  eula.txt: ${readFileSync(join(dir, 'eula.txt'), 'utf-8').trim()}`)
      console.log(
        `  server.properties server-port: ${readFileSync(join(dir, 'server.properties'), 'utf-8').match(/server-port=.*/)?.[0]}`
      )
    } catch (err) {
      console.error('  FAILED:', err instanceof Error ? err.message : err)
    }
  }

  if (process.env.BSM_TESTRUN) {
    console.log('\n=== SERVER RUN TEST (Paper) ===')
    try {
      const provider = getProvider('paper')
      const versions = await provider.listGameVersions()
      const mc = versions.find((v) => v.startsWith('1.21')) ?? versions[0]
      const builds = await provider.listBuilds(mc)
      const spec = await provider.resolveInstall(mc, builds[0].id)
      const dir = join(tmpdir(), `bsm-run-${Date.now()}`)
      mkdirSync(dir, { recursive: true })

      const required = requiredJavaMajor(mc)
      const javas = detectJava()
      const java = javas.find((j) => j.major >= required) ?? javas[0]
      console.log(`  mc=${mc} build=${builds[0].id} java=${java?.major} required=${required}`)

      const result = await installServer(dir, spec, java.path)
      writeEula(dir, true)
      setServerProperties(dir, { 'server-port': 25577, 'online-mode': 'false' })

      const instance: Instance = {
        id: 'runtest',
        name: 'RunTest',
        serverType: 'paper',
        mcVersion: mc,
        build: builds[0].id,
        launchKind: result.launchKind,
        launchJar: result.launchJar,
        port: 25577,
        ramMB: 2048,
        javaPath: java.path,
        jvmArgs: [],
        eulaAccepted: true,
        createdAt: Date.now()
      }

      servers.start(instance, dir)
      const startedAt = Date.now()
      while (Date.now() - startedAt < 90000) {
        await delay(1000)
        if (/Done \(/.test(servers.bufferOf('runtest'))) {
          console.log('  ✓ server reached "Done" — startup OK')
          break
        }
        if (servers.statusOf('runtest') === 'stopped') {
          console.log('  ✗ server exited before starting')
          break
        }
      }
      console.log(`  status after start: ${servers.statusOf('runtest')}`)
      console.log('  --- last console lines ---')
      console.log(
        servers
          .bufferOf('runtest')
          .split('\n')
          .slice(-10)
          .map((l) => `   ${l}`)
          .join('\n')
      )

      servers.sendCommand('runtest', 'say hello from selftest')
      await delay(1500)
      servers.stop('runtest')
      const stopAt = Date.now()
      while (Date.now() - stopAt < 30000) {
        await delay(1000)
        if (servers.statusOf('runtest') === 'stopped') break
      }
      console.log(`  final status: ${servers.statusOf('runtest')}`)
    } catch (err) {
      console.error('  FAILED:', err instanceof Error ? err.message : err)
    }
  }

  if (process.env.BSM_TESTMODRINTH) {
    console.log('\n=== MODRINTH TEST ===')
    try {
      const hits = await searchModrinth('sodium', ['fabric'])
      console.log(`  search 'sodium' (fabric): ${hits.length} hits`)
      console.log(`  top: ${hits[0]?.title} by ${hits[0]?.author} (${hits[0]?.downloads} dl)`)
      if (hits[0]) {
        const dl = await resolveModrinthDownload(hits[0].id, ['fabric'], '1.21.4')
        console.log(`  resolved file: ${dl.filename}`)
      }
      const plugins = await searchModrinth('essentials', ['paper', 'spigot', 'bukkit'])
      console.log(`  modrinth 'essentials' (paper): ${plugins.length} hits; top: ${plugins[0]?.title}`)

      const hangar = await searchHangar('essentials')
      console.log(`  hangar 'essentials': ${hangar.length} hits; top: ${hangar[0]?.title} (${hangar[0]?.id})`)
      if (hangar[0]) {
        const hd = await resolveHangarDownload(hangar[0].id)
        const tmp = join(tmpdir(), `bsm-hangar-${Date.now()}.jar`)
        await downloadFile(hd.url, tmp)
        const magic = readFileSync(tmp).subarray(0, 2)
        const ok = magic[0] === 0x50 && magic[1] === 0x4b
        console.log(`  hangar downloaded ${hd.filename}: ${ok ? 'VALID jar' : 'NOT a jar'}`)
      }

      const spigot = await searchSpiget('essentials')
      const direct = spigot.find((s) => !s.external)
      console.log(
        `  spigot 'essentials': ${spigot.length} hits; top: ${spigot[0]?.title} (external=${spigot[0]?.external}); first direct: ${direct?.title ?? 'none'}`
      )
      if (direct) {
        const sd = await resolveSpigetDownload(direct.id)
        const tmp = join(tmpdir(), `bsm-spigot-${Date.now()}.jar`)
        await downloadFile(sd.url, tmp)
        const magic = readFileSync(tmp).subarray(0, 2)
        const ok = magic[0] === 0x50 && magic[1] === 0x4b
        console.log(`  spigot downloaded ${sd.filename}: ${ok ? 'VALID jar' : 'NOT a jar (external/HTML)'}`)
      }
    } catch (err) {
      console.error('  FAILED:', err instanceof Error ? err.message : err)
    }
  }

  if (process.env.BSM_TESTBACKUP) {
    console.log('\n=== BACKUP ROUND-TRIP TEST ===')
    try {
      const root = join(tmpdir(), `bsm-backup-${Date.now()}`)
      const id = 'b1'
      const inst = join(root, 'instances', id)
      mkdirSync(inst, { recursive: true })
      writeFileSync(join(inst, 'marker.txt'), 'original')
      const list = createBackup(root, id)
      console.log(`  created backup: ${list[0]?.name} (${list.length} total)`)
      writeFileSync(join(inst, 'marker.txt'), 'CHANGED')
      restoreBackup(root, id, list[0].name)
      const restored = readFileSync(join(inst, 'marker.txt'), 'utf8')
      console.log(`  after restore, marker.txt = "${restored}" (${restored === 'original' ? 'OK' : 'FAIL'})`)
      console.log(`  listBackups: ${listBackups(root, id).length}`)
    } catch (err) {
      console.error('  FAILED:', err instanceof Error ? err.message : err)
    }
  }

  if (process.env.BSM_TESTIMPORT) {
    console.log('\n=== IMPORT (symlink/junction) TEST ===')
    try {
      const stamp = Date.now()
      const root = join(tmpdir(), `bsm-import-root-${stamp}`)
      const parent = join(tmpdir(), `bsm-import-src-${stamp}`)
      const src = join(parent, 'server')
      const target = join(parent, 'disabled-target')
      mkdirSync(join(src, 'plugins'), { recursive: true })
      mkdirSync(root, { recursive: true })
      mkdirSync(target, { recursive: true })
      writeFileSync(join(src, 'server.jar'), 'jar')
      writeFileSync(join(target, 'old-plugin.jar'), 'old')
      // Reproduce the failing case: a link at plugins/disabled (junction on Windows,
      // needs no privilege; symlink elsewhere).
      const link = join(src, 'plugins', 'disabled')
      if (process.platform === 'win32') spawnSync('cmd', ['/c', 'mklink', '/J', link, target])
      else symlinkSync(target, link)

      const result = importInstance(root, {
        sourcePath: src,
        name: 'Imported',
        serverType: 'paper',
        mcVersion: '1.21.4',
        launchKind: 'jar',
        launchJar: 'server.jar',
        port: 25565,
        ramMB: 2048,
        javaPath: 'java',
        jvmArgs: [],
        groupId: null
      })
      const dest = join(root, 'instances', result.instance.id)
      console.log(`  server.jar copied: ${existsSync(join(dest, 'server.jar'))}`)
      console.log(
        `  plugins/disabled resolved + copied: ${existsSync(join(dest, 'plugins', 'disabled', 'old-plugin.jar'))}`
      )
      console.log('  no privilege error thrown — OK')
    } catch (err) {
      console.error('  FAILED:', err instanceof Error ? err.message : err)
    }
  }

  console.log('=== END SELF-TEST ===\n')
}
