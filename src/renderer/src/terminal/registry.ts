import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { PtyDataEvent } from '@shared/runtime'
import { api, errorMessage } from '../lib/api'
import { isGlobalShortcut } from '../lib/shortcuts'

/**
 * Instâncias de xterm.js vivem fora do React, indexadas pelo id do terminal. O nó do canvas apenas
 * "empresta" a instância e a pendura no seu DOM. O processo e o buffer autoritativo ficam no main;
 * ao (re)anexar, o xterm é reconstruído a partir do snapshot serializado do espelho headless.
 */

export interface TerminalAppearance {
  fontFamily: string
  fontSize: number
  scrollback: number
  theme: ITheme
}

let appearance: TerminalAppearance = {
  fontFamily: '"Cascadia Mono", Consolas, monospace',
  fontSize: 13,
  scrollback: 10_000,
  theme: {}
}

function readCssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Tema do xterm derivado dos tokens CSS do tema atual. */
export function themeFromCss(kind: 'dark' | 'light'): ITheme {
  const bg = readCssVar('--term-bg', kind === 'dark' ? '#10151f' : '#fbfcfd')
  const brass = readCssVar('--brass', '#d4a849')
  if (kind === 'light') {
    return {
      background: bg,
      foreground: '#1b2230',
      cursor: brass,
      cursorAccent: bg,
      selectionBackground: 'rgba(76, 109, 156, 0.28)',
      black: '#1b2230',
      red: '#b8322b',
      green: '#2b7a52',
      yellow: '#8a6512',
      blue: '#2f5e9e',
      magenta: '#8a3f8f',
      cyan: '#1d7480',
      white: '#c9cfd9',
      brightBlack: '#5c6678',
      brightRed: '#d0453d',
      brightGreen: '#35915f',
      brightYellow: '#a37a1e',
      brightBlue: '#3b72bd',
      brightMagenta: '#a24fa8',
      brightCyan: '#22899a',
      brightWhite: '#ffffff'
    }
  }
  return {
    background: bg,
    foreground: '#dfe3ea',
    cursor: brass,
    cursorAccent: bg,
    selectionBackground: 'rgba(111, 143, 191, 0.35)',
    black: '#1d2433',
    red: '#e5675f',
    green: '#6cc497',
    yellow: '#e0b250',
    blue: '#76a0dc',
    magenta: '#c58ad6',
    cyan: '#5fc0cc',
    white: '#c8cdd6',
    brightBlack: '#5d6880',
    brightRed: '#f08a83',
    brightGreen: '#8fd8b0',
    brightYellow: '#f0cb72',
    brightBlue: '#9bbcec',
    brightMagenta: '#d9a7e6',
    brightCyan: '#86d3dc',
    brightWhite: '#f4f1e8'
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // sem permissão de clipboard: ignora
  }
}

type Listener = () => void

/** Caminhos no disco de arquivos arrastados/colados (itens sem caminho, como um print, ficam de fora). */
function filePaths(files: FileList | null | undefined): string[] {
  return Array.from(files ?? [])
    .map((f) => api.pathForFile(f))
    .filter((p) => p !== '')
}

class TerminalController {
  readonly term: Terminal
  private readonly fit = new FitAddon()
  readonly search = new SearchAddon()
  private opened = false
  private attachedSeq = -1
  private early: PtyDataEvent[] = []
  private renderZoom = 1
  private flowSize = { w: 0, h: 0 }
  private started = false
  private disposed = false
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
  refs = 0
  disposeTimer: ReturnType<typeof setTimeout> | null = null
  private focusListeners = new Set<Listener>()

