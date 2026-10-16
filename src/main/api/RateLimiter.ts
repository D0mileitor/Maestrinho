/**
 * Limitador de taxa por janela deslizante (lógica pura, tempo injetado para ser testável).
 *
 * Uso principal: impedir ping-pong infinito entre agentes (cada `orq send` registra um evento na
 * chave da conexão). Cada chave guarda no máximo `limit` instantes, então a memória é limitada.
 */

export interface RateLimiterOptions {
  /** Eventos permitidos por janela (padrão 30). */
  limit?: number
  /** Tamanho da janela deslizante em ms (padrão 60 s). */
  windowMs?: number
  /** Relógio (padrão Date.now). */
  now?: () => number
}

export interface RateDecision {
  allowed: boolean
  /** Quanto falta para a próxima vaga (0 quando permitido). */
  retryAfterMs: number
  /** Vagas restantes na janela depois desta decisão. */
  remaining: number
}

/** A cada quantas chamadas a `hit` as chaves vazias são descartadas. */
const SWEEP_EVERY = 256

export class RateLimiter {
  readonly limit: number
  readonly windowMs: number
  private readonly now: () => number
  private readonly events = new Map<string, number[]>()
  private hits = 0

  constructor(opts: RateLimiterOptions = {}) {
    this.limit = Math.max(1, Math.floor(opts.limit ?? 30))
    this.windowMs = Math.max(1, Math.floor(opts.windowMs ?? 60_000))
    this.now = opts.now ?? Date.now
  }

  /** Eventos ainda dentro da janela (descarta os vencidos). */
  private live(key: string, now: number): number[] {
    const list = this.events.get(key)
    if (!list) return []
    const cutoff = now - this.windowMs
    let drop = 0
    while (drop < list.length && list[drop]! <= cutoff) drop++
    if (drop > 0) list.splice(0, drop)
    if (list.length === 0) this.events.delete(key)
    return list
  }

  private decide(list: number[], now: number): RateDecision {
    if (list.length < this.limit) return { allowed: true, retryAfterMs: 0, remaining: this.limit - list.length }
    const oldest = list[0]!
    // Limitado à janela: se o relógio voltar no tempo, a espera não cresce indefinidamente.
    const retryAfterMs = Math.min(this.windowMs, Math.max(1, oldest + this.windowMs - now))
    return { allowed: false, retryAfterMs, remaining: 0 }
  }

  /** Consulta sem registrar evento. */
  check(key: string, now = this.now()): RateDecision {
    return this.decide(this.live(key, now), now)
  }

  /** Registra um evento se houver vaga. Eventos recusados não contam (quem insiste não fica preso para sempre). */
  hit(key: string, now = this.now()): RateDecision {
    if (++this.hits % SWEEP_EVERY === 0) this.sweep(now)
    const list = this.live(key, now)
    const decision = this.decide(list, now)
    if (!decision.allowed) return decision
    if (list.length === 0) this.events.set(key, [now])
    else list.push(now)
    return { ...decision, remaining: decision.remaining - 1 }
  }

  /** Esquece uma chave (ou todas). */
  reset(key?: string): void {
    if (key === undefined) this.events.clear()
    else this.events.delete(key)
  }

  /** Descarta chaves sem eventos na janela. */
  sweep(now = this.now()): void {
    for (const key of [...this.events.keys()]) this.live(key, now)
  }

  /** Número de chaves com eventos registrados (diagnóstico/testes). */
  get size(): number {
    return this.events.size
  }
}
