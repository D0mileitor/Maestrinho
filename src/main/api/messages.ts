import { ApiError, type WaitResult } from '@shared/api'
import { API_LONG_POLL_MS, CLI_NAME } from '@shared/constants'
import { newId } from '@shared/ids'
import { messageMood } from '@shared/mood'
import type { TerminalRuntimeInfo } from '@shared/runtime'
import type { TerminalNodeData } from '@shared/schemas'
import { edgeKey } from '@shared/workspaceOps'
import { formatMessage } from '../pty/inject'
import { log } from '../util/log'
import { areConnected } from './graph'
import { RateLimiter } from './RateLimiter'
import type { ApiDeps } from './types'

/**
 * Entrega de mensagens entre agentes (orq send) e espera pela resposta (orq send --wait).
 *
 * Entrega: a mensagem é formatada com o modelo do preset do DESTINO e injetada no PTY dele (colagem
 * + Enter). Antes de injetar, espera o destino terminar de iniciar e o usuário parar de digitar nele
 * (as duas esperas dividem um único prazo, para a resposta HTTP caber no timeout do CLI), e confere
 * de novo a conexão (o usuário pode tê-la removido nesse meio tempo).
 *
 * Espera: `send` com wait registra uma espera pendente; o CLI faz long-poll em `wait` até o destino
 * ficar ocioso depois de ter tido atividade real após o envio (ou o processo dele terminar). A
 * conexão é conferida de novo a cada poll: sem ela, a saída do destino não é devolvida.
 */

export interface MessageServiceOptions {
  /** Limitador por conexão (padrão: 30 mensagens por 60 s em cada par de terminais). */
  limiter?: RateLimiter
  /** Silêncio do teclado do usuário exigido antes de injetar (padrão 1,5 s). */
  userQuietMs?: number
  /** Máximo que a entrega espera o usuário parar de digitar (padrão 20 s). */
  maxUserDeferMs?: number
  /** Máximo que a entrega espera o destino terminar de iniciar (padrão 20 s). */
  readyWaitMs?: number
  /**
   * Prazo total das esperas antes da injeção (inicialização + digitação), já descontado o
   * `submitDelayMs` do preset (padrão API_LONG_POLL_MS = 25 s): `send` responde dentro do timeout do CLI.
   */
  deliveryBudgetMs?: number
  /** Intervalo de verificação das esperas (padrão 200 ms). */
  pollIntervalMs?: number
  /** Validade de uma espera pendente (padrão 2 h). */
  waitTtlMs?: number
  /** Espera sem nenhum long-poll ativo por este tempo é considerada abandonada (padrão 45 s). */
  orphanMs?: number
  /** Máximo de esperas pendentes por terminal; as mais antigas são descartadas (padrão 20). */
  maxPendingPerCaller?: number
  /** Intervalo da limpeza de esperas vencidas (padrão 15 s). */
  sweepIntervalMs?: number
}

interface PendingWait {
  messageId: string
  fromId: string
  fromName: string
  toId: string
  toName: string
  /** Instante (Date.now) imediatamente anterior à injeção. */
  sentAt: number
  /** pid do destino no envio: se mudar, o processo foi reiniciado e a resposta não virá. */
  pid: number | undefined
  createdAt: number
  /** Long-polls em andamento para esta mensagem. */
  polls: number
  /** Último instante em que houve (ou terminou) um long-poll. */
  lastSeenAt: number
}

export type WaitReason = NonNullable<WaitResult['reason']>

const STATUS_LABEL: Record<TerminalRuntimeInfo['status'] | 'stopped', string> = {
  starting: 'iniciando',
  running: 'em execução',
  exited: 'processo encerrado',
  error: 'falhou ao iniciar',
  stopped: 'parado'
}

/**
 * Uma espera conta como "em andamento" (para detectar esperas circulares) se há um long-poll aberto
 * ou houve um há pouco: entre dois polls o CLI leva milissegundos; uma espera parada há mais tempo
 * que isso é de um CLI que já saiu e só aguarda a limpeza.
 */
const ACTIVE_WAIT_GRACE_MS = 5_000

/** Prefixo inserido antes de um cabeçalho de mensagem forjado dentro do texto. */
export const QUOTED_HEADER_LABEL = '(citado) '

