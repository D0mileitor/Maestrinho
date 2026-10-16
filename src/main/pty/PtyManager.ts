import { EventEmitter } from 'node:events'
import * as pty from 'node-pty'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { IdleDetector, compileIdlePatterns, type IdleTransition } from '@shared/idle'
import { DEFAULT_SCROLLBACK } from '@shared/constants'
import { isTerminalReport } from '@shared/ansi'
import { codexNotificationSignal, type AgentEventsKind, type AgentSignal } from '@shared/agentEvents'
import type { InputMode } from '@shared/schemas'
import type { AttachResult, PtyDataEvent, TerminalRuntimeInfo } from '@shared/runtime'
import { planSpawn, CommandNotFoundError, type SpawnPlan } from './resolveCommand'
import { sanitizeInjectedText } from './inject'
import { lastLines, lastRows, searchLines } from './bufferText'

/**
 * Gerencia os processos em pseudo-terminais (ConPTY no Windows).
 *
 * Cada terminal mantém um "espelho" headless do xterm no processo principal. Ele permite:
 *  - reconstruir a tela no renderer a qualquer momento (recarga da janela, nó remontado);
 *  - ler o texto visível/scrollback limpo para `orq read` e `orq send --wait`, inclusive de TUIs
 *    que redesenham a tela com movimentos de cursor.
 */

export interface TerminalSpec {
  id: string
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  idleMs: number
  idlePatterns: string[]
  scrollback?: number
  /** O agente avisa o próprio estado: Codex por notificações OSC 9 (lidas aqui); Claude por hooks (via API). */
  agentEvents?: AgentEventsKind
}

interface Runtime {
  spec: TerminalSpec
  proc: pty.IPty | null
  plan: SpawnPlan | null
  mirror: HeadlessTerminal
  serializer: SerializeAddon
  info: TerminalRuntimeInfo
  detector: IdleDetector
  patterns: RegExp[]
  idleTimer: NodeJS.Timeout | null
  pending: string
  flushTimer: NodeJS.Timeout | null
  seq: number
  /** Blocos já emitidos mas ainda não processados pelo espelho. */
  unparsed: { seq: number; data: string }[]
  parsedSeq: number
  /** Fila de injeção de mensagens (serializa envios concorrentes). */
  injectChain: Promise<void>
  disposed: boolean
  generation: number
  /** Codificação de mouse ativa no espelho (DECSET 1006/1016); o serialize do xterm não a inclui. */
  mouseEncoding: 1006 | 1016 | null
  /** Horário do último aviso do agente aplicado (hooks assíncronos podem chegar fora de ordem). */
  lastSignalAt: number
  /** Última saída do processo (qualquer uma): para saber quando o agente terminou de receber uma colagem. */
  lastOutputAt: number
  /** Início da vez atual do agente (primeiro trabalho depois do último "terminou"); 0 = sem vez aberta. */
  turnStartedAt: number
  /** Rede de segurança: solta o "ocupado por aviso" depois de muito tempo sem saída nem aviso. */
  holdTimer: NodeJS.Timeout | null
}

/** Sem saída nem aviso do agente por este tempo, o "ocupado" volta a ser decidido pelo silêncio. */
const HOLD_MAX_SILENCE_MS = 30 * 60_000

export interface PtyManagerEvents {
  data: [PtyDataEvent]
  info: [TerminalRuntimeInfo]
  activity: [string, IdleTransition]
  exit: [string, number]
  /** Algo foi enviado ao programa (Enter digitado ou mensagem injetada): começa uma vez de trabalho. */
  submit: [string]
}

const FLUSH_MS = 5
/** Trabalho mínimo (ms de atividade contínua) para um "terminou" merecer atenção/notificação. */
const ATTENTION_MIN_BUSY_MS = 1500
const FLUSH_MAX_BYTES = 64 * 1024

export class PtyManager extends EventEmitter<PtyManagerEvents> {
  private readonly terminals = new Map<string, Runtime>()

  has(id: string): boolean {
    return this.terminals.has(id)
  }

  ids(): string[] {
    return [...this.terminals.keys()]
  }

  info(id: string): TerminalRuntimeInfo | undefined {
    const rt = this.terminals.get(id)
    return rt ? { ...rt.info } : undefined
  }

