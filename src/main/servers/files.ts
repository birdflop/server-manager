import { spawn } from 'node:child_process'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import type { DetectedEditor, FileEntry, FileReadResult } from '@shared/types'
import { instanceDir } from '../store/instances'

/** Files larger than this are not opened in the built-in editor (they're config files). */
const MAX_EDIT_BYTES = 2 * 1024 * 1024

/**
 * Resolve a renderer-supplied relative path against an instance's folder, refusing
 * anything that escapes it (`..`, absolute paths). This is the single guard that keeps
 * the file API scoped to the server's own directory.
 */
function resolveInside(root: string, id: string, relPath: string): string {
  const base = instanceDir(root, id)
  const target = resolve(base, relPath || '.')
  const rel = relative(base, target)
  if (rel !== '' && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))) {
    throw new Error('Path escapes the server directory')
  }
  return target
}

/** List a directory inside an instance (relPath "" = the instance root). Dirs first, then files. */
export function listFiles(root: string, id: string, relPath: string): FileEntry[] {
  const dir = resolveInside(root, id, relPath)
  const entries: FileEntry[] = []
  for (const name of readdirSync(dir)) {
    let isDir = false
    let size = 0
    let mtimeMs = 0
    try {
      const st = statSync(join(dir, name)) // follow symlinks so linked dirs read as dirs
      isDir = st.isDirectory()
      size = st.size
      mtimeMs = st.mtimeMs
    } catch {
      continue // unreadable / broken link — skip
    }
    entries.push({ name, path: relPath ? `${relPath}/${name}` : name, isDir, size, mtimeMs })
  }
  return entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

/** Read a file for the editor, reporting binary/oversize/missing rather than throwing. */
export function readFile(root: string, id: string, relPath: string): FileReadResult {
  const target = resolveInside(root, id, relPath)
  let st
  try {
    st = statSync(target)
  } catch {
    return { ok: false, reason: 'missing', size: 0 }
  }
  if (st.isDirectory()) return { ok: false, reason: 'error', size: 0 }
  if (st.size > MAX_EDIT_BYTES) return { ok: false, reason: 'too-large', size: st.size }
  const buf = readFileSync(target)
  // A NUL byte in the first chunk is the classic, cheap "this is binary" heuristic.
  const scan = buf.subarray(0, Math.min(buf.length, 8000))
  if (scan.includes(0)) return { ok: false, reason: 'binary', size: st.size }
  return { ok: true, content: buf.toString('utf-8'), size: st.size }
}

/** Write text to a file inside an instance, creating any missing parent folders. */
export function writeFile(root: string, id: string, relPath: string, content: string): void {
  const target = resolveInside(root, id, relPath)
  const parent = resolve(target, '..')
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
  writeFileSync(target, content, 'utf-8')
}

// ---- External editor detection ----

type LaunchSpec =
  | { kind: 'exe'; exe: string } // launch a GUI executable directly with the path
  | { kind: 'mac'; app: string } // `open -a <App> <path>`
  | { kind: 'shell'; cmd: string } // a PATH launcher that needs a shell (.cmd/.bat)

interface EditorDef {
  id: string
  name: string
  /** Windows: absolute exe candidates (may contain %ENV% vars) tried before the PATH command. */
  winPaths?: string[]
  /** PATH command name (Windows + Linux). */
  cmd?: string
  /** macOS application name passed to `open -a`. */
  macApp?: string
}

// Ordered by popularity; first match per id wins.
const EDITORS: EditorDef[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    winPaths: [
      '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
      '%ProgramFiles%\\Microsoft VS Code\\Code.exe',
      '%ProgramFiles(x86)%\\Microsoft VS Code\\Code.exe'
    ],
    cmd: 'code',
    macApp: 'Visual Studio Code'
  },
  {
    id: 'cursor',
    name: 'Cursor',
    winPaths: [
      '%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe',
      '%ProgramFiles%\\Cursor\\Cursor.exe'
    ],
    cmd: 'cursor',
    macApp: 'Cursor'
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    winPaths: ['%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe'],
    cmd: 'windsurf',
    macApp: 'Windsurf'
  },
  {
    id: 'vscodium',
    name: 'VSCodium',
    winPaths: ['%LOCALAPPDATA%\\Programs\\VSCodium\\VSCodium.exe'],
    cmd: 'codium',
    macApp: 'VSCodium'
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    winPaths: [
      '%ProgramFiles%\\Sublime Text\\subl.exe',
      '%ProgramFiles%\\Sublime Text 3\\subl.exe'
    ],
    cmd: 'subl',
    macApp: 'Sublime Text'
  },
  {
    id: 'zed',
    name: 'Zed',
    cmd: 'zed',
    macApp: 'Zed'
  },
  {
    id: 'notepadpp',
    name: 'Notepad++',
    winPaths: [
      '%ProgramFiles%\\Notepad++\\notepad++.exe',
      '%ProgramFiles(x86)%\\Notepad++\\notepad++.exe'
    ]
  }
]

