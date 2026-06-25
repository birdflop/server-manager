import { app, BrowserWindow } from 'electron'
import pkg from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { getConfig } from './config'

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

/**
 * Point the updater at the channel the user picked.
 *
 * Stable: read `latest.yml` from the newest non-prerelease GitHub release. allowDowngrade lets a
 * user on a higher dev build drop back onto the latest stable.
 * Dev: read `dev.yml` from the newest `-dev.*` prerelease (electron-updater scans the releases feed
 * for a matching channel; see GitHubProvider). allowPrerelease surfaces those prereleases.
 *
 * Safe to call repeatedly — used on init and whenever the channel setting changes.
 */
export function applyUpdateChannel(): void {
  const dev = getConfig().releaseChannel === 'dev'
  autoUpdater.channel = dev ? 'dev' : 'latest'
  autoUpdater.allowPrerelease = dev
  autoUpdater.allowDowngrade = !dev
}

export function initUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  applyUpdateChannel()

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
