import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { Send, Eraser, Search, ChevronUp, ChevronDown, X, Download, AlertTriangle } from 'lucide-react'
import { useApp } from '../store'

const SEARCH_DECORATIONS = {
  matchBackground: '#54daf455',
  matchOverviewRuler: '#54daf4',
  activeMatchBackground: '#54daf4',
  activeMatchColorOverviewRuler: '#54daf4'
}

const TERM_THEMES = {
  dark: {
    background: '#0d1322',
    foreground: '#d6e1ff',
    cursor: '#54daf4',
    selectionBackground: '#54daf440',
    brightBlack: '#5b5b80'
  },
  light: {
    background: '#f4f6fb',
    foreground: '#1e2433',
    cursor: '#0bb6d6',
    selectionBackground: '#54daf455',
    brightBlack: '#94a3b8'
  }
} as const

export function ConsoleView({ instanceId }: { instanceId: string }): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const status = useApp((s) => s.status[instanceId] ?? 'stopped')
  const theme = useApp((s) => s.config?.theme ?? 'dark')
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [showSearch, setShowSearch] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [saving, setSaving] = useState(false)
  const [diagnosis, setDiagnosis] = useState<{ title: string; hint: string } | null>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
      fontSize: 12,
      convertEol: true,
      cursorBlink: false,
      scrollback: 5000,
      theme: TERM_THEMES[theme]
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.open(containerRef.current as HTMLDivElement)
    fit.fit()
    termRef.current = term
    searchRef.current = search

    void window.api.serverBuffer(instanceId).then((b) => b && term.write(b))
    const unsub = window.api.onServerOutput((e) => {
      if (e.id === instanceId) term.write(e.chunk)
    })

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      unsub()
      ro.disconnect()
      search.dispose()
      term.dispose()
      termRef.current = null
      searchRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  // Update the terminal palette live when the app theme changes.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = TERM_THEMES[theme]
  }, [theme])

  // Surface crash diagnoses as a banner; clear it on a fresh start.
  useEffect(() => {
    setDiagnosis(null)
    return window.api.onServerDiagnosis((e) => {
      if (e.id === instanceId) setDiagnosis({ title: e.title, hint: e.hint })
    })
  }, [instanceId])

  useEffect(() => {
    if (status !== 'stopped') setDiagnosis(null)
  }, [status])

  // Ctrl/Cmd+F toggles the search bar.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setShowSearch(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function findNext(t = searchTerm): void {
    if (t) searchRef.current?.findNext(t, { decorations: SEARCH_DECORATIONS })
  }
  function findPrev(): void {
    if (searchTerm) searchRef.current?.findPrevious(searchTerm, { decorations: SEARCH_DECORATIONS })
  }
  function closeSearch(): void {
    setShowSearch(false)
    setSearchTerm('')
    searchRef.current?.clearDecorations()
  }

  function submit(): void {
    const text = cmd.trim()
    if (!text) return
    void window.api.sendCommand(instanceId, text)
    setHistory((h) => [...h, text])
    setHistIdx(-1)
    setCmd('')
  }

  function clearConsole(): void {
    termRef.current?.clear()
    void window.api.clearServerBuffer(instanceId)
  }

  async function saveLog(): Promise<void> {
    setSaving(true)
    try {
      await window.api.saveServerLog(instanceId)
    } finally {
      setSaving(false)
    }
  }

  const disabled = status === 'stopped'

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        {showSearch ? (
          <div className="flex flex-1 items-center gap-1 rounded-md border border-border bg-input px-2 py-1">
            <Search size={13} className="text-fg-muted" />
            <input
              ref={searchInputRef}
              value={searchTerm}
              autoFocus
              onChange={(e) => {
                setSearchTerm(e.target.value)
                findNext(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (e.shiftKey) findPrev()
                  else findNext()
                } else if (e.key === 'Escape') {
                  closeSearch()
                }
              }}
              placeholder="Search console…"
              className="flex-1 bg-transparent text-xs outline-none"
            />
            <button
              onClick={findPrev}
              title="Previous match (Shift+Enter)"
              className="rounded p-0.5 text-fg-muted hover:text-fg"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={() => findNext()}
              title="Next match (Enter)"
              className="rounded p-0.5 text-fg-muted hover:text-fg"
            >
              <ChevronDown size={14} />
            </button>
            <button onClick={closeSearch} title="Close" className="rounded p-0.5 text-fg-muted hover:text-fg">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setShowSearch(true)
              setTimeout(() => searchInputRef.current?.focus(), 0)
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <Search size={13} /> Search
          </button>
        )}
        {!showSearch && <div className="flex-1" />}
        <button
          onClick={() => void saveLog()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        >
          <Download size={13} /> Save log
        </button>
        <button
          onClick={clearConsole}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <Eraser size={13} /> Clear console
        </button>
      </div>
      {diagnosis && (
        <div className="flex items-start gap-2 rounded-brand border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{diagnosis.title}</div>
            <div className="text-amber-200/80">{diagnosis.hint}</div>
          </div>
          <button
            onClick={() => setDiagnosis(null)}
            className="shrink-0 rounded p-0.5 text-amber-300/70 transition hover:text-amber-200"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-hidden rounded-brand border border-border p-2"
        style={{ backgroundColor: TERM_THEMES[theme].background }}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex items-center gap-2"
      >
        <input
          value={cmd}
          disabled={disabled}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && history.length) {
              e.preventDefault()
              const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1)
              setHistIdx(idx)
              setCmd(history[idx])
            } else if (e.key === 'ArrowDown' && histIdx >= 0) {
              e.preventDefault()
              const idx = histIdx + 1
              if (idx >= history.length) {
                setHistIdx(-1)
                setCmd('')
              } else {
                setHistIdx(idx)
                setCmd(history[idx])
              }
            }
          }}
          placeholder={disabled ? 'Server is stopped' : 'Type a command (e.g. say hello, op <player>)'}
          className="flex-1 rounded-brand bg-input px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-brand bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
        >
          <Send size={15} /> Send
        </button>
      </form>
    </div>
  )
}
