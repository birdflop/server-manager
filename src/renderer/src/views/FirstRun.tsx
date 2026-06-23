import { useState, type ReactElement } from 'react'
import { FolderOpen } from 'lucide-react'
import { useApp } from '../store'
import { ThemeToggle } from '../components/ThemeToggle'
import { BirdflopLogo } from '../components/BirdflopLogo'

export default function FirstRun(): ReactElement {
  const chooseRoot = useApp((s) => s.chooseRoot)
  const [busy, setBusy] = useState(false)

  async function pick(): Promise<void> {
    setBusy(true)
    try {
      await chooseRoot()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-app text-fg">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-lg rounded-brand border border-border bg-surface p-10 text-center shadow-xl">
        <BirdflopLogo size={72} className="mx-auto mb-5" />
        <h1 className="text-2xl font-semibold">Welcome to Birdflop Server Manager</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-fg-muted">
          Pick a folder where your Minecraft servers will be stored. Each server gets its own
          subfolder, and an index file keeps everything organized. You can move this folder later.
        </p>

        <button
          onClick={() => void pick()}
          disabled={busy}
          className="mx-auto mt-8 inline-flex items-center gap-2 rounded-brand bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-60"
        >
          <FolderOpen size={18} />
          {busy ? 'Opening…' : 'Choose servers folder'}
        </button>
      </div>
    </div>
  )
}