  /** Cria (e inicia) um terminal. Se já existir, apenas devolve o estado atual. */
  create(spec: TerminalSpec): TerminalRuntimeInfo {
    const existing = this.terminals.get(spec.id)
    if (existing) return { ...existing.info }

    const mirror = new HeadlessTerminal({
      cols: spec.cols,
      rows: spec.rows,
      scrollback: spec.scrollback ?? DEFAULT_SCROLLBACK,
      allowProposedApi: true
    })
    const serializer = new SerializeAddon()
    mirror.loadAddon(serializer)

    const rt: Runtime = {
      spec,
      proc: null,
      plan: null,
      mirror,
      serializer,
      info: { id: spec.id, status: 'starting', activity: 'idle', cols: spec.cols, rows: spec.rows, attentionSeq: 0 },
      detector: new IdleDetector({ idleMs: spec.idleMs }),
      patterns: compileIdlePatterns(spec.idlePatterns),
      idleTimer: null,
      pending: '',
      flushTimer: null,
      seq: 0,
      unparsed: [],
      parsedSeq: 0,
      injectChain: Promise.resolve(),
      disposed: false,
      generation: 0,
      mouseEncoding: null,
      lastSignalAt: 0,
      turnStartedAt: 0,
      holdTimer: null,
      lastOutputAt: 0
    }
    trackMouseEncoding(rt)
    // Codex: "terminou a vez" e "aprovação pedida" chegam como notificação de terminal (OSC 9).
    rt.mirror.parser.registerOscHandler(9, (data) => {
      if (rt.spec.agentEvents !== 'codex' || rt.disposed) return false
      const signal = codexNotificationSignal(data)
      if (signal) setImmediate(() => this.agentSignal(rt.spec.id, signal))
      return false
    })
    this.terminals.set(spec.id, rt)
    this.start(rt)
    return { ...rt.info }
  }

  private start(rt: Runtime): void {
    rt.generation += 1
    const generation = rt.generation
    rt.detector = new IdleDetector({ idleMs: rt.spec.idleMs })
    rt.lastSignalAt = 0
    rt.turnStartedAt = 0
    this.clearHoldTimer(rt)
    rt.info = { ...rt.info, exact: undefined, needsInput: undefined, attentionKind: undefined }
    try {
      rt.plan = planSpawn(rt.spec.command, rt.spec.args, rt.spec.env, { cwd: rt.spec.cwd })
      const proc = pty.spawn(rt.plan.file, rt.plan.args, {
        name: 'xterm-256color',
        cols: rt.spec.cols,
        rows: rt.spec.rows,
        cwd: rt.spec.cwd,
        env: rt.spec.env,
        // Usa o conpty.dll/OpenConsole.exe empacotados (mais novos que o ConPTY do sistema).
        useConptyDll: process.platform === 'win32'
      })
      rt.proc = proc
      rt.info = {
        ...rt.info,
        status: 'running',
        activity: 'idle',
        ready: false,
        waitingOn: undefined,
        pid: proc.pid,
        exitCode: undefined,
        error: undefined,
        commandLine: rt.plan.display,
        startedAt: Date.now()
      }
      proc.onData((data) => {
        if (rt.generation !== generation) return
        this.onProcessData(rt, data)
      })
      proc.onExit(({ exitCode }) => {
        if (rt.generation !== generation) return
        this.onProcessExit(rt, exitCode)
      })
    } catch (err) {
      rt.proc = null
      const message =
        err instanceof CommandNotFoundError
          ? `Comando "${err.command}" não encontrado no PATH. Instale o agente ou edite o preset.`
          : `Falha ao iniciar o processo: ${err instanceof Error ? err.message : String(err)}`
      rt.info = { ...rt.info, status: 'error', activity: 'idle', error: message, pid: undefined }
      this.pushLocal(rt, `\r\n\x1b[31m${message}\x1b[0m\r\n`)
    }
    this.emit('info', { ...rt.info })
  }

  private onProcessData(rt: Runtime, data: string): void {
    rt.lastOutputAt = Date.now()
    rt.pending += data
    if (rt.pending.length >= FLUSH_MAX_BYTES) {
      this.flush(rt)
    } else if (!rt.flushTimer) {
      rt.flushTimer = setTimeout(() => this.flush(rt), FLUSH_MS)
    }
  }

