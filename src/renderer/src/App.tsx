import { useEffect, type ReactElement } from 'react'
import { useApp } from './store'
import FirstRun from './views/FirstRun'
import AppShell from './components/AppShell'
import { BirdflopLogo } from './components/BirdflopLogo'

function Splash(): ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center bg-app text-fg">
      <BirdflopLogo size={48} className="animate-pulse" />
    </div>
  )
}

export default function App(): ReactElement {
  const loading = useApp((s) => s.loading)
  const rootPath = useApp((s) => s.config?.rootPath)
  const init = useApp((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (loading) return <Splash />
  if (!rootPath) return <FirstRun />
  return <AppShell />
}
