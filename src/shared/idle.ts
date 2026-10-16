/**
 * Detector de ociosidade (lógica pura, tempo injetado para ser testável).
 *
 * Um terminal está "ocupado" enquanto produz saída e passa a "ocioso" quando fica `idleMs` sem
 * saída depois de ter havido atividade. Padrões (regex) sobre a última linha da tela permitem
 * declarar ociosidade antes (ex.: o prompt do shell reapareceu).
 *
 * Saída que chega logo após uma tecla digitada pelo usuário (eco) ou após um redimensionamento
 * (redesenho da TUI) não conta como atividade, para não gerar falsos "terminou" — o redesenho só
 * é ignorado depois da primeira atividade do processo.
 */

export type ActivityState = 'idle' | 'busy'

export interface IdleDetectorOptions {
  idleMs: number
  /** Janela após entrada do usuário em que a saída é tratada como eco. */
  echoWindowMs?: number
  /** Janela após redimensionamento em que a saída é tratada como redesenho. */
  resizeQuietMs?: number
  /** Espera curta após um padrão casar, para a rajada de saída terminar. */
  patternGraceMs?: number
}

export interface IdleTransition {
  state: ActivityState
  at: number
  /** Duração do período ocupado que terminou (apenas em transições para idle). */
  busyMs?: number
  /** Primeira vez que o terminal fica ocioso desde o início do processo. */
  firstIdle?: boolean
  /** 'signal' = o próprio agente avisou (hook do Claude Code, notificação do Codex). */
  reason?: 'timeout' | 'pattern' | 'signal'
}

export class IdleDetector {
  private _state: ActivityState = 'idle'
  private busySince = 0
  private lastActivityAt = Number.NEGATIVE_INFINITY
  private lastUserInputAt = Number.NEGATIVE_INFINITY
  private lastResizeAt = Number.NEGATIVE_INFINITY
  private deadline: number | null = null
  private deadlineReason: 'timeout' | 'pattern' = 'timeout'
  private everIdleAfterActivity = false
  /** O próprio agente avisou que está trabalhando (hook/notificação): o silêncio não conta como "terminou". */
  private held = false
  private readonly idleMs: number
  private readonly echoWindowMs: number
  private readonly resizeQuietMs: number
  private readonly patternGraceMs: number

  constructor(opts: IdleDetectorOptions) {
    this.idleMs = Math.max(1, opts.idleMs)
    this.echoWindowMs = opts.echoWindowMs ?? 150
    this.resizeQuietMs = opts.resizeQuietMs ?? 500
    this.patternGraceMs = opts.patternGraceMs ?? 200
  }

  get state(): ActivityState {
    return this._state
  }

  /** Momento da última saída considerada atividade real. */
  get lastActivity(): number {
    return this.lastActivityAt
  }

  /** Momento da última tecla/colagem do usuário (para não intercalar mensagens do CLI com a digitação). */
  get lastUserInput(): number {
    return this.lastUserInputAt
  }

  /** Próximo instante em que `tick` deve ser chamado (ou null se nada pendente). */
  get nextDeadline(): number | null {
    return this.deadline
  }

  /** Ocupado por aviso do agente (até ele avisar que terminou ou o usuário intervir). */
  get isHeld(): boolean {
    return this.held
  }

  /**
   * O agente avisou que está trabalhando: fica ocupado mesmo em silêncio (ex.: um comando longo sem
   * saída). Devolve a transição se estava ocioso.
   */
  hold(now: number): IdleTransition | null {
    this.held = true
    this.deadline = null
    if (this._state === 'busy') return null
    this._state = 'busy'
    this.busySince = now
    this.lastActivityAt = Math.max(this.lastActivityAt, now)
    return { state: 'busy', at: now }
  }

  /**
   * Fim do aviso do agente. `idleNow`: ele terminou (ou parou para pedir algo) — fica ocioso já, com a
   * duração do trabalho até agora. `resume`: volta à detecção pelo silêncio (ex.: o usuário interrompeu).
   */
  release(now: number, mode: 'idleNow' | 'resume'): IdleTransition | null {
    const wasHeld = this.held
    this.held = false
    if (this._state !== 'busy') return null
    if (mode === 'resume') {
      if (wasHeld) this.armDeadline(Math.max(now, this.lastActivityAt), false)
      return null
    }
    this._state = 'idle'
    this.deadline = null
    const firstIdle = !this.everIdleAfterActivity
    this.everIdleAfterActivity = true
    return { state: 'idle', at: now, busyMs: Math.max(0, now - this.busySince), firstIdle, reason: 'signal' }
  }

  /** Tecla/colagem feita pelo usuário pela interface (não inclui mensagens do orq). */
  onUserInput(now: number): void {
    this.lastUserInputAt = now
  }

  onResize(now: number): void {
    this.lastResizeAt = now
  }

  /**
   * Registra saída do processo. `patternMatched` indica que a última linha da tela casou um
   * padrão de ociosidade do preset.
   */
  onOutput(now: number, patternMatched = false): IdleTransition | null {
    const isEcho = now - this.lastUserInputAt <= this.echoWindowMs
    // Antes da primeira atividade não há redesenho a ignorar: sem isso, um terminal cuja saída inicial
    // coincide com o resize do primeiro encaixe na tela nunca ficaria "pronto" (ex.: prompt do SSH).
    const started = this.lastActivityAt !== Number.NEGATIVE_INFINITY
    const isRedraw = started && now - this.lastResizeAt <= this.resizeQuietMs
    if (isEcho || isRedraw) {
      // Não muda de estado; mas se já estava ocupado, a saída mantém o prazo vivo.
      if (this._state === 'busy' && !this.held) this.armDeadline(now, patternMatched)
      return null
    }
    this.lastActivityAt = now
    let transition: IdleTransition | null = null
    if (this._state === 'idle') {
      this._state = 'busy'
      this.busySince = now
      transition = { state: 'busy', at: now }
    }
    if (!this.held) this.armDeadline(now, patternMatched)
    return transition
  }

  /** Avalia o prazo; retorna a transição para idle se ele venceu. */
  tick(now: number): IdleTransition | null {
    if (this.held || this._state !== 'busy' || this.deadline === null || now < this.deadline) return null
    const reason = this.deadlineReason
    this._state = 'idle'
    this.deadline = null
    const firstIdle = !this.everIdleAfterActivity
    this.everIdleAfterActivity = true
    return { state: 'idle', at: now, busyMs: this.lastActivityAt - this.busySince, firstIdle, reason }
  }

  /** Considera ocioso agora (ex.: processo terminou). */
  forceIdle(now: number): IdleTransition | null {
    this.held = false
    if (this._state !== 'busy') return null
    this.deadline = now
    return this.tick(now)
  }

  private armDeadline(now: number, patternMatched: boolean): void {
    if (patternMatched) {
      this.deadline = now + this.patternGraceMs
      this.deadlineReason = 'pattern'
    } else {
      this.deadline = now + this.idleMs
      this.deadlineReason = 'timeout'
    }
  }
}

/** Compila padrões de ociosidade com segurança (padrões inválidos são ignorados). */
export function compileIdlePatterns(patterns: readonly string[]): RegExp[] {
  const out: RegExp[] = []
  for (const p of patterns) {
    if (!p.trim()) continue
    try {
      out.push(new RegExp(p, 'u'))
    } catch {
      // padrão inválido: ignorado (validado também na UI)
    }
  }
  return out
}
