import { app, BrowserWindow, ipcMain, powerMonitor, screen, type Display, type IpcMainEvent } from 'electron'
import * as path from 'node:path'
import {
  BUDDY_HEIGHT,
  BuddyActionSchema,
  BuddyExitedSchema,
  BuddyRectsSchema,
  hitsAny,
  type BuddyRect,
  expireCalls,
  leftNeighbor,
  mergeCalls,
  nextExpiry,
  pauseCountdown,
  restartCountdown,
  type BuddyCall
} from '@shared/buddy'
import { log } from '../util/log'

export interface DesktopBuddyDeps {
  mainWindow(): BrowserWindow | null
  /** Abrir o app no terminal do aviso (restaura a janela e centraliza o nó). */
  open(terminalId: string, dir: string): void
}

/** Se a página não avisar que os agentes já saíram da tela, a janela some mesmo assim. */
const HIDE_FALLBACK_MS = 12_000
/** Uma travessia de monitor não leva mais que isto. */
const PASS_FALLBACK_MS = 20_000
/** Frequência com que a posição do mouse é conferida enquanto há agente na tela. */
const POINTER_MS = 50

/** Faixa transparente na parte de baixo de um monitor. */
interface Strip {
  win: BrowserWindow
  ready: boolean
  displayId: number
  /** Agentes de passagem esperando a página carregar. */
  queued: BuddyCall[]
  hideTimer: NodeJS.Timeout | null
}

/**
 * O agente "sai da tela": janelas transparentes, sem moldura, sempre por cima e que não roubam o foco,
 * na faixa de baixo dos monitores. A faixa "casa" (monitor do app) mostra até três agentes lado a lado,
 * com balão; clicar abre o terminal. Ao sair, o agente atravessa a tela para a esquerda e continua pelos
 * outros monitores, na ordem em que estão arrumados no Windows, até sair do último (uma faixa de
 * passagem por monitor; uma janela só esticada sobre monitores com escalas diferentes distorce).
 *
 * Segurança: a página tem preload próprio só com os canais do aviso; o main confere que as mensagens
 * vêm destas janelas e valida tudo com zod.
 */
export class DesktopBuddy {
  private home: Strip | null = null
  private readonly passes = new Map<number, Strip>()
  private calls: BuddyCall[] = []
  private readonly dirs = new Map<string, string>()
  /** Último aviso de cada terminal (o agente continua andando pelos monitores depois de sair da fila). */
  private readonly known = new Map<string, BuddyCall>()
  private readonly watched = new WeakSet<BrowserWindow>()
  private expiry: NodeJS.Timeout | null = null

