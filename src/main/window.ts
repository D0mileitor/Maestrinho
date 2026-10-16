import { app, BrowserWindow, Menu, nativeTheme, session, shell, type BrowserWindowConstructorOptions, type WebContents } from 'electron'
import * as path from 'node:path'
import { APP_NAME } from '@shared/constants'
import { TITLE_BAR_HEIGHT, titleBarColors } from '@shared/titleBar'
import { log } from './util/log'

/** Partição isolada usada pelos portais (webviews); sem preload e sem Node. */
export const PORTAL_PARTITION = 'persist:portals'

function rendererUrl(): string | undefined {
  return !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
}

/** A URL pertence à própria interface do app (arquivo local empacotado ou servidor do Vite em dev)? */
export function isAppUrl(url: string): boolean {
  const dev = rendererUrl()
  if (dev && url.startsWith(dev)) return true
  if (url.startsWith('file://')) {
    const rendererDir = path.join(__dirname, '../renderer')
    try {
      const filePath = decodeURIComponent(new URL(url).pathname).replace(/^\/([a-zA-Z]:)/, '$1')
      return path.resolve(filePath).startsWith(path.resolve(rendererDir))
    } catch {
      return false
    }
  }
  return false
}

export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:'
  } catch {
    return false
  }
}

/** Endurecimento global de segurança aplicado a todo WebContents criado. */
export function installSecurityHandlers(): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    contents.on('will-navigate', (event, url) => {
      if (contents.getType() === 'webview') {
        // Portais navegam livremente, mas só por http(s).
        if (!/^https?:\/\//i.test(url)) event.preventDefault()
        return
      }
      if (!isAppUrl(url)) {
        event.preventDefault()
        log.warn('navegação bloqueada na janela principal')
      }
    })

    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Webviews nunca recebem preload nem Node, e sempre ficam na partição dos portais.
      delete (webPreferences as { preload?: string }).preload
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      params.partition = PORTAL_PARTITION
      if (params.src && !/^(https?:\/\/|about:blank)/i.test(params.src)) {
        event.preventDefault()
        log.warn('webview bloqueado: protocolo não permitido')
      }
    })
  })
}

/**
 * Remove o menu padrão do Electron. Mesmo oculto, os aceleradores dele seriam disparados antes da
 * página: Ctrl+W fecharia a janela, Ctrl+R recarregaria (roubando o reverse-search dos shells) e
 * Ctrl+=/- dariam zoom na interface inteira. Os atalhos do app são tratados no renderer.
 */
export function installAppMenu(): void {
  Menu.setApplicationMenu(null)
}

/** Permissões: nega tudo por padrão (câmera, microfone, geolocalização...). */
export function installPermissionPolicy(): void {
  // A interface do app (nunca os portais, que usam outra sessão) pode ler a área de transferência
  // para "Colar" no terminal pelo menu de contexto.
  const allowMain = new Set(['clipboard-sanitized-write', 'clipboard-read', 'notifications'])
  const isAppFrame = (url: string | undefined): boolean => Boolean(url && isAppUrl(url))
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allowMain.has(permission) && isAppFrame(details.requestingUrl ?? wc.getURL()))
  })
  session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    if (!allowMain.has(permission)) return false
    return isAppFrame(wc?.getURL()) || isAppFrame(requestingOrigin)
  })
  const portal = session.fromPartition(PORTAL_PARTITION)
  portal.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write' || permission === 'fullscreen')
  })
  portal.setPermissionCheckHandler(() => false)
}

/**
 * Ícone das janelas. No Windows vai o .ico, que traz os tamanhos pequenos já desenhados (barra de
 * título, barra de tarefas, Alt+Tab); com o .png, o sistema reduziria a arte de 512 px e ela borraria.
 */
export function windowIconPath(): string {
  return path.join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
}

/** Tema efetivo ("system" segue o Windows). */
export function resolveTheme(pref: 'dark' | 'light' | 'system'): 'dark' | 'light' {
  if (pref === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return pref
}

/**
 * Barra de título própria: a nativa some e o app desenha título e ícone; os botões do sistema ficam
 * (com o encaixe de janelas do Windows), pintados nas cores do tema.
 */
export function titleBarOptions(theme: 'dark' | 'light'): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay'> {
  return { titleBarStyle: 'hidden', titleBarOverlay: { ...titleBarColors(theme), height: TITLE_BAR_HEIGHT } }
}

/** Repinta os botões do sistema ao trocar de tema. */
export function applyTitleBarTheme(win: BrowserWindow, theme: 'dark' | 'light'): void {
  try {
    win.setTitleBarOverlay({ ...titleBarColors(theme), height: TITLE_BAR_HEIGHT })
  } catch {
    // plataforma sem barra sobreposta
  }
}

/**
 * Testes ponta a ponta: MAESTRINHO_E2E_JANELA="x,y,largura,altura" abre a janela nessa posição (ex.: no
 * segundo monitor) e MAESTRINHO_E2E_SEM_FOCO=1 a mostra sem tirar o foco de quem está usando o computador.
 */
export function e2eWindowOptions(env: Record<string, string | undefined> = process.env): {
  bounds: { x: number; y: number; width: number; height: number } | null
  inactive: boolean
} {
  const parts = (env['MAESTRINHO_E2E_JANELA'] ?? '').split(',').map((n) => Number(n.trim()))
  const valid = parts.length === 4 && parts.every((n) => Number.isInteger(n)) && parts[2]! >= 400 && parts[3]! >= 300
  const bounds = valid ? { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! } : null
  return { bounds, inactive: env['MAESTRINHO_E2E_SEM_FOCO'] === '1' }
}

export function createMainWindow(theme: 'dark' | 'light' = 'dark'): BrowserWindow {
  const e2e = e2eWindowOptions()
  const win = new BrowserWindow({
    ...titleBarOptions(theme),
    width: 1440,
    height: 920,
    ...(e2e.bounds ?? {}),
    minWidth: 820,
    minHeight: 520,
    show: false,
    title: APP_NAME,
    backgroundColor: titleBarColors(theme).color,
    icon: windowIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  win.once('ready-to-show', () => (e2e.inactive ? win.showInactive() : win.show()))

  // Sem menu de aplicação (ver installAppMenu); DevTools só com F12 fora do app empacotado.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  const dev = rendererUrl()
  if (dev) void win.loadURL(dev)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))

  return win
}
