import { join } from 'node:path'
import { existsSync, rmSync, renameSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { InstallProgress } from '@shared/types'
import type { InstallSpec } from '../software/types'
import { downloadFile } from '../util/net'

export interface InstallResult {
  launchKind: 'jar' | 'args-file'
  launchJar?: string
}

type ProgressFn = (p: InstallProgress) => void

/** Run a java command to completion, rejecting on non-zero exit. */
function runJava(javaPath: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, args, { cwd })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Installer exited with code ${code}: ${stderr.slice(-600)}`))
    )
  })
}

function cleanupInstaller(dir: string, fileName: string): void {
  for (const f of [fileName, `${fileName}.log`, 'installer.log']) {
    try {
      const p = join(dir, f)
      if (existsSync(p)) rmSync(p)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Download (and for installer types, run) a server into `dir`.
 * Returns how the resulting server should be launched.
 */
export async function installServer(
  dir: string,
  spec: InstallSpec,
  javaPath: string,
  onProgress?: ProgressFn
): Promise<InstallResult> {
  const target = join(dir, spec.fileName)
  onProgress?.({ phase: 'download', received: 0, total: 0 })
  await downloadFile(spec.url, target, (received, total) =>
    onProgress?.({ phase: 'download', received, total })
  )

  if (spec.kind === 'jar') {
    // Normalize jar-based servers to server.jar.
    const serverJar = join(dir, 'server.jar')
    if (target !== serverJar) {
      try {
        if (existsSync(serverJar)) rmSync(serverJar)
      } catch {
        /* ignore */
      }
      renameSync(target, serverJar)
    }
    return { launchKind: 'jar', launchJar: 'server.jar' }
  }

  // Installer-based servers (Forge / NeoForge / Quilt).
  onProgress?.({ phase: 'install', message: 'Running installer…' })

  if (spec.installer === 'forge' || spec.installer === 'neoforge') {
    await runJava(javaPath, ['-jar', spec.fileName, '--installServer'], dir)
    cleanupInstaller(dir, spec.fileName)
    return { launchKind: 'args-file' }
  }

  if (spec.installer === 'quilt') {
    const mc = spec.meta?.mc ?? ''
    const loader = spec.meta?.loader ?? ''
    await runJava(
      javaPath,
      ['-jar', spec.fileName, 'install', 'server', mc, loader, '--install-dir=.', '--download-server'],
      dir
    )
    cleanupInstaller(dir, spec.fileName)
    const launchJar = existsSync(join(dir, 'quilt-server-launch.jar'))
      ? 'quilt-server-launch.jar'
      : 'server.jar'
    return { launchKind: 'jar', launchJar }
  }

  throw new Error(`Unknown installer family: ${spec.installer}`)
}