/** Expand %VAR% references in a Windows path, dropping the candidate if a var is unset. */
function expandWinPath(p: string): string | null {
  let missing = false
  const out = p.replace(/%([^%]+)%/g, (_m, name: string) => {
    const v = process.env[name]
    if (v === undefined) missing = true
    return v ?? ''
  })
  return missing ? null : out
}

/** Locate a command on PATH, honoring PATHEXT on Windows. Returns the full path or null. */
function which(cmd: string): string | null {
  const isWin = process.platform === 'win32'
  const exts = isWin ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : ['']
  const dirs = (process.env.PATH ?? '').split(isWin ? ';' : ':')
  for (const dir of dirs) {
    if (!dir) continue
    for (const ext of exts) {
      const full = join(dir, cmd + ext)
      try {
        if (statSync(full).isFile()) return full
      } catch {
        /* not here */
      }
    }
  }
  return null
}

function detectOne(def: EditorDef): LaunchSpec | null {
  if (process.platform === 'darwin') {
    if (!def.macApp) return def.cmd && which(def.cmd) ? { kind: 'exe', exe: which(def.cmd)! } : null
    for (const base of ['/Applications', `${process.env.HOME}/Applications`]) {
      if (existsSync(join(base, `${def.macApp}.app`))) return { kind: 'mac', app: def.macApp }
    }
    return null
  }
  if (process.platform === 'win32') {
    for (const p of def.winPaths ?? []) {
      const full = expandWinPath(p)
      if (full && existsSync(full)) return { kind: 'exe', exe: full }
    }
    if (def.cmd) {
      const found = which(def.cmd)
      if (found) {
        // .exe/.com launch directly; .cmd/.bat shims need a shell to run.
        return /\.(exe|com)$/i.test(found) ? { kind: 'exe', exe: found } : { kind: 'shell', cmd: found }
      }
    }
    return null
  }
  // Linux + other POSIX: PATH lookup only.
  if (def.cmd) {
    const found = which(def.cmd)
    if (found) return { kind: 'exe', exe: found }
  }
  return null
}

let editorCache: Map<string, { name: string; spec: LaunchSpec }> | null = null

/** Detect installed text editors. Cached after the first scan. */
export function detectEditors(): DetectedEditor[] {
  if (!editorCache) {
    editorCache = new Map()
    for (const def of EDITORS) {
      const spec = detectOne(def)
      if (spec) editorCache.set(def.id, { name: def.name, spec })
    }
  }
  return [...editorCache].map(([id, { name }]) => ({ id, name }))
}

function spawnDetached(cmd: string, args: string[], shell = false): void {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', shell })
  child.on('error', () => {
    /* editor launch failed; nothing useful to do from the main process */
  })
  child.unref()
}

/** Open an instance's folder (or a file within it) in a detected editor. */
export function openInEditor(root: string, id: string, editorId: string, relPath?: string): void {
  if (!editorCache) detectEditors()
  const entry = editorCache?.get(editorId)
  if (!entry) throw new Error('Editor not available')
  const target = resolveInside(root, id, relPath ?? '')
  const { spec } = entry
  if (spec.kind === 'mac') spawnDetached('open', ['-a', spec.app, target])
  else if (spec.kind === 'exe') spawnDetached(spec.exe, [target])
  else spawnDetached(`"${spec.cmd}" "${target}"`, [], true)
}