  /** Computador bloqueado (o minuto de cada agente só conta com a tela desbloqueada). */
  private locked = false
  /** Áreas clicáveis da faixa "casa" e se o mouse está sobre uma delas agora. */
  private hitRects: BuddyRect[] = []
  private interactive = false
  private pointerTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: DesktopBuddyDeps) {
    // Bloqueou: os agentes ficam esperando. Desbloqueou: o minuto de todos começa agora.
    powerMonitor.on('lock-screen', () => {
      this.locked = true
      this.calls = pauseCountdown(this.calls)
      this.scheduleExpiry()
    })
    powerMonitor.on('unlock-screen', () => {
      this.locked = false
      this.calls = restartCountdown(this.calls, Date.now())
      this.scheduleExpiry()
    })
    ipcMain.on('buddy:ready', (e) => {
      const strip = this.stripOf(e)
      if (!strip) return
      strip.ready = true
      if (strip === this.home) this.push()
      for (const call of strip.queued.splice(0)) strip.win.webContents.send('buddy:walk', call)
    })
    // A página terminou de animar (todos saíram andando): a janela pode sumir.
    ipcMain.on('buddy:idle', (e) => {
      const strip = this.stripOf(e)
      if (!strip) return
      if (strip !== this.home) this.hideStrip(strip)
      else if (this.calls.length === 0) this.hideStrip(strip)
    })
    ipcMain.on('buddy:rects', (e, raw: unknown) => {
      const parsed = BuddyRectsSchema.safeParse(raw)
      if (!parsed.success || this.stripOf(e) !== this.home) return
      this.hitRects = parsed.data.rects
      this.checkPointer()
    })
    ipcMain.on('buddy:action', (e, raw: unknown) => {
      const parsed = BuddyActionSchema.safeParse(raw)
      if (!parsed.success || this.stripOf(e) !== this.home || !this.home) return
      const { terminalId, action } = parsed.data
      const dir = this.dirs.get(terminalId)
      this.dismiss(terminalId)
      if (action === 'open' && dir) this.deps.open(terminalId, dir)
    })
    // Saiu pela borda esquerda de um monitor: continua no monitor à esquerda (se houver).
    ipcMain.on('buddy:exited', (e, raw: unknown) => {
      const parsed = BuddyExitedSchema.safeParse(raw)
      const strip = this.stripOf(e)
      if (!strip || !parsed.success) return
      const call = this.known.get(parsed.data.terminalId)
      const next = leftNeighbor(this.displays(), strip.displayId)
      if (!call || !next) {
        if (!this.calls.some((c) => c.terminalId === parsed.data.terminalId)) this.known.delete(parsed.data.terminalId)
        return
      }
      const display = screen.getAllDisplays().find((d) => d.id === next.id)
      if (display) this.walkThrough(display, call)
    })
  }

  private stripOf(e: IpcMainEvent): Strip | null {
    if (this.home && !this.home.win.isDestroyed() && e.sender === this.home.win.webContents) return this.home
    for (const s of this.passes.values()) if (!s.win.isDestroyed() && e.sender === s.win.webContents) return s
    return null
  }

  show(call: BuddyCall, dir: string): void {
    this.watchMain()
    const now = Date.now()
    // Chegou com o computador bloqueado: só começa a contar quando você desbloquear.
    const counted: BuddyCall = this.isLocked() ? { ...call, since: undefined } : { ...call, since: now }
    this.calls = mergeCalls(expireCalls(this.calls, now), counted)
    this.dirs.set(call.terminalId, dir)
    this.known.set(call.terminalId, counted)
    this.update()
    this.scheduleExpiry()
  }

  dismiss(terminalId: string): void {
    const before = this.calls.length
    this.calls = this.calls.filter((c) => c.terminalId !== terminalId)
    if (this.calls.length !== before) this.update()
  }

  /** Some com todos (o usuário voltou para o app). */
  clear(): void {
    if (this.calls.length === 0) return
    this.calls = []
    this.update()
  }

  dispose(): void {
    if (this.expiry) clearTimeout(this.expiry)
    this.expiry = null
    this.stopPointer()
    this.calls = []
    for (const s of [this.home, ...this.passes.values()]) {
      if (!s) continue
      if (s.hideTimer) clearTimeout(s.hideTimer)
      if (!s.win.isDestroyed()) s.win.destroy()
    }
    this.home = null
    this.passes.clear()
  }

  // ------------------------------------------------------------------ janelas

  /** Voltou para o app: os avisos somem. Janela principal fechada: as do personagem fecham junto. */
  private watchMain(): void {
    const main = this.deps.mainWindow()
    if (!main || this.watched.has(main)) return
    this.watched.add(main)
    main.on('focus', () => this.clear())
    main.on('closed', () => this.dispose())
  }

  private displays(): { id: number; x: number; y: number; width: number; height: number }[] {
    return screen.getAllDisplays().map((d) => ({ id: d.id, ...d.bounds }))
  }

  private homeDisplay(): Display {
    const main = this.deps.mainWindow()
    return main && !main.isDestroyed() ? screen.getDisplayMatching(main.getBounds()) : screen.getPrimaryDisplay()
  }

  private createStrip(display: Display, title: string): Strip {
    const win = new BrowserWindow({
      width: 800,
      height: BUDDY_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      title,
      webPreferences: {
        preload: path.join(__dirname, '../preload/buddy.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false
      }
    })
    win.setAlwaysOnTop(true, 'pop-up-menu')
    win.setIgnoreMouseEvents(true, { forward: true })
    const strip: Strip = { win, ready: false, displayId: display.id, queued: [], hideTimer: null }
    win.on('closed', () => {
      if (this.home === strip) this.home = null
      for (const [id, s] of this.passes) if (s === strip) this.passes.delete(id)
    })
    const dev = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
    if (dev) void win.loadURL(`${dev}/buddy.html`)
    else void win.loadFile(path.join(__dirname, '../renderer/buddy.html'))
    this.place(strip, display)
    return strip
  }

  /** Faixa de baixo do monitor inteiro (acima da barra de tarefas). */
  private place(strip: Strip, display: Display): void {
    strip.displayId = display.id
    const area = display.workArea
    const bounds = { x: area.x, y: area.y + area.height - BUDDY_HEIGHT, width: area.width, height: BUDDY_HEIGHT }
    const cur = strip.win.getBounds()
    if (cur.x !== bounds.x || cur.y !== bounds.y || cur.width !== bounds.width || cur.height !== bounds.height) strip.win.setBounds(bounds)
  }

  private update(): void {
    const home = this.home && !this.home.win.isDestroyed() ? this.home : null
    if (this.calls.length === 0) {
      if (home && home.win.isVisible()) {
        // A página faz os agentes saírem andando pela esquerda e avisa (buddy:idle) quando acabar.
        this.push()
        this.stopPointer()
        this.scheduleHide(home, HIDE_FALLBACK_MS)
      }
      return
    }
    const display = this.homeDisplay()
    const strip = home ?? (this.home = this.createStrip(display, 'Maestrinho: avisos'))
    this.cancelHide(strip)
    this.place(strip, display)
    this.push()
    if (!strip.win.isVisible()) strip.win.showInactive()
    this.startPointer()
    this.prepareRoute(display.id)
    log.info('aviso do personagem', { visible: this.calls.length })
  }

  /**
   * Deixa carregadas (escondidas) as faixas dos monitores por onde o agente vai passar ao sair, para
   * ele não sumir por um instante na troca de monitor.
   */
  private prepareRoute(fromId: number): void {
    const all = screen.getAllDisplays()
    const seen = new Set<number>([fromId])
    for (let next = leftNeighbor(this.displays(), fromId); next && !seen.has(next.id); next = leftNeighbor(this.displays(), next.id)) {
      seen.add(next.id)
      const existing = this.passes.get(next.id)
      if (existing && !existing.win.isDestroyed()) continue
      const display = all.find((d) => d.id === next!.id)
      if (display) this.passes.set(next.id, this.createStrip(display, 'Maestrinho: avisos (passagem)'))
    }
  }

  /** Leva o agente (sem balão) para atravessar um monitor, da direita para a esquerda. */
  private walkThrough(display: Display, call: BuddyCall): void {
    let strip: Strip | undefined
    if (this.home && !this.home.win.isDestroyed() && this.home.displayId === display.id) strip = this.home
    else {
      strip = this.passes.get(display.id)
      if (!strip || strip.win.isDestroyed()) {
        strip = this.createStrip(display, 'Maestrinho: avisos (passagem)')
        this.passes.set(display.id, strip)
      }
      this.place(strip, display)
      this.scheduleHide(strip, PASS_FALLBACK_MS)
    }
    if (strip.ready) strip.win.webContents.send('buddy:walk', call)
    else strip.queued.push(call)
    if (!strip.win.isVisible()) strip.win.showInactive()
  }

  // ------------------------------------------------------------------ clique

  /**
   * O Windows não avisa a página quando o mouse real passa por cima de uma janela que deixa o clique
   * atravessar. Então o main confere a posição do mouse: sobre um balão/agente, a janela aceita o clique
   * e pode receber foco (o clique em "Abrir" dá ao app permissão de trazer o Maestrinho para a frente);
   * fora deles, o clique atravessa e a janela não rouba o foco de ninguém.
   */
  private startPointer(): void {
    if (this.pointerTimer) return
    this.pointerTimer = setInterval(() => this.checkPointer(), POINTER_MS)
    this.pointerTimer.unref?.()
  }

  private stopPointer(): void {
    if (this.pointerTimer) clearInterval(this.pointerTimer)
    this.pointerTimer = null
    this.setInteractive(false)
  }

  private checkPointer(): void {
    const home = this.home
    if (!home || home.win.isDestroyed() || !home.win.isVisible() || this.calls.length === 0) return this.setInteractive(false)
    const p = screen.getCursorScreenPoint()
    const b = home.win.getBounds()
    this.setInteractive(hitsAny(this.hitRects, p.x - b.x, p.y - b.y))
  }

  private setInteractive(on: boolean): void {
    if (on === this.interactive) return
    this.interactive = on
    const win = this.home?.win
    if (!win || win.isDestroyed()) return
    win.setIgnoreMouseEvents(!on, { forward: true })
    win.setFocusable(on)
  }

  private scheduleHide(strip: Strip, ms: number): void {
    this.cancelHide(strip)
    strip.hideTimer = setTimeout(() => this.hideStrip(strip), ms)
    strip.hideTimer.unref?.()
  }

  private cancelHide(strip: Strip): void {
    if (strip.hideTimer) clearTimeout(strip.hideTimer)
    strip.hideTimer = null
  }

  private hideStrip(strip: Strip): void {
    this.cancelHide(strip)
    if (strip.win.isDestroyed()) return
    if (strip === this.home && this.calls.length > 0) return
    strip.win.setIgnoreMouseEvents(true, { forward: true })
    strip.win.hide()
  }

  private push(): void {
    const home = this.home
    if (home && home.ready && !home.win.isDestroyed()) home.win.webContents.send('buddy:calls', this.calls)
  }

  private isLocked(): boolean {
    if (this.locked) return true
    try {
      // Cobre o caso de o app ter aberto com a tela já bloqueada (antes de qualquer evento).
      return powerMonitor.getSystemIdleState(1) === 'locked'
    } catch {
      return false
    }
  }

  private scheduleExpiry(): void {
    if (this.expiry) clearTimeout(this.expiry)
    this.expiry = null
    const next = nextExpiry(this.calls)
    if (next === null) return
    this.expiry = setTimeout(() => {
      this.expiry = null
      const kept = expireCalls(this.calls, Date.now())
      if (kept.length !== this.calls.length) {
        this.calls = kept
        this.update()
      }
      if (this.calls.length) this.scheduleExpiry()
    }, Math.max(1000, next - Date.now() + 50))
    this.expiry.unref?.()
  }
}
