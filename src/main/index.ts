import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'
import { join, dirname } from 'node:path'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { registerIpc } from './ipc'
import { runSelfTest } from './selftest'
import { stopAll } from './servers/registry'
import { stopAllTunnels } from './tunnels/registry'
import { initUpdater, checkForUpdates } from './updater'
import { getConfig } from './config'
import { birdflopLogoSvg } from '@shared/logo'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

/** Path to the bundled app icon (extraResources in packaged builds, build/ in dev). */
function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')
}

/** Dev-only: render the Birdflop brand mark to a PNG for use as the app icon. */
async function generateIcon(outPath: string): Promise<void> {
  const html =
    '<body style="margin:0"><div style="width:1024px;height:1024px;background:#101828;' +
    'border-radius:220px;display:flex;align-items:center;justify-content:center">' +
    birdflopLogoSvg(680) +
    '</div></body>'
  const win = new BrowserWindow({ width: 1024, height: 1024, frame: false, show: false })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage()
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, img.resize({ width: 1024, height: 1024 }).toPNG())
  win.destroy()
}

const isDev = !!process.env.ELECTRON_RENDERER_URL

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#101828',
    title: 'Birdflop Server Manager',
    icon: existsSync(iconPath()) ? iconPath() : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    mainWindow = null
  })

  // Minimize to tray instead of quitting, when enabled.
  win.on('close', (e) => {
    if (!isQuitting && getConfig().minimizeToTray) {
      e.preventDefault()
      win.hide()
    }
  })

  // Open external links in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Dev-only: capture a screenshot once the renderer settles, then exit.
  const shot = process.env.BSM_SCREENSHOT
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          // Optionally drive the UI before capturing.
          const script = process.env.BSM_DRIVE
          if (script) {
            await win.webContents.executeJavaScript(script)
            await new Promise((r) => setTimeout(r, 1500))
          }
          const img = await win.webContents.capturePage()
          writeFileSync(shot, img.toPNG())
          console.log('[screenshot] wrote', shot)
        } catch (err) {
          console.error('[screenshot] failed', err)
        }
        app.quit()
      }, 2500)
    })
  }
}

function showMain(): void {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

function createTray(): void {
  const p = iconPath()
  if (tray || !existsSync(p)) return
  const img = nativeImage.createFromPath(p).resize({ width: 16, height: 16 })
  tray = new Tray(img)
  tray.setToolTip('Birdflop Server Manager')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Birdflop Server Manager', click: () => showMain() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => showMain())
}

app.whenReady().then(() => {
  registerIpc()

  if (process.env.BSM_SELFTEST) {
    runSelfTest().finally(() => app.quit())
    return
  }

  if (process.env.BSM_ICON) {
    generateIcon(process.env.BSM_ICON).finally(() => app.quit())
    return
  }

  initUpdater()
  createWindow()
  createTray()

  // Check for updates shortly after launch (no-op in dev).
  setTimeout(() => void checkForUpdates(), 4000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopAll()
  stopAllTunnels()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Surface unexpected errors during development.
if (isDev) {
  process.on('unhandledRejection', (reason) => console.error('[main] unhandledRejection', reason))
}
