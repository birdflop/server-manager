import type { Instance } from '@shared/types'
import { requiredJavaMajor } from '../java/requirements'

export interface Diagnosis {
  title: string
  hint: string
}

/**
 * Inspect a stopped server's recent output + exit code and, when we recognize a
 * known failure, return a plain-language explanation + suggested fix. Returns
 * null for ordinary/clean exits so we don't cry wolf.
 */
export function diagnose(buffer: string, code: number | null, instance: Instance): Diagnosis | null {
  // Look at the tail — the relevant error is almost always near the end.
  const tail = buffer.slice(-8000)

  if (/agree to the eula/i.test(tail) || /eula\.txt/i.test(tail)) {
    return {
      title: 'EULA not accepted',
      hint: 'The Minecraft EULA hasn’t been accepted. Open Settings → enable the EULA (or set eula=true in eula.txt), then start again.'
    }
  }

  if (
    /FAILED TO BIND TO PORT/i.test(tail) ||
    /Address already in use/i.test(tail) ||
    /BindException/i.test(tail)
  ) {
    return {
      title: `Port ${instance.port} is already in use`,
      hint: `Another process (or another running server) is using port ${instance.port}. Stop it, or change this server’s port in Settings.`
    }
  }

  if (
    /UnsupportedClassVersionError/i.test(tail) ||
    /has been compiled by a more recent version of the Java Runtime/i.test(tail) ||
    /class file version/i.test(tail)
  ) {
    const major = requiredJavaMajor(instance.mcVersion)
    return {
      title: 'Wrong Java version',
      hint: `This server needs Java ${major}, but it was launched with an older runtime. Pick a Java ${major} install in Settings (the app can download one).`
    }
  }

  if (/OutOfMemoryError/i.test(tail) || code === 137) {
    return {
      title: 'Out of memory',
      hint: `The server ran out of memory (currently ${instance.ramMB} MB). Increase the memory allocation in Settings.`
    }
  }

  if (/Invalid or corrupt jarfile/i.test(tail) || /Could not find or load main class/i.test(tail)) {
    return {
      title: 'Server jar problem',
      hint: 'The server jar is missing or corrupt. Try recreating the server, or re-downloading its build.'
    }
  }

  if (/Incompatible magic value/i.test(tail) || /Unsupported major\.minor version/i.test(tail)) {
    return {
      title: 'Incompatible jar',
      hint: 'A jar (server or plugin/mod) is incompatible with this runtime. Check recently added plugins/mods.'
    }
  }

  // Unknown failure, but it didn't exit cleanly — give a generic nudge.
  if (code !== 0 && code !== null) {
    return {
      title: `Stopped unexpectedly (exit code ${code})`,
      hint: 'The server exited with an error. Scroll up in the console for the stack trace — a plugin/mod or config issue is the usual cause.'
    }
  }

  return null
}
