import { Moon, Sun } from 'lucide-react'
import type { ReactElement } from 'react'
import { useApp } from '../store'

export function ThemeToggle(): ReactElement {
  const theme = useApp((s) => s.config?.theme ?? 'dark')
  const toggleTheme = useApp((s) => s.toggleTheme)
  return (
    <button
      onClick={() => void toggleTheme()}
      className="grid h-8 w-8 place-items-center rounded-brand border border-border text-fg-muted transition hover:bg-surface-2 hover:text-fg"
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
