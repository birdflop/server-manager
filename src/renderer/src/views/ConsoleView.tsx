import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Send, Eraser } from 'lucide-react'
import { useApp } from '../store'

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
  const status = useApp((s) => s.status[instanceId] ?? 'stopped')
  const theme = useApp((s) => s.config?.theme ?? 'dark')
  const [cmd, setCmd] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)

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
    term.loadAddon(fit)
    term.open(containerRef.current as HTMLDivElement)
    fit.fit()
    termRef.current = term

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
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  // Update the terminal palette live when the app theme changes.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = TERM_THEMES[theme]
  }, [theme])

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

  const disabled = status === 'stopped'

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center justify-end">
        <button
          onClick={clearConsole}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <Eraser size={13} /> Clear console
        </button>
      </div>
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