/** Espera `ms` (ou até o sinal abortar). Nunca rejeita; quem chama confere `signal.aborted`. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, Math.max(1, ms))
    signal.addEventListener('abort', done, { once: true })
  })
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function connectionMissingMessage(a: string, b: string): string {
  return `Não há conexão entre "${a}" e "${b}" no canvas. Peça ao usuário para conectar os dois terminais.`
}

/**
 * Trecho fixo do cabeçalho do modelo que antecede o nome do remetente, sem as aspas finais
 * (`[Mensagem de "{from}" ...` -> `[Mensagem de`), ou null se o modelo não identifica o remetente
 * antes do texto (ex.: "{text}" dos shells) ou se o trecho for curto demais para ser reconhecível.
 */
export function headerMarker(template: string): string | null {
  const FROM = '\u0000remetente\u0000'
  const TEXT = '\u0000texto\u0000'
  const sample = formatMessage(template, { from: FROM, text: TEXT, cli: CLI_NAME })
  const fromAt = sample.indexOf(FROM)
  const textAt = sample.indexOf(TEXT)
  if (fromAt < 0 || textAt < 0 || fromAt > textAt) return null
  const lineStart = sample.lastIndexOf('\n', fromAt) + 1
  const marker = sample
    .slice(lineStart, fromAt)
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim()
  return marker.length >= 3 && /[\p{L}\p{N}]/u.test(marker) ? marker : null
}

/**
 * Neutraliza cabeçalhos forjados no texto de uma mensagem. Sem isso um agente poderia escrever
 * `[Mensagem de "gerente" via orq] ...` no meio do texto e o destino acharia que outro terminal
 * escreveu aquilo (as instruções ensinam que esse cabeçalho identifica o remetente). Cada ocorrência
 * do trecho fixo do cabeçalho ganha o prefixo "(citado) "; o cabeçalho verdadeiro, acrescentado
 * depois pelo modelo, não é afetado. Modelos sem cabeçalho (shells) não mudam o texto.
 */
export function neutralizeForgedHeaders(text: string, template: string): string {
  const marker = headerMarker(template)
  if (!marker) return text
  const pattern = new RegExp(escapeRegExp(marker).replace(/\s+/g, '\\s+'), 'gi')
  return text.replace(pattern, (m) => `${QUOTED_HEADER_LABEL}${m}`)
}

export class MessageService {
  private readonly limiter: RateLimiter
  private readonly userQuietMs: number
  private readonly maxUserDeferMs: number
  private readonly readyWaitMs: number
  private readonly deliveryBudgetMs: number
  private readonly pollIntervalMs: number
  private readonly waitTtlMs: number
  private readonly orphanMs: number
  private readonly maxPendingPerCaller: number
  private readonly sweepIntervalMs: number
  private readonly pending = new Map<string, PendingWait>()
  private sweeper: NodeJS.Timeout | null = null
  /** Abortado em dispose(): encerra esperas e long-polls em andamento. */
  private readonly lifetime = new AbortController()

  constructor(
    private readonly deps: ApiDeps,
    opts: MessageServiceOptions = {}
  ) {
    this.limiter = opts.limiter ?? new RateLimiter({ limit: 30, windowMs: 60_000 })
    this.userQuietMs = opts.userQuietMs ?? 1500
    this.maxUserDeferMs = opts.maxUserDeferMs ?? 20_000
    this.readyWaitMs = opts.readyWaitMs ?? 20_000
    this.deliveryBudgetMs = Math.max(0, opts.deliveryBudgetMs ?? API_LONG_POLL_MS)
    this.pollIntervalMs = Math.max(1, opts.pollIntervalMs ?? 200)
    this.waitTtlMs = opts.waitTtlMs ?? 2 * 60 * 60 * 1000
    this.orphanMs = opts.orphanMs ?? 45_000
    this.maxPendingPerCaller = Math.max(1, opts.maxPendingPerCaller ?? 20)
    this.sweepIntervalMs = Math.max(10, opts.sweepIntervalMs ?? 15_000)
  }

  /**
   * Sinal abortado quando o cliente desconecta OU o serviço é descartado. Os ouvintes são removidos
   * explicitamente em `release()` (sem depender do GC, já que há um por long-poll).
   */
  private link(signal?: AbortSignal): { signal: AbortSignal; release(): void } {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    const sources = signal ? [this.lifetime.signal, signal] : [this.lifetime.signal]
    for (const s of sources) {
      if (s.aborted) controller.abort()
      else s.addEventListener('abort', abort, { once: true })
    }
    return {
      signal: controller.signal,
      release: () => {
        for (const s of sources) s.removeEventListener('abort', abort)
      }
    }
  }

