import { app, BrowserWindow, screen } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { APP_NAME } from '@shared/constants'
import { CHAT_WINDOW_MIN, fitChatBounds, type ChatRoute } from '@shared/chatWindow'
import type { EventChannel } from '@shared/ipc'
import type { EventBus } from './ipc/registry'
import { titleBarOptions, windowIconPath } from './window'
import { log } from './util/log'

const BoundsSchema = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(1), height: z.number().int().min(1) })

/** O chat destacado não desenha terminais nem o escritório: não recebe a saída deles. */
const EXCLUDED: readonly EventChannel[] = ['pty:data', 'edge:activity', 'office:activity', 'canvas:focusNode', 'chat:openAgent', 'chat:windowState']

export interface ChatWindowDeps {
  bus: EventBus
  userDataDir: string
  /** Tema efetivo agora (a barra de título nasce nas cores certas). */
  theme(): 'dark' | 'light'
  /** O chat destacado fechou: o processo principal para de acompanhar as conversas abertas por ele. */
  onClosed(): void
}

/**
 * Chat numa janela própria do sistema (pode ir para outro monitor). Mesma segurança da janela principal
 * (preload, contextIsolation, sandbox, sem webviews); carrega a mesma interface com `?janela=chat`.
 * Posição e tamanho ficam em <userData>/janela-chat.json.
 */
export class ChatWindow {
  private win: BrowserWindow | null = null
  private readonly file: string
  /** Aba em uso, para devolver o chat à janela principal no mesmo lugar. */
  private last: { dir: string; tab: string } | null = null
  /** Pedidos que chegaram enquanto a janela carregava. */
  private pending: ChatRoute[] = []
  private ready = false
  /** Ao fechar, reabrir o painel na janela principal nesta aba (devolver o chat). */
  private reopenOnClose: { dir: string; tab: string } | null = null

  constructor(private readonly deps: ChatWindowDeps) {
    this.file = path.join(deps.userDataDir, 'janela-chat.json')
  }

  isOpen(): boolean {
    return Boolean(this.win && !this.win.isDestroyed())
  }

  private savedBounds(): z.infer<typeof BoundsSchema> | null {
    try {
      const parsed = BoundsSchema.safeParse(JSON.parse(fs.readFileSync(this.file, 'utf8')))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  private saveBounds(): void {
    const win = this.win
    if (!win || win.isDestroyed() || win.isMinimized()) return
    try {
      fs.writeFileSync(this.file, JSON.stringify(win.getNormalBounds()))
    } catch {
      // sem gravar: abre no lugar padrão da próxima vez
    }
  }

  /** Abre (ou traz para a frente) o chat destacado, na aba indicada. */
  open(dir: string, tab: string): void {
    this.last = { dir, tab }
    if (this.isOpen()) {
      this.route({ kind: 'show', dir })
      return
    }
    const main = this.deps.bus.window
    const bounds = fitChatBounds(
      this.savedBounds(),
      screen.getAllDisplays().map((d) => d.workArea),
      main && !main.isDestroyed() ? main.getBounds() : null
    )
    const theme = this.deps.theme()
    const win = new BrowserWindow({
      ...bounds,
      ...titleBarOptions(theme),
      minWidth: CHAT_WINDOW_MIN.width,
      minHeight: CHAT_WINDOW_MIN.height,
      show: false,
      title: `Chat — ${APP_NAME}`,
      backgroundColor: theme === 'light' ? '#e9edf3' : '#151b27',
      icon: windowIconPath(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: false
      }
    })
    this.win = win
    this.ready = false
    this.pending = []
    this.reopenOnClose = null
    this.deps.bus.attachSecondary(win, EXCLUDED)
    win.once('ready-to-show', () => win.show())
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) {
        win.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
    win.webContents.once('did-finish-load', () => {
      this.ready = true
      for (const r of this.pending.splice(0)) this.deps.bus.emitTo(win, 'chat:route', r)
    })
    win.on('moved', () => this.saveBounds())
    win.on('resized', () => this.saveBounds())
    win.on('close', () => this.saveBounds())
    win.on('closed', () => {
      if (this.win === win) this.win = null
      // Primeiro encerra as conversas acompanhadas por esta janela; só então a principal reabre as dela.
      this.deps.onClosed()
      const reopen = this.reopenOnClose
      this.reopenOnClose = null
      this.deps.bus.emitMain('chat:windowState', reopen ? { open: false, reopen } : { open: false })
      log.info('chat destacado fechado')
    })
    const query = { janela: 'chat', dir, tab }
    const dev = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
    if (dev) void win.loadURL(`${dev}?${new URLSearchParams(query).toString()}`)
    else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
    this.deps.bus.emitMain('chat:windowState', { open: true })
    log.info('chat destacado aberto')
  }

  /** Repassa um pedido da janela principal (abrir aba, nota...) e traz o chat para a frente. */
  route(r: ChatRoute): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    if (r.kind === 'agent') this.last = { dir: r.dir, tab: r.id }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (r.kind === 'show') return
    if (this.ready) this.deps.bus.emitTo(win, 'chat:route', r)
    else this.pending.push(r)
  }

  /** O chat destacado informa a aba aberta (para voltar à janela principal no mesmo lugar). */
  setTab(dir: string, tab: string): void {
    this.last = { dir, tab }
  }

  /** Devolve o chat à janela principal: fecha a janela e reabre o painel lá, na mesma aba. */
  dock(): void {
    this.reopenOnClose = this.last
    this.close()
    const main = this.deps.bus.window
    if (main && !main.isDestroyed()) {
      if (main.isMinimized()) main.restore()
      main.focus()
    }
  }

  close(): void {
    const win = this.win
    if (win && !win.isDestroyed()) win.close()
  }
}