  /** Emite um bloco de saída: espelho headless + evento para o renderer + detector de ociosidade. */
  private flush(rt: Runtime, countsAsOutput = true): void {
    if (rt.flushTimer) {
      clearTimeout(rt.flushTimer)
      rt.flushTimer = null
    }
    if (!rt.pending || rt.disposed) return
    const data = rt.pending
    rt.pending = ''
    rt.seq += 1
    const seq = rt.seq
    rt.unparsed.push({ seq, data })
    rt.mirror.write(data, () => {
      rt.parsedSeq = seq
      const idx = rt.unparsed.findIndex((c) => c.seq === seq)
      if (idx >= 0) rt.unparsed.splice(0, idx + 1)
      if (countsAsOutput) this.trackActivity(rt)
    })
    this.emit('data', { id: rt.spec.id, seq, data })
  }

  /** Escreve texto gerado pelo app (avisos) como se fosse saída, sem afetar a ociosidade. */
  private pushLocal(rt: Runtime, text: string): void {
    this.flush(rt)
    rt.pending = text
    this.flush(rt, false)
  }

  private trackActivity(rt: Runtime): void {
    const now = Date.now()
    const matched = rt.patterns.length > 0 && this.lastLineMatches(rt)
    const t = rt.detector.onOutput(now, matched)
    if (t) this.applyTransition(rt, t)
    this.armIdleTimer(rt)
  }

  private armIdleTimer(rt: Runtime): void {
    if (rt.idleTimer) clearTimeout(rt.idleTimer)
    rt.idleTimer = null
    const deadline = rt.detector.nextDeadline
    if (deadline === null) return
    rt.idleTimer = setTimeout(
      () => {
        rt.idleTimer = null
        const t = rt.detector.tick(Date.now())
        if (t) this.applyTransition(rt, t)
        else this.armIdleTimer(rt)
      },
      Math.max(0, deadline - Date.now())
    )
  }

  private applyTransition(rt: Runtime, t: IdleTransition): void {
    rt.info = { ...rt.info, activity: t.state }
    if (t.state === 'busy') {
      // Abre a vez do agente (o Codex não avisa o início: vale a primeira saída depois do último "terminou").
      if (rt.turnStartedAt === 0 && rt.info.ready) rt.turnStartedAt = t.at
    } else {
      if (t.firstIdle) rt.info.ready = true
      // Com aviso exato do agente, o silêncio não é "terminou": quem avisa é o próprio agente.
      else if ((t.busyMs ?? 0) >= ATTENTION_MIN_BUSY_MS && !rt.info.waitingOn && !rt.info.exact) {
        rt.info.attentionSeq += 1
        rt.info.attentionKind = 'done'
      }
    }
    this.emit('activity', rt.spec.id, t)
    this.emit('info', { ...rt.info })
  }

  /**
   * Aviso do próprio agente sobre o estado (hook do Claude Code, notificação do Codex). `at` é quando o
   * aviso foi gerado: avisos assíncronos que chegam fora de ordem são descartados.
   */
  agentSignal(id: string, signal: AgentSignal, at = Date.now()): void {
    const rt = this.terminals.get(id)
    if (!rt?.proc || rt.disposed) return
    if (at < rt.lastSignalAt) return
    rt.lastSignalAt = at
    const now = Date.now()
    const wasExact = rt.info.exact === true
    rt.info = { ...rt.info, exact: true }
    if (signal === 'working') {
      if (rt.turnStartedAt === 0) rt.turnStartedAt = now
      const changed = !wasExact || rt.info.needsInput === true
      rt.info.needsInput = false
      const t = rt.detector.hold(now)
      this.armHoldTimer(rt)
      if (t) this.applyTransition(rt, t)
      else if (changed) this.emit('info', { ...rt.info })
      return
    }
    this.clearHoldTimer(rt)
    const waiting = signal === 'needsInput'
    const busyMs = rt.turnStartedAt > 0 ? now - rt.turnStartedAt : 0
    const t = rt.detector.release(now, 'idleNow')
    rt.info.needsInput = waiting
    rt.info.activity = 'idle'
    if (t?.firstIdle) rt.info.ready = true
    // Terminou uma vez de trabalho de verdade, ou parou pedindo algo: avisa (exceto quem espera outro agente).
    if (!rt.info.waitingOn && (waiting || busyMs >= ATTENTION_MIN_BUSY_MS)) {
      rt.info.attentionSeq += 1
      rt.info.attentionKind = waiting ? 'waiting' : 'done'
    }
    rt.turnStartedAt = 0
    if (t) this.emit('activity', rt.spec.id, t)
    this.emit('info', { ...rt.info })
  }

