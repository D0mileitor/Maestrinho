import type { IdleTransition } from '@shared/idle'
import type { InputMode } from '@shared/schemas'
import { log } from '../util/log'

/**
 * Fila do briefing enviado como primeira mensagem: entrega uma única vez, quando o agente fica
 * ocioso pela primeira vez (terminou de iniciar).
 *
 * Segurança: se a tela mostra um diálogo de confirmação (ex.: "Do you trust the files in this
 * folder?", menus numerados com cursor, "[y/n]"), o Enter do briefing aceitaria a opção padrão em
 * nome do usuário. Nesses casos a entrega é adiada até a próxima vez que o terminal ficar ocioso
 * sem o diálogo na tela.
 */

export interface InjectOptions {
  inputMode: InputMode
  submitDelayMs: number
  isShell: boolean
}

export interface BriefingDeps {
  inject(id: string, text: string, opts: InjectOptions): Promise<void>
  /** O processo do terminal está rodando? */
  isRunning(id: string): boolean
  /** Últimas linhas da tela, sem ANSI. */
  screen(id: string): string
}

export interface BriefingTimeouts {
  /** Desiste se o agente não ficar pronto (ocioso) neste tempo. */
  readyMs: number
  /** Depois de adiar por um diálogo de confirmação, espera o usuário por até este tempo. */
  promptMs: number
}

export const DEFAULT_BRIEFING_TIMEOUTS: BriefingTimeouts = { readyMs: 60_000, promptMs: 10 * 60_000 }

const CONFIRM_PATTERNS: readonly RegExp[] = [
  // Cursor de seleção numa opção numerada ("❯ 1. Yes, proceed", "› 1. Yes, allow...", "> 2) Não").
  /^\s*[❯›>▶►➜→]\s*\d+[.)]\s+\S/mu,
  /\b(do you trust|trust (this|the) (folder|files|directory|workspace|project)|allow \S+ to work in this folder)\b/i,
  /\bconfia(r)? (n(esta|essa|este|esse)|em) (pasta|diret[óo]rio|projeto)\b/iu,
  /[[(]\s*(y\/n|s\/n|yes\/no|sim\/n[ãa]o)\s*[\])]/i
]

/** A tela parece estar esperando uma confirmação do usuário? (heurística sobre as últimas linhas) */
export function looksLikeConfirmationPrompt(screen: string): boolean {
  const tail = screen.split('\n').slice(-25).join('\n')
  return CONFIRM_PATTERNS.some((re) => re.test(tail))
}

interface Pending {
  text: string
  opts: InjectOptions
  timer: ReturnType<typeof setTimeout>
  /** Já foi adiado por um diálogo de confirmação: qualquer próxima ociosidade serve. */
  deferred: boolean
  /** Chamado quando o briefing foi entregue ao agente. */
  onDelivered?: () => void
}

export class BriefingQueue {
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly deps: BriefingDeps,
    private readonly timeouts: BriefingTimeouts = DEFAULT_BRIEFING_TIMEOUTS
  ) {}

  /** Agenda o briefing do terminal (substitui um anterior ainda não entregue). */
  queue(id: string, text: string, opts: InjectOptions, onDelivered?: () => void): void {
    this.cancel(id)
    const timer = this.arm(id, this.timeouts.readyMs, 'o agente não ficou pronto a tempo')
    this.pending.set(id, { text, opts, timer, deferred: false, onDelivered })
  }

  cancel(id: string): void {
    const p = this.pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(id)
  }

  has(id: string): boolean {
    return this.pending.has(id)
  }

  /** Recebe os eventos 'activity' do PtyManager. */
  handleActivity(id: string, t: IdleTransition): void {
    const p = this.pending.get(id)
    if (!p || t.state !== 'idle') return
    if (!t.firstIdle && !p.deferred) return
    if (!this.deps.isRunning(id)) {
      this.cancel(id)
      return
    }
    let screen: string
    try {
      screen = this.deps.screen(id)
    } catch {
      screen = ''
    }
    if (looksLikeConfirmationPrompt(screen)) {
      if (!p.deferred) {
        clearTimeout(p.timer)
        p.deferred = true
        p.timer = this.arm(id, this.timeouts.promptMs, 'o terminal ficou aguardando uma confirmação do usuário')
        log.info('briefing inicial adiado: o terminal aguarda uma confirmação do usuário', { id })
      }
      return
    }
    this.cancel(id)
    void this.deps.inject(id, p.text, p.opts).then(
      () => {
        log.info('briefing inicial entregue', { id, chars: p.text.length })
        p.onDelivered?.()
      },
      (err: unknown) =>
        log.warn('falha ao entregar o briefing inicial', { id, error: err instanceof Error ? err.message : String(err) })
    )
  }

  /** Cancela tudo (encerramento). */
  dispose(): void {
    for (const id of [...this.pending.keys()]) this.cancel(id)
  }

  private arm(id: string, ms: number, reason: string): ReturnType<typeof setTimeout> {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (this.pending.get(id)?.timer !== timer) return
      this.pending.delete(id)
      log.info('briefing inicial descartado', { id, reason })
    }, ms)
    timer.unref?.()
    return timer
  }
}
