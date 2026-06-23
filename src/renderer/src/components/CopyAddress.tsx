import { useState, type MouseEvent, type ReactElement } from 'react'
import { Copy, Check } from 'lucide-react'

/** Shows the local connect address (localhost:port) with a one-click copy button. */
export function CopyAddress({ port, className }: { port: number; className?: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  const address = `localhost:${port}`

  function copy(e: MouseEvent): void {
    e.stopPropagation()
    void window.api.copyText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <button
      onClick={copy}
      title="Copy connect address"
      className={`inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-fg-muted transition hover:bg-surface-2 hover:text-fg ${className ?? ''}`}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {address}
    </button>
  )
}
