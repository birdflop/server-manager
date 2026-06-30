import type { ReactElement } from 'react'
import { useApp } from '../store'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import Dashboard from '../views/Dashboard'
import ServerView from '../views/ServerView'
import CreateInstanceWizard from '../modals/CreateInstanceWizard'
import UpdateModal from '../modals/UpdateModal'
import AppSettingsModal from '../modals/AppSettingsModal'
import ImportModal from '../modals/ImportModal'
import TestMatrixModal from '../modals/TestMatrixModal'

export default function AppShell(): ReactElement {
  const activeTabId = useApp((s) => s.activeTabId)
  const exists = useApp((s) => s.index.instances.some((i) => i.id === activeTabId))
  const wizardOpen = useApp((s) => s.wizardOpen)
  const updateModalOpen = useApp((s) => s.updateModalOpen)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const importOpen = useApp((s) => s.importOpen)
  const matrixOpen = useApp((s) => s.matrixOpen)

  return (
    <div className="flex h-full w-full bg-app text-fg">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <div className="min-h-0 flex-1">
          {activeTabId && exists ? <ServerView instanceId={activeTabId} /> : <Dashboard />}
        </div>
      </main>
      {wizardOpen && <CreateInstanceWizard />}
      {updateModalOpen && <UpdateModal />}
      {settingsOpen && <AppSettingsModal />}
      {importOpen && <ImportModal />}
      {matrixOpen && <TestMatrixModal />}
    </div>
  )
}