  constructor(readonly id: string) {
    this.term = new Terminal({
      fontFamily: appearance.fontFamily,
      fontSize: appearance.fontSize,
      scrollback: appearance.scrollback,
      theme: appearance.theme,
      allowProposedApi: true,
      cursorBlink: true,
      macOptionIsMeta: true,
      drawBoldTextInBrightColors: false,
      rightClickSelectsWord: false,
      windowsPty: navigator.userAgent.includes('Windows') ? { backend: 'conpty' } : undefined
    })
    this.term.loadAddon(this.fit)
    this.term.loadAddon(this.search)
    this.term.loadAddon(new WebLinksAddon((_e, uri) => void api.invoke('app:openExternal', { url: uri })))
    const unicode = new Unicode11Addon()
    this.term.loadAddon(unicode)
    this.term.unicode.activeVersion = '11'

    this.term.onData((data) => {
      // Não repassa o aviso de perda de foco (modo 1004, ESC [ O): alguns agentes deixam de
      // processar o Enter de mensagens recebidas quando acham que estão sem foco.
      if (data === '\x1b[O') return
      api.send('pty:write', { id: this.id, data })
    })
    this.term.onBinary((data) => api.send('pty:write', { id: this.id, data }))
    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e))
  }

  private handleKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown') return true
    // Atalhos globais do app sobem para a janela e não vão para o processo.
    if (isGlobalShortcut(e)) return false
    const key = e.key.toLowerCase()
    const ctrlOnly = e.ctrlKey && !e.altKey && !e.metaKey
    if (ctrlOnly && !e.shiftKey && key === 'c' && this.term.hasSelection()) {
      void copyText(this.term.getSelection())
      this.term.clearSelection()
      e.preventDefault()
      return false
    }
    if (ctrlOnly && e.shiftKey && key === 'c') {
      if (this.term.hasSelection()) void copyText(this.term.getSelection())
      e.preventDefault()
      return false
    }
    if (e.ctrlKey && !e.shiftKey && e.key === 'Insert') {
      if (this.term.hasSelection()) void copyText(this.term.getSelection())
      return false
    }
    // Colar: deixa o navegador disparar o evento "paste", que o xterm trata (com bracketed paste).
    if ((ctrlOnly && key === 'v') || (e.shiftKey && e.key === 'Insert')) return false
    return true
  }

  /**
   * Colar sem texto: arquivos copiados no Explorer viram seus caminhos; um print (imagem na área de
   * transferência) é gravado como PNG local pelo processo principal e o caminho é colado — Claude Code
   * e Codex reconhecem o caminho de uma imagem colada e a anexam.
   */
  private onPaste(e: ClipboardEvent): void {
    const dt = e.clipboardData
    if (!dt || dt.getData('text/plain') !== '') return
    const paths = filePaths(dt.files)
    const hasImage = Array.from(dt.items).some((i) => i.kind === 'file' && i.type.startsWith('image/'))
    if (paths.length === 0 && !hasImage) return
    e.preventDefault()
    e.stopPropagation()
    if (paths.length > 0) this.pastePaths(paths)
    else void this.pasteClipboardImage()
  }

  /** Grava a imagem da área de transferência e cola o caminho. Devolve false se não havia imagem. */
  async pasteClipboardImage(): Promise<boolean> {
    try {
      const file = await api.invoke('clipboard:saveImage')
      if (!file) return false
      this.pastePaths([file])
      return true
    } catch {
      return false
    }
  }

  /** Cola caminhos de arquivo (entre aspas quando têm espaço), respeitando o bracketed paste do programa. */
  pastePaths(paths: string[]): void {
    this.term.paste(paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' '))
    this.term.focus()
  }

  onFocusChange(fn: Listener): () => void {
    this.focusListeners.add(fn)
    return () => this.focusListeners.delete(fn)
  }

  get element(): HTMLElement | undefined {
    return this.term.element
  }

  mount(container: HTMLElement): void {
    if (this.disposed) return
    if (!this.opened) {
      this.term.open(container)
      this.opened = true
      const textarea = this.term.textarea
      textarea?.addEventListener('focus', () => this.focusListeners.forEach((f) => f()))
      textarea?.addEventListener('blur', () => this.focusListeners.forEach((f) => f()))
      const el = this.term.element
      // Captura: roda antes do tratamento de "paste" do xterm (que só conhece texto).
      el?.addEventListener('paste', (e) => this.onPaste(e), true)
      el?.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      })
      el?.addEventListener('drop', (e) => {
        const paths = filePaths(e.dataTransfer?.files)
        if (paths.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        this.pastePaths(paths)
      })
    } else if (this.term.element && this.term.element.parentElement !== container) {
      container.appendChild(this.term.element)
    }
  }

  isFocused(): boolean {
    const ta = this.term.textarea
    return Boolean(ta && document.activeElement === ta)
  }

  /**
   * Ajusta o layout. `w`/`h` = tamanho da área do terminal em unidades do canvas; `zoom` = escala
   * de renderização. Mudança só de zoom troca a fonte mas mantém colunas/linhas (tolerância de ±1),
   * para não redimensionar o PTY (e redesenhar TUIs) a cada zoom.
   */
  layout(w: number, h: number, zoom: number): void {
    if (!this.opened || this.disposed) return
    const sizeChanged = Math.abs(w - this.flowSize.w) > 0.5 || Math.abs(h - this.flowSize.h) > 0.5
    const zoomChanged = Math.abs(zoom - this.renderZoom) > 0.001
    this.flowSize = { w, h }
    if (zoomChanged) {
      this.renderZoom = zoom
      this.term.options.fontSize = Math.max(2, appearance.fontSize * zoom)
    }
    const dims = this.fit.proposeDimensions()
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return
    const cols = Math.max(10, dims.cols)
    const rows = Math.max(3, dims.rows)
    const tolerate = !sizeChanged && zoomChanged
    const close = Math.abs(cols - this.term.cols) <= 1 && Math.abs(rows - this.term.rows) <= 1
    if (cols === this.term.cols && rows === this.term.rows) return
    if (tolerate && close) return
    this.term.resize(cols, rows)
    if (this.started) this.scheduleRemoteResize()
  }

  /** Redimensiona o PTY com debounce: durante o arraste da borda o TUI não redesenha a cada quadro. */
  private scheduleRemoteResize(): void {
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null
      if (!this.disposed) api.send('pty:resize', { id: this.id, cols: this.term.cols, rows: this.term.rows })
    }, 90)
  }

  /** Garante o processo no main e anexa o fluxo de saída. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return
    this.started = true
    try {
      await api.invoke('pty:ensure', { id: this.id, cols: this.term.cols, rows: this.term.rows })
      await this.attach()
    } catch (err) {
      this.started = false
      this.term.write(`\r\n\x1b[31m${errorMessage(err)}\x1b[0m\r\n`)
    }
  }

  async attach(): Promise<void> {
    this.attachedSeq = -1
    const res = await api.invoke('pty:attach', { id: this.id })
    if (this.disposed || !res) return
    this.term.reset()
    this.term.write(res.snapshot)
    this.attachedSeq = res.seq
    for (const e of this.early) if (e.seq > res.seq) this.term.write(e.data)
    this.early = []
    // Se o tamanho mudou enquanto anexava, sincroniza com o PTY.
    if (res.info.cols !== this.term.cols || res.info.rows !== this.term.rows) {
      api.send('pty:resize', { id: this.id, cols: this.term.cols, rows: this.term.rows })
    }
  }

  /** Reinicia: o main envia um reset (RIS) pelo próprio fluxo. */
  markRestarted(): void {
    this.early = []
  }

  onData(e: PtyDataEvent): void {
    if (this.disposed) return
    if (this.attachedSeq < 0) {
      this.early.push(e)
      if (this.early.length > 5000) this.early.splice(0, this.early.length - 5000)
      return
    }
    if (e.seq <= this.attachedSeq) return
    this.attachedSeq = e.seq
    this.term.write(e.data)
  }

  focus(): void {
    this.term.focus()
  }

  setAppearance(a: TerminalAppearance): void {
    this.term.options.fontFamily = a.fontFamily
    this.term.options.theme = a.theme
    this.term.options.scrollback = a.scrollback
    this.term.options.fontSize = Math.max(2, a.fontSize * this.renderZoom)
  }

  dispose(): void {
    this.disposed = true
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    this.focusListeners.clear()
    this.term.dispose()
  }
}