  /** Destino precisa ter um processo em execução. */
  private assertRunning(to: TerminalNodeData): TerminalRuntimeInfo {
    const info = this.deps.ptys.info(to.id)
    if (!info || info.status !== 'running') {
      const label = STATUS_LABEL[info?.status ?? 'stopped']
      throw new ApiError(
        'unavailable',
        `O terminal "${to.name}" não está em execução (${label}). ` +
          'Peça ao usuário para iniciá-lo (ou reiniciá-lo) no canvas e tente de novo.'
      )
    }
    return info
  }

  /**
   * Revalida, logo antes de injetar, que os dois terminais ainda existem e continuam conectados, e
   * devolve o nó atual do destino (nome/preset podem ter mudado durante a espera).
   */
  private currentTarget(from: TerminalNodeData, to: TerminalNodeData): TerminalNodeData {
    const found = this.deps.workspaces.nodeById(from.id)
    const fresh = found?.ws.doc.nodes.find((n) => n.id === to.id)
    if (!found || !fresh || fresh.kind !== 'terminal') {
      throw new ApiError('not_found', `O terminal "${to.name}" foi removido do canvas antes da entrega.`)
    }
    if (!areConnected(found.ws.doc, from.id, to.id)) {
      const fromName = found.node.kind === 'terminal' ? found.node.name : from.name
      throw new ApiError('forbidden', connectionMissingMessage(fromName, fresh.name))
    }
    return fresh
  }

  /** Espera o destino terminar de iniciar (primeira ociosidade) para a colagem não se perder. */
  private async waitUntilReady(id: string, signal: AbortSignal, until: number): Promise<void> {
    const start = Date.now()
    while (!signal.aborted) {
      const info = this.deps.ptys.info(id)
      if (!info || info.status !== 'running' || info.ready !== false) return
      const now = Date.now()
      const left = Math.min(this.readyWaitMs - (now - start), until - now)
      if (left <= 0) return
      await sleep(Math.min(this.pollIntervalMs, left), signal)
    }
  }

  /** Se o usuário digitou no destino há pouco, espera um intervalo sem digitação (com limite). */
  private async waitForUserQuiet(id: string, signal: AbortSignal, until: number): Promise<void> {
    const start = Date.now()
    while (!signal.aborted) {
      const now = Date.now()
      const quietFor = now - this.deps.ptys.lastUserInputAt(id)
      if (quietFor >= this.userQuietMs) return
      const left = Math.min(this.maxUserDeferMs - (now - start), until - now)
      if (left <= 0) return
      await sleep(Math.min(this.userQuietMs - quietFor, left, 250), signal)
    }
  }

  /** A espera está viva (há um CLI acompanhando)? */
  private isActive(w: PendingWait, now: number): boolean {
    return w.polls > 0 || now - w.lastSeenAt < ACTIVE_WAIT_GRACE_MS
  }

