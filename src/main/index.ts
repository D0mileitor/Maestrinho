import { app, BrowserWindow } from 'electron'
import * as path from 'node:path'
import { APP_NAME } from '@shared/constants'
import { initLog, log } from './util/log'
import { createMainWindow, installAppMenu, installPermissionPolicy, installSecurityHandlers, resolveTheme } from './window'
import { AppContext } from './app'
import { appIdentity } from '@shared/appIdentity'
import { ensureStartMenuShortcut } from './startMenu'

app.setName(APP_NAME)
// Instalado e código-fonte com ids separados: um não toma o atalho (e o ícone na barra) do outro.
if (process.platform === 'win32') app.setAppUserModelId(appIdentity(app.isPackaged).id)
app.enableSandbox()

// Permite isolar dados em testes (ex.: MAESTRINHO_USER_DATA=<pasta temporária>).
const overrideUserData = process.env['MAESTRINHO_USER_DATA']
if (overrideUserData) app.setPath('userData', path.resolve(overrideUserData))

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let ctx: AppContext | null = null
let shuttingDown = false

function openWindow(): void {
  if (!ctx) return
  const win = createMainWindow(resolveTheme(ctx.config.settings.theme))
  ctx.bus.attach(win)
  // Fechar a janela principal fecha também o chat destacado (o app encerra).
  win.on('close', () => ctx?.chatWindow.close())
}

app.on('second-instance', () => {
  const win = ctx?.bus.window
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  try {
    ctx?.shutdown()
  } catch (err) {
    log.error('erro ao encerrar', err instanceof Error ? err : undefined)
  }
}

if (gotLock) {
  void app.whenReady().then(async () => {
    const userData = app.getPath('userData')
    initLog(path.join(userData, 'logs'))
    log.info('iniciando', { version: app.getVersion(), electron: process.versions.electron, platform: process.platform })
    installSecurityHandlers()
    installPermissionPolicy()
    installAppMenu()
    // Testes E2E usam userData isolado e não precisam do atalho.
    if (!overrideUserData) ensureStartMenuShortcut()
    ctx = new AppContext(userData)
    ctx.registerIpc()
    await ctx.start()
    await ctx.restoreLastWorkspace()
    openWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow()
    })
  })

  app.on('window-all-closed', () => {
    shutdown()
    app.quit()
  })
  app.on('before-quit', shutdown)
  process.on('SIGINT', () => {
    shutdown()
    app.quit()
  })
  process.on('SIGTERM', () => {
    shutdown()
    app.quit()
  })
}
