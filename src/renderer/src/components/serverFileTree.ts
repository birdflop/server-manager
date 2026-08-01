import { useCallback, useState, type CSSProperties, type PointerEvent } from 'react'
import type { FileEntry } from '@shared/types'

/**
 * Shared bits for the @pierre/trees file viewers (local FilesView + PanelFilesView).
 *
 * Trees identifies items by path alone: directories are canonical when they end
 * with "/" (e.g. "plugins/"), files never do. The helpers here convert between
 * those tree paths and the app's FileEntry paths (which never carry a slash).
 */

/**
 * Map the app's brand palette onto trees' theming variables. `--trees-*-override`
 * beats the theme tier, which beats the library defaults. Values reference the
 * global --c-* custom properties so light/dark switching applies live.
 */
export const TREE_HOST_STYLE: CSSProperties = {
  flex: '1 1 0%',
  minHeight: 0,
  '--trees-bg-override': 'var(--c-app)',
  '--trees-fg-override': 'var(--c-fg)',
  '--trees-fg-muted-override': 'var(--c-fg-muted)',
  '--trees-bg-muted-override': 'var(--c-surface-2)',
  '--trees-border-color-override': 'var(--c-border)',
  '--trees-accent-override': 'var(--c-accent)',
  '--trees-selected-bg-override': 'var(--c-surface-2)',
  '--trees-selected-fg-override': 'var(--c-fg)',
  '--trees-focus-ring-color-override': 'var(--c-accent)',
  '--trees-input-bg-override': 'var(--c-input)',
  '--trees-font-family-override':
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  '--trees-theme-scrollbar-thumb': 'var(--c-border)',
  '--trees-theme-input-fg': 'var(--c-fg)'
} as CSSProperties

const TREE_WIDTH_KEY = 'fileTreeWidth'
const TREE_MIN_WIDTH = 200
const TREE_MAX_WIDTH = 640

/**
 * Drag-to-resize width for the file-tree sidebar, persisted across sessions
 * (one shared width for both the local and panel viewers). Attach
 * `onPointerDown` to a thin handle on the sidebar's right edge.
 */
export function useTreeWidth(): {
  width: number
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void
} {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(TREE_WIDTH_KEY))
    return saved >= TREE_MIN_WIDTH && saved <= TREE_MAX_WIDTH ? saved : 288
  })

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startWidth = width
      let latest = startWidth

      function onMove(ev: globalThis.PointerEvent): void {
        latest = Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, startWidth + ev.clientX - startX))
        setWidth(latest)
      }
      function onUp(): void {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        localStorage.setItem(TREE_WIDTH_KEY, String(latest))
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },
    [width]
  )

  return { width, onPointerDown }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Canonical tree path for a listing entry ("plugins/" for dirs, "plugins/x.jar" for files). */
export function treePath(entry: FileEntry): string {
  return entry.isDir ? `${entry.path}/` : entry.path
}

/** FileEntry-style path (never a trailing slash) from a canonical tree path. */
export function entryPath(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}

/** Last path segment, without any trailing slash ("plugins/foo/" → "foo"). */
export function baseName(path: string): string {
  const parts = entryPath(path).split('/')
  return parts[parts.length - 1]
}

/** Canonical parent directory ("plugins/" for "plugins/x.jar", "" for root items). */
export function parentTreePath(path: string): string {
  const parts = entryPath(path).split('/')
  return parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : ''
}

/** Remap `path` after a move from → to (canonical paths); null when unaffected. */
export function remapPath(path: string, from: string, to: string): string | null {
  if (path === from) return to
  if (from.endsWith('/') && path.startsWith(from)) return to + path.slice(from.length)
  return null
}

/** Rewrite the keys of a path-keyed map after a move (canonical paths). */
export function remapMapKeys<V>(map: Map<string, V>, from: string, to: string): void {
  for (const [key, value] of [...map]) {
    const next = remapPath(key, from, to)
    if (next !== null) {
      map.delete(key)
      map.set(next, value)
    }
  }
}

/** Rewrite the members of a path set after a move (canonical paths). */
export function remapSet(set: Set<string>, from: string, to: string): void {
  for (const key of [...set]) {
    const next = remapPath(key, from, to)
    if (next !== null) {
      set.delete(key)
      set.add(next)
    }
  }
}

/** Drop map keys at or under a removed path (canonical paths). */
export function dropMapKeys<V>(map: Map<string, V>, removed: string): void {
  for (const key of [...map.keys()]) {
    if (key === removed || (removed.endsWith('/') && key.startsWith(removed))) map.delete(key)
  }
}

/** Drop set members at or under a removed path (canonical paths). */
export function dropSetMembers(set: Set<string>, removed: string): void {
  for (const key of [...set]) {
    if (key === removed || (removed.endsWith('/') && key.startsWith(removed))) set.delete(key)
  }
}