const controllers = new Map<string, TerminalController>()
let dataSubscribed = false

function subscribeData(): void {
  if (dataSubscribed) return
  dataSubscribed = true
  api.on('pty:data', (e) => controllers.get(e.id)?.onData(e))
}

/** Pega (ou cria) o controlador de um terminal e incrementa a contagem de uso. */
export function acquireTerminal(id: string): TerminalController {
  subscribeData()
  let c = controllers.get(id)
  if (!c) {
    c = new TerminalController(id)
    controllers.set(id, c)
  }
  if (c.disposeTimer) {
    clearTimeout(c.disposeTimer)
    c.disposeTimer = null
  }
  c.refs += 1
  return c
}

/** Libera o uso; a instância é descartada pouco depois se ninguém a reutilizar (remontagens). */
export function releaseTerminal(id: string): void {
  const c = controllers.get(id)
  if (!c) return
  c.refs = Math.max(0, c.refs - 1)
  if (c.refs > 0) return
  c.disposeTimer = setTimeout(() => {
    if (c.refs > 0) return
    controllers.delete(id)
    c.dispose()
  }, 800)
}

export function getTerminal(id: string): TerminalController | undefined {
  return controllers.get(id)
}

/**
 * Destaque da ocorrência escolhida (exige allowProposedApi, já ligado). Sem fundo nas demais: no renderer
 * de DOM ele é desenhado por cima e esconderia o texto.
 */
const SEARCH_DECORATIONS = {
  activeMatchBackground: '#d4a84988',
  matchOverviewRuler: '#d4a849',
  activeMatchColorOverviewRuler: '#e7bd5c'
}

/**
 * Mostra no terminal a ocorrência mais recente de `query` (resultado da busca na saída). Se o xterm não
 * achar (ex.: a busca foi sem acento), rola até a linha que o processo principal encontrou.
 */
export function revealInTerminal(id: string, query: string, line?: number): void {
  const c = controllers.get(id)
  if (!c) return
  c.search.clearDecorations()
  const found = c.search.findPrevious(query, { caseSensitive: false, decorations: SEARCH_DECORATIONS })
  if (!found && line !== undefined) c.term.scrollToLine(Math.max(0, line - Math.floor(c.term.rows / 2)))
  setTimeout(() => c.search.clearDecorations(), 6000)
}

export function focusTerminal(id: string): boolean {
  const c = controllers.get(id)
  if (!c) return false
  c.focus()
  return true
}

export function setTerminalAppearance(a: Partial<TerminalAppearance>): void {
  appearance = { ...appearance, ...a }
  for (const c of controllers.values()) c.setAppearance(appearance)
}

export function currentAppearance(): TerminalAppearance {
  return appearance
}

export type { TerminalController }
