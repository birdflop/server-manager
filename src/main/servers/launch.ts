import { join } from 'node:path'
import { existsSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import type { Instance } from '@shared/types'
import { isProxy } from '@shared/software'

export interface LaunchCmd {
  command: string
  args: string[]
}

function memArgs(ramMB: number): string[] {
  return [`-Xmx${ramMB}M`, `-Xms${ramMB}M`]
}

/** JDWP agent args for remote debugging, or [] when disabled. */
function debugArgs(instance: Instance): string[] {
  const dbg = instance.debug
  if (!dbg?.enabled) return []
  const suspend = dbg.suspend ? 'y' : 'n'
  // address=*:<port> binds all interfaces so an IDE on the host can attach.
  return [`-agentlib:jdwp=transport=dt_socket,server=y,suspend=${suspend},address=*:${dbg.port}`]
}

/** Locate the Forge/NeoForge platform args file produced by the installer. */
function findArgsFile(dir: string): string | null {
  const target = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt'
  const libraries = join(dir, 'libraries')
  if (!existsSync(libraries)) return null
  const stack = [libraries]
  while (stack.length) {
    const cur = stack.pop() as string
    let entries: string[]
    try {
      entries = readdirSync(cur)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(cur, entry)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (entry === target) return full
    }
  }
  return null
}

/** Build the java command + args to launch a server in its directory. */
export function buildLaunch(instance: Instance, dir: string): LaunchCmd {
  const java = instance.javaPath || 'java'

  if (instance.launchKind === 'args-file') {
    // Forge/NeoForge launch via @argfiles. We own user_jvm_args.txt (memory + extras).
    const userArgs =
      [...memArgs(instance.ramMB), ...debugArgs(instance), ...instance.jvmArgs].join('\n') + '\n'
    writeFileSync(join(dir, 'user_jvm_args.txt'), userArgs, 'utf-8')
    const argsFile = findArgsFile(dir)
    if (!argsFile) {
      throw new Error('Could not find the Forge/NeoForge launch args file. Try recreating the server.')
    }
    const rel = argsFile.substring(dir.length + 1)
    return { command: java, args: ['@user_jvm_args.txt', `@${rel}`, 'nogui'] }
  }

  // Runnable jar (Paper / Purpur / Vanilla / Fabric / Quilt / proxies).
  const jar = instance.launchJar || 'server.jar'
  const args = [...memArgs(instance.ramMB), ...debugArgs(instance), ...instance.jvmArgs, '-jar', jar]
  // Proxies (Velocity / BungeeCord / Waterfall) have no GUI and reject the `nogui` flag.
  if (!isProxy(instance.serverType)) args.push('nogui')
  return { command: java, args }
}