  /**
   * `fromId` passaria a esperar por `toId`, que já espera (direta ou indiretamente) por `fromId`:
   * nenhum dos dois ficaria ocioso enquanto o outro espera, e as duas esperas só acabariam no timeout.
   */
  private wouldDeadlock(fromId: string, toId: string, now = Date.now()): boolean {
    const seen = new Set<string>()
    const stack = [toId]
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (cur === fromId) return true
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const w of this.pending.values()) if (w.fromId === cur && this.isActive(w, now)) stack.push(w.toId)
    }
    return false
  }

  /**
   * Entrega `text` de `from` para `to` (já validados como conectados pelo chamador).
   * Com `wait`, registra a espera que o CLI acompanha via `wait(messageId)`.
   */
  async send(
    from: TerminalNodeData,
    to: TerminalNodeData,
    text: string,
    opts: { wait: boolean; signal?: AbortSignal }
  ): Promise<{ messageId: string }> {
    // Destino hibernando: acorda (retomando a conversa); a entrega espera ele terminar de iniciar.
    this.deps.wake?.(to.id)
    this.assertRunning(to)
    if (opts.wait && this.wouldDeadlock(from.id, to.id)) {
      throw new ApiError(
        'conflict',
        `Esperar a resposta de "${to.name}" agora travaria os dois: "${to.name}" já está aguardando ` +
          `(direta ou indiretamente) uma resposta sua. Envie sem --wait: \`${CLI_NAME} send ${to.name} "<resposta>"\`.`
      )
    }
    const decision = this.limiter.hit(edgeKey(from.id, to.id))
    if (!decision.allowed) {
      const secs = Math.ceil(decision.retryAfterMs / 1000)
      throw new ApiError(
        'rate_limited',
        `Limite de mensagens entre "${from.name}" e "${to.name}" atingido (${this.limiter.limit} a cada ` +
          `${Math.round(this.limiter.windowMs / 1000)} s). Isso costuma indicar um ciclo de mensagens entre agentes: ` +
          `não responda automaticamente a cada mensagem. Aguarde ${secs} s antes de enviar de novo.`
      )
    }

    const link = this.link(opts.signal)
    try {
      // Um único prazo para as duas esperas, descontado o atraso do Enter: a resposta cabe no timeout do CLI.
      const until = Date.now() + Math.max(0, this.deliveryBudgetMs - this.deps.terminals.presetFor(to).submitDelayMs)
      await this.waitUntilReady(to.id, link.signal, until)
      await this.waitForUserQuiet(to.id, link.signal, until)
      if (link.signal.aborted) {
        throw new ApiError('unavailable', 'Envio cancelado: o cliente desconectou ou o app está encerrando.')
      }
    } finally {
      link.release()
    }
    const target = this.currentTarget(from, to)
    const info = this.assertRunning(target)

    const preset = this.deps.terminals.presetFor(target)
    const body = neutralizeForgedHeaders(text, preset.messageTemplate)
    const delivered = formatMessage(preset.messageTemplate, { from: from.name, text: body, cli: CLI_NAME })
    const messageId = newId('m')
    const sentAt = Date.now()
    try {
      await this.deps.ptys.inject(target.id, delivered, {
        inputMode: preset.inputMode,
        submitDelayMs: preset.submitDelayMs,
        isShell: preset.isShell
      })
    } catch {
      throw new ApiError(
        'unavailable',
        `Não foi possível entregar a mensagem: o processo do terminal "${target.name}" encerrou durante o envio.`
      )
    }
    this.deps.emitEdgeActivity({ from: from.id, to: target.id, kind: 'send', mood: messageMood(text) })
    log.info('mensagem entregue', { from: from.id, to: target.id, chars: text.length, wait: opts.wait })

    if (opts.wait) {
      this.register({
        messageId,
        fromId: from.id,
        fromName: from.name,
        toId: target.id,
        toName: target.name,
        sentAt,
        pid: info.pid,
        createdAt: sentAt,
        polls: 0,
        lastSeenAt: Date.now()
      })
    }
    return { messageId }
  }

  private register(p: PendingWait): void {
    const mine = [...this.pending.values()].filter((w) => w.fromId === p.fromId)
    // Limita a memória: descarta as esperas mais antigas do mesmo terminal.
    for (const old of mine.slice(0, Math.max(0, mine.length - this.maxPendingPerCaller + 1))) {
      this.pending.delete(old.messageId)
    }
    this.pending.set(p.messageId, p)
    this.refreshWaitingOn(p.fromId)
    this.ensureSweeper()
  }

  /** Mostra no nó de origem quem ele está aguardando (a espera mais recente), ou limpa. */
  private refreshWaitingOn(fromId: string): void {
    let latest: PendingWait | undefined
    for (const w of this.pending.values()) {
      if (w.fromId === fromId && (!latest || w.createdAt >= latest.createdAt)) latest = w
    }
    this.deps.ptys.setWaitingOn(fromId, latest?.toName)
  }

  private finish(p: PendingWait): void {
    if (!this.pending.delete(p.messageId)) return
    this.refreshWaitingOn(p.fromId)
    if (this.pending.size === 0) this.stopSweeper()
  }

  /** Origem e destino continuam conectados no canvas (a permissão vale enquanto durar a espera). */
  private stillConnected(p: PendingWait): boolean {
    const found = this.deps.workspaces.nodeById(p.fromId)
    return found !== undefined && areConnected(found.ws.doc, p.fromId, p.toId)
  }

  /** Motivo de término da espera, ou null se ainda não terminou. */
  private check(p: PendingWait): WaitReason | null {
    const info = this.deps.ptys.info(p.toId)
    if (!info || info.status !== 'running') return 'exited'
    if (p.pid !== undefined && info.pid !== undefined && info.pid !== p.pid) return 'exited'
    if (info.activity === 'idle' && this.deps.ptys.lastActivity(p.toId) > p.sentAt) return 'idle'
    return null
  }

  /**
   * Long-poll da resposta: devolve assim que o destino terminar (ocioso após atividade, ou processo
   * encerrado) ou quando `pollMs` vencer (done=false: o CLI chama de novo). Se a conexão foi removida
   * no meio da espera, a espera é encerrada com ApiError('forbidden') e a tela do destino não é lida.
   */
  async wait(
    callerId: string,
    messageId: string,
    pollMs: number,
    lines: number,
    cancel?: boolean,
    externalSignal?: AbortSignal
  ): Promise<WaitResult> {
    const p = this.pending.get(messageId)
    if (!p || p.fromId !== callerId) {
      throw new ApiError(
        'not_found',
        `Mensagem "${messageId}" não encontrada: a espera já terminou, foi cancelada ou expirou ` +
          `(ou a mensagem não foi enviada por este terminal). Para ver a saída atual use \`${CLI_NAME} read <peer>\`.`
      )
    }
    if (cancel) {
      this.finish(p)
      return { done: true, reason: 'cancelled', to: p.toName }
    }

    const link = this.link(externalSignal)
    const deadline = Date.now() + Math.max(0, pollMs)
    p.polls += 1
    p.lastSeenAt = Date.now()
    try {
      for (;;) {
        if (!this.pending.has(p.messageId)) return { done: true, reason: 'cancelled', to: p.toName }
        // Processo do destino já descartado (ex.: dispensado): não há tela a proteger, vale o "exited".
        if (this.deps.ptys.has(p.toId) && !this.stillConnected(p)) {
          this.finish(p)
          throw new ApiError(
            'forbidden',
            `A conexão entre "${p.fromName}" e "${p.toName}" foi removida no canvas: a espera pela resposta foi ` +
              'encerrada e a saída do destino não pode mais ser lida. Peça ao usuário para reconectar os terminais se ' +
              'ainda precisar da resposta.'
          )
        }
        const reason = this.check(p)
        if (reason) {
          this.finish(p)
          const output = this.deps.ptys.readText(p.toId, lines) ?? ''
          // A resposta "volta" pela conexão até quem perguntou.
          if (reason === 'idle') this.deps.emitEdgeActivity({ from: p.toId, to: p.fromId, kind: 'read' })
          return { done: true, reason, output, to: p.toName }
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0 || link.signal.aborted) return { done: false, to: p.toName }
        await sleep(Math.min(this.pollIntervalMs, remaining), link.signal)
      }
    } finally {
      link.release()
      p.polls -= 1
      p.lastSeenAt = Date.now()
    }
  }

  /** Esperas pendentes (diagnóstico/testes). */
  get pendingCount(): number {
    return this.pending.size
  }

  private ensureSweeper(): void {
    if (this.sweeper) return
    this.sweeper = setInterval(() => this.sweep(), this.sweepIntervalMs)
    this.sweeper.unref?.()
  }

  private stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
  }

  /** Remove esperas vencidas (2 h) ou abandonadas (CLI encerrado sem cancelar). */
  sweep(now = Date.now()): void {
    for (const p of [...this.pending.values()]) {
      const expired = now - p.createdAt > this.waitTtlMs
      const orphan = p.polls === 0 && now - p.lastSeenAt > this.orphanMs
      if (expired || orphan) {
        log.debug('espera de mensagem descartada', { from: p.fromId, to: p.toId, expired, orphan })
        this.finish(p)
      }
    }
    if (this.pending.size === 0) this.stopSweeper()
  }

  /** Encerra timers e long-polls (saída do app). */
  dispose(): void {
    this.lifetime.abort()
    this.stopSweeper()
    const callers = new Set([...this.pending.values()].map((p) => p.fromId))
    this.pending.clear()
    for (const id of callers) this.deps.ptys.setWaitingOn(id, undefined)
  }
}
