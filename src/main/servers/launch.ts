import { join } from 'node:path'
import { existsSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import type { Instance, LaunchPreview } from '@shared/types'
import { isProxy } from '@shared/software'

export interface LaunchCmd {
  command: string
  args: string[]
}

/**
 * Split a custom startup command into tokens, honoring single/double quotes
 * (e.g. paths with spaces). No escapes — quotes cover the real cases.
 */
export function tokenizeCommand(line: string): string[] {
  const tokens: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(line); m; m = re.exec(line)) {
    tokens.push(m[1] ?? m[2] ?? m[3])
  }
  return tokens
}

function memArgs(ramMB: number): string[] {
  return [`-Xmx${ramMB}M`, `-Xms${ramMB}M`]
}

/**
 * Force Log4j's TerminalConsoleAppender (Paper/Purpur/Velocity/Waterfall) to emit
 * ANSI color even though we pipe stdout instead of attaching a TTY. Without this the
 * server detects "no terminal" and strips its own colors — which is why console color
 * shows up when launched from a dev shell but not from a packaged app (no inherited
 * TERM). Unknown to JVMs that don't use the appender (Vanilla/Forge), so it's harmless.
 */
const ANSI_PROP = '-Dterminal.ansi=true'

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

/** Args after the jar: explicit config, or the per-type default. */
function gameArgs(instance: Instance): string[] {
  if (instance.gameArgs) return instance.gameArgs
  // Proxies (Velocity / BungeeCord / Waterfall) have no GUI and reject the `nogui` flag.
  return isProxy(instance.serverType) ? [] : ['nogui']
}

/** Content of the user_jvm_args.txt we own for Forge/NeoForge launches. */
function userJvmArgsContent(instance: Instance): string {
  return (
    [ANSI_PROP, ...memArgs(instance.ramMB), ...debugArgs(instance), ...instance.jvmArgs].join('\n') +
    '\n'
  )
}

/**
 * The exact command a server would launch with — pure (no side effects), so it
 * doubles as the Settings-tab preview.
 */
export function previewLaunch(instance: Instance, dir: string): LaunchPreview {
  const override = instance.launchOverride?.trim()
  if (override) {
    const tokens = tokenizeCommand(override)
    if (tokens.length > 0) {
      return {
        command: tokens[0],
        args: tokens.slice(1),
        overridden: true,
        userJvmArgs:
          instance.launchKind === 'args-file' ? userJvmArgsContent(instance) : undefined
      }
    }
  }

  const java = instance.javaPath || 'java'

  if (instance.launchKind === 'args-file') {
    // Forge/NeoForge launch via @argfiles. We own user_jvm_args.txt (memory + extras).
    const argsFile = findArgsFile(dir)
    const rel = argsFile ? argsFile.substring(dir.length + 1) : '<launch args file not found>'
    return {
      command: java,
      args: ['@user_jvm_args.txt', `@${rel}`, ...gameArgs(instance)],
      overridden: false,
      userJvmArgs: userJvmArgsContent(instance)
    }
  }

  // Runnable jar (Paper / Purpur / Vanilla / Fabric / Quilt / proxies).
  const jar = instance.launchJar || 'server.jar'
  return {
    command: java,
    args: [
      ANSI_PROP,
      ...memArgs(instance.ramMB),
      ...debugArgs(instance),
      ...instance.jvmArgs,
      '-jar',
      jar,
      ...gameArgs(instance)
    ],
    overridden: false
  }
}

/** Build the java command + args to launch a server in its directory. */
export function buildLaunch(instance: Instance, dir: string): LaunchCmd {
  const preview = previewLaunch(instance, dir)
  if (instance.launchKind === 'args-file') {
    // Regenerated every start so RAM/JVM edits apply — even under an override
    // whose command keeps referencing @user_jvm_args.txt.
    writeFileSync(join(dir, 'user_jvm_args.txt'), userJvmArgsContent(instance), 'utf-8')
    if (!preview.overridden && !findArgsFile(dir)) {
      throw new Error(
        'Could not find the Forge/NeoForge launch args file. Try recreating the server.'
      )
    }
  }
  return { command: preview.command, args: preview.args }
}
