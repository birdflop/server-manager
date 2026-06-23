import { app, BrowserWindow } from 'electron'
import pkg from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

// electron-updater is CommonJS; pull autoUpdater off the default export.
const { autoUpdater } = pkg

let lastStatus: UpdateStatus = { state: 'idle' }

function broadcast(status: UpdateStatus): void {
  lastStatus = status
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('updater:status', status)
}

export function getUpdateStatus(): UpdateStatus {
  return lastStatus
}

export function initUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    broadcast({ state: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', () => broadcast({ state: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    broadcast({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) => broadcast({ state: 'error', message: err.message }))
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    broadcast({ state: 'dev' })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    broadcast({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    broadcast({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

export function quitAndInstall(): void {
  if (app.isPackaged) autoUpdater.quitAndInstall()
}
