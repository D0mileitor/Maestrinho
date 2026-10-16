/**
 * Linha do tempo do que aconteceu nos workspaces (só metadados: quem, o quê, quando; nunca o texto de
 * mensagens ou da saída dos terminais).
 */

export type ActivityKind = 'done' | 'waiting' | 'message' | 'board' | 'routine' | 'exited' | 'limit' | 'newTask'

export interface ActivityEvent {
  /** Sequencial (ordem de chegada). */
  id: number
  at: number
  /** Workspace ('' = do app inteiro, ex.: pausa por limite). */
  dir: string
  kind: ActivityKind
  terminalId?: string
  /** Quem fez: nome do agente, da rotina... */
  who: string
  /** Mensagem: para quem. */
  to?: string
  /** Mensagem: tom detectado. */
  mood?: 'complaint' | 'praise' | null
  /** Complemento curto sem conteúdo de conversa (ex.: "#3 Validar CPF → QA", resultado da rotina). */
  detail?: string
}

/** Quanto tempo sem usar o app conta como "estava fora". */
export const AWAY_MS = 10 * 60_000

export interface AwaySummary {
  minutes: number
  done: { who: string; count: number }[]
  /** Pedidos de aprovação/pergunta ainda relevantes (o último evento do agente é "waiting"). */
  waiting: string[]
  messages: number
  complaints: number
  praises: number
  board: string[]
  routines: number
  exited: string[]
  limit: string[]
  total: number
}

/** Resume os eventos desde `since` (o momento em que você saiu). */
export function summarizeAway(events: ActivityEvent[], since: number, now: number): AwaySummary {
  const recent = events.filter((e) => e.at >= since)
  const done = new Map<string, number>()
  const lastByAgent = new Map<string, ActivityEvent>()
  const out: AwaySummary = {
    minutes: Math.max(1, Math.round((now - since) / 60_000)),
    done: [],
    waiting: [],
    messages: 0,
    complaints: 0,
    praises: 0,
    board: [],
    routines: 0,
    exited: [],
    limit: [],
    total: recent.length
  }
  for (const e of recent) {
    if (e.terminalId && (e.kind === 'done' || e.kind === 'waiting')) lastByAgent.set(e.terminalId, e)
    switch (e.kind) {
      case 'done':
        done.set(e.who, (done.get(e.who) ?? 0) + 1)
        break
      case 'message':
        out.messages++
        if (e.mood === 'complaint') out.complaints++
        if (e.mood === 'praise') out.praises++
        break
      case 'board':
        if (e.detail) out.board.push(e.detail)
        break
      case 'routine':
        out.routines++
        break
      case 'exited':
        out.exited.push(e.who)
        break
      case 'limit':
        // a mesma situação repetida em seguida (ex.: várias leituras do uso) entra uma vez só
        if (e.detail && out.limit[out.limit.length - 1] !== e.detail) out.limit.push(e.detail)
        break
    }
  }
  out.done = [...done.entries()].map(([who, count]) => ({ who, count })).sort((a, b) => b.count - a.count || a.who.localeCompare(b.who))
  out.waiting = [...lastByAgent.values()].filter((e) => e.kind === 'waiting').map((e) => e.who)
  return out
}