  private armHoldTimer(rt: Runtime): void {
    this.clearHoldTimer(rt)
    const check = (): void => {
      rt.holdTimer = null
      if (rt.disposed || !rt.detector.isHeld) return
      const last = Math.max(rt.lastSignalAt, rt.detector.lastActivity)
      const left = last + HOLD_MAX_SILENCE_MS - Date.now()
      if (left > 0) {
        rt.holdTimer = setTimeout(check, left)
        rt.holdTimer.unref?.()
        return
      }
      rt.detector.release(Date.now(), 'resume')
      this.armIdleTimer(rt)
    }
    rt.holdTimer = setTimeout(check, HOLD_MAX_SILENCE_MS)
    rt.holdTimer.unref?.()
  }

  private clearHoldTimer(rt: Runtime): void {
    if (rt.holdTimer) clearTimeout(rt.holdTimer)
    rt.holdTimer = null
  }

  private lastLineMatches(rt: Runtime): boolean {
    const line = this.cursorLineText(rt)
    return rt.patterns.some((re) => re.test(line))
  }

  private cursorLineText(rt: Runtime): string {
    const buf = rt.mirror.buffer.active
    for (let y = buf.baseY + buf.cursorY; y >= Math.max(0, buf.baseY + buf.cursorY - 3); y--) {
      const text = buf.getLine(y)?.translateToString(true) ?? ''
      if (text.trim() !== '') return text
    }
    return ''
  }

  private onProcessExit(rt: Runtime, exitCode: number): void {
    this.flush(rt)
    rt.proc = null
    this.clearHoldTimer(rt)
    const t = rt.detector.forceIdle(Date.now())
    rt.info = { ...rt.info, status: 'exited', activity: 'idle', exitCode, pid: undefined }
    if (t) this.emit('activity', rt.spec.id, t)
    this.pushLocal(rt, `\r\n\x1b[90m[processo encerrado com código ${exitCode}]\x1b[0m\r\n`)
    this.emit('info', { ...rt.info })
    this.emit('exit', rt.spec.id, exitCode)
  }

  /** Entrada vinda do teclado do usuário (renderer). */
  writeUser(id: string, data: string): void {
    const rt = this.terminals.get(id)
    if (!rt?.proc) return
    // Respostas automáticas do xterm (ex.: ao DA1 que o ConPTY envia ao iniciar) não são digitação:
    // se abrissem a janela de eco, a saída inicial seria ignorada e o terminal nunca ficaria pronto.
    if (!isTerminalReport(data)) {
      rt.detector.onUserInput(Date.now())
      if (data.includes('\r')) this.emit('submit', id)
      // Você respondeu ao pedido do agente (a tela de aprovação/pergunta recebe a tecla).
      if (rt.info.needsInput && !isFocusReport(data)) {
        rt.info = { ...rt.info, needsInput: false }
        this.emit('info', { ...rt.info })
      }
    }
    // Esc ou Ctrl+C interrompem o agente sem que ele avise o fim da vez: volta a valer o silêncio.
    if (rt.detector.isHeld && (data === '\x1b' || data.includes('\x03'))) {
      this.clearHoldTimer(rt)
      rt.detector.release(Date.now(), 'resume')
      rt.turnStartedAt = 0
      this.armIdleTimer(rt)
    }
    rt.proc.write(data)
  }

  /** Escrita direta (sem marcar como entrada do usuário). */
  writeRaw(id: string, data: string): boolean {
    const rt = this.terminals.get(id)
    if (!rt?.proc) return false
    rt.proc.write(data)
    return true
  }

  resize(id: string, cols: number, rows: number): void {
    const rt = this.terminals.get(id)
    if (!rt) return
    const c = Math.max(2, Math.min(1000, Math.floor(cols)))
    const r = Math.max(1, Math.min(500, Math.floor(rows)))
    if (c === rt.info.cols && r === rt.info.rows) return
    rt.spec = { ...rt.spec, cols: c, rows: r }
    rt.info = { ...rt.info, cols: c, rows: r }
    rt.detector.onResize(Date.now())
    rt.mirror.resize(c, r)
    try {
      rt.proc?.resize(c, r)
    } catch {
      // processo pode ter acabado de sair
    }
  }

  /**
   * Injeta uma mensagem como se tivesse sido colada/digitada, e envia Enter.
   * Mensagens para o mesmo terminal são serializadas.
   */
  inject(
    id: string,
    text: string,
    opts: { inputMode: InputMode; submitDelayMs: number; isShell: boolean; submit?: boolean }
  ): Promise<void> {
    const rt = this.terminals.get(id)
    if (!rt) return Promise.reject(new Error('terminal inexistente'))
    const run = async (): Promise<void> => {
      if (!rt.proc) throw new Error('o processo do terminal não está em execução')
      if (opts.submit !== false) this.emit('submit', id)
      const clean = sanitizeInjectedText(text)
      if (opts.inputMode === 'bracketed') {
        rt.proc.write(`\x1b[200~${clean}\x1b[201~`)
      } else {
        rt.proc.write(opts.isShell ? clean.replace(/\n/g, '\r') : clean.replace(/\n+/g, ' '))
      }
      // submit: false cola sem enviar (ex.: o caminho de um print antes do texto da mensagem).
      if (opts.submit === false) return
      await sleep(opts.submitDelayMs)
      // Texto longo para um agente: o ConPTY entrega a colagem em pedaços e o agente (ex.: o Codex) leva
      // segundos para absorvê-la; um Enter no meio vira quebra de linha e a mensagem fica parada na caixa.
      // Só envia quando a tela parar de mudar.
      if (!opts.isShell && clean.length > LONG_PASTE_CHARS) await waitQuiet(rt, PASTE_QUIET_MS, Math.min(PASTE_MAX_WAIT_MS, 2000 + clean.length))
      rt.proc?.write('\r')
    }
    const next = rt.injectChain.then(run, run)
    rt.injectChain = next.catch(() => undefined)
    return next
  }

  /** Estado serializado para reconstruir a tela no renderer. */
  attach(id: string): AttachResult | null {
    const rt = this.terminals.get(id)
    if (!rt) return null
    // Garante que o que está pendente vá para o espelho e para o stream.
    this.flush(rt)
    const snapshot = rt.serializer.serialize({ scrollback: rt.spec.scrollback ?? DEFAULT_SCROLLBACK })
    // Blocos emitidos mas ainda não processados pelo espelho seguem logo após o snapshot.
    const tail = rt.unparsed.filter((c) => c.seq > rt.parsedSeq).map((c) => c.data).join('')
    // Sem isto, um TUI que liga o mouse em SGR (Codex) voltaria no formato X10 após o attach, que o
    // ConPTY não entende e repassa ao programa como texto digitado ("[MC%[MC8...").
    const mouse = rt.mouseEncoding ? `\x1b[?${rt.mouseEncoding}h` : ''
    return { info: { ...rt.info }, snapshot: snapshot + mouse + tail, seq: rt.seq }
  }

  /**
   * Texto limpo (sem ANSI) das últimas `lines` linhas lógicas do terminal (linhas quebradas
   * pelo wrap são unidas). Usa o buffer ativo (normal ou alternativo, no caso de TUIs).
   */
  readText(id: string, lines: number): string | null {
    const rt = this.terminals.get(id)
    if (!rt) return null
    return lastLines(rt.mirror.buffer.active, lines)
  }

  /** Últimas linhas físicas da tela, como aparecem (para achar perguntas com opções em TUIs). */
  readScreen(id: string, rows: number): string | null {
    const rt = this.terminals.get(id)
    if (!rt) return null
    return lastRows(rt.mirror.buffer.active, rows, rt.mirror.cols)
  }

  /**
   * Linhas da saída de cada terminal que contêm `query` (sem acento e sem maiúsculas), das mais
   * recentes; até `perTerminal` por terminal, olhando as últimas 5 mil linhas de cada um.
   */
  searchOutput(query: string, perTerminal = 3): { id: string; text: string; line: number }[] {
    const out: { id: string; text: string; line: number }[] = []
    for (const [id, rt] of this.terminals) {
      if (rt.disposed) continue
      for (const m of searchLines(rt.mirror.buffer.active, query, perTerminal)) out.push({ id, text: m.text, line: m.y })
    }
    return out
  }

  /** Ponto no tempo da última atividade real (para --wait). */
  lastActivity(id: string): number {
    return this.terminals.get(id)?.detector.lastActivity ?? Number.NEGATIVE_INFINITY
  }

  /** Momento da última entrada do usuário pela interface (a API espera ele parar de digitar antes de injetar). */
  lastUserInputAt(id: string): number {
    return this.terminals.get(id)?.detector.lastUserInput ?? Number.NEGATIVE_INFINITY
  }

  /** Marca que o terminal está bloqueado esperando outro agente (suprime "atenção"). */
  setWaitingOn(id: string, peer: string | undefined): void {
    const rt = this.terminals.get(id)
    if (!rt || rt.info.waitingOn === peer) return
    rt.info = { ...rt.info, waitingOn: peer }
    this.emit('info', { ...rt.info })
  }

  setBadge(id: string, badge: string | undefined): void {
    const rt = this.terminals.get(id)
    if (!rt) return
    rt.info = { ...rt.info, badge }
    this.emit('info', { ...rt.info })
  }

  updateSpec(id: string, patch: Partial<Pick<TerminalSpec, 'idleMs' | 'idlePatterns'>>): void {
    const rt = this.terminals.get(id)
    if (!rt) return
    rt.spec = { ...rt.spec, ...patch }
    if (patch.idlePatterns) rt.patterns = compileIdlePatterns(patch.idlePatterns)
  }

  /** Reinicia o processo (mesmo spec, ou spec novo). Limpa a tela. */
  restart(id: string, spec?: TerminalSpec): TerminalRuntimeInfo | undefined {
    const rt = this.terminals.get(id)
    if (!rt) return undefined
    if (spec) rt.spec = { ...spec, cols: rt.spec.cols, rows: rt.spec.rows }
    this.stopProcess(rt)
    // Reset completo (RIS) no espelho e no renderer.
    this.pushLocal(rt, '\x1bc')
    rt.info = { ...rt.info, status: 'starting', badge: undefined }
    this.start(rt)
    return { ...rt.info }
  }

  private stopProcess(rt: Runtime): void {
    if (rt.idleTimer) clearTimeout(rt.idleTimer)
    rt.idleTimer = null
    this.clearHoldTimer(rt)
    const proc = rt.proc
    rt.proc = null
    rt.generation += 1
    if (proc) {
      try {
        proc.kill()
      } catch {
        // já encerrado
      }
    }
  }

  /** Encerra o processo e descarta o terminal. */
  dispose(id: string): void {
    const rt = this.terminals.get(id)
    if (!rt) return
    this.stopProcess(rt)
    if (rt.flushTimer) clearTimeout(rt.flushTimer)
    rt.disposed = true
    rt.mirror.dispose()
    this.terminals.delete(id)
  }

  disposeAll(): void {
    for (const id of [...this.terminals.keys()]) this.dispose(id)
  }
}

/**
 * Acompanha no espelho a codificação dos relatórios de mouse (1006 = SGR, 1016 = SGR em pixels), com a
 * mesma semântica do xterm.js: ligar define a codificação; desligar qualquer uma volta ao padrão (X10);
 * RIS também volta ao padrão. Os handlers devolvem false para o xterm seguir tratando a sequência.
 */
function trackMouseEncoding(rt: Runtime): void {
  const modes = (params: (number | number[])[]): number[] => params.map((p) => (typeof p === 'number' ? p : (p[0] ?? 0)))
  rt.mirror.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
    for (const m of modes(params)) if (m === 1006 || m === 1016) rt.mouseEncoding = m
    return false
  })
  rt.mirror.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
    if (modes(params).some((m) => m === 1006 || m === 1016)) rt.mouseEncoding = null
    return false
  })
  rt.mirror.parser.registerEscHandler({ final: 'c' }, () => {
    rt.mouseEncoding = null
    return false
  })
}

/** Avisos de foco do xterm (DECSET 1004): clicar no terminal não é responder ao agente. */
function isFocusReport(data: string): boolean {
  return data === '\x1b[I' || data === '\x1b[O'
}

/** Colagem a partir da qual o Enter espera a tela do agente parar de mudar. */
const LONG_PASTE_CHARS = 300
const PASTE_QUIET_MS = 600
const PASTE_MAX_WAIT_MS = 20_000

/** Espera o processo ficar `quietMs` sem saída (no máximo `maxMs`, contado a partir de agora). */
async function waitQuiet(rt: Runtime, quietMs: number, maxMs: number): Promise<void> {
  const until = Date.now() + maxMs
  while (rt.proc && !rt.disposed && Date.now() < until && Date.now() - rt.lastOutputAt < quietMs) await sleep(50)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
