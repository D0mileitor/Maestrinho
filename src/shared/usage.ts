/**
 * Uso da assinatura dos agentes (janela de 5 horas, semana, limites por modelo), num formato comum a
 * todos os provedores. Cada provedor é lido de um jeito (ver src/main/usage/); a interface só conhece
 * este formato.
 */

/** Tipo da janela de limite: sessão (5 h), semana ou outra janela informada pelo provedor. */
export type UsageWindowKind = 'session' | 'weekly' | 'other'

export interface UsageWindow {
  kind: UsageWindowKind
  /** Duração da janela em minutos, quando o provedor informa (5 h = 300, semana = 10080). */
  windowMinutes: number | null
  /** Limite restrito a um modelo (ex.: "Opus"); null = todos os modelos. */
  scope: string | null
  /** Percentual já usado (0–100) no momento da leitura do provedor. */
  usedPercent: number
  /** Quando a janela reinicia (ms desde a época); null = janela ainda não começou ou não informado. */
  resetsAt: number | null
}

export interface ProviderUsage {
  /** Identificador do provedor ('claude', 'codex', ...). */
  provider: string
  /** Nome do plano (ex.: "Max 5x", "Plus"), quando conhecido. */
  plan: string | null
  /** Quando o provedor mediu esses números (ms desde a época); null = desconhecido. */
  updatedAt: number | null
  windows: UsageWindow[]
}

/**
 * Tokens de um agente num período. `weight` aproxima o peso no limite da assinatura: os provedores
 * cobram cache lido a ~1/10 da entrada e a saída a várias vezes a entrada (ver main/usage/agentUsage.ts).
 */
export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  weight: number
}

/** Uso de um terminal de agente (Claude Code ou Codex) nas janelas atuais do provedor. */
export interface AgentUsage {
  terminalId: string
  name: string
  /** Nome do workspace do terminal. */
  workspace: string
  provider: 'claude' | 'codex'
  /** Último modelo visto no histórico. */
  model: string | null
  /** Na janela de 5 h atual (ou nas últimas 5 h, se o provedor não informou). */
  session: TokenTotals
  /** Na semana atual (ou nos últimos 7 dias). */
  week: TokenTotals
}

/** Rotinas e gatilhos pausados porque uma janela passou do limite escolhido nas Configurações. */
export interface UsagePause {
  provider: string
  kind: UsageWindowKind
  scope: string | null
  percent: number
  /** Quando a janela reinicia e tudo volta (null = desconhecido). */
  until: number | null
}

export interface UsageReport {
  /** Só os provedores com dados encontrados neste computador. */
  providers: ProviderUsage[]
  /** Uso por agente (só quando pedido: o painel aberto). */
  agents?: AgentUsage[]
  pause?: UsagePause | null
}

/** Janela que merece aviso: chave única por janela/reinício, para avisar só uma vez. */
export interface UsageAlert {
  key: string
  provider: string
  window: UsageWindow
  percent: number
}

/** Janelas que estão em `threshold`% ou mais agora (0 = avisos desligados). */
export function usageAlerts(report: UsageReport, threshold: number, now: number): UsageAlert[] {
  if (!(threshold > 0)) return []
  const out: UsageAlert[] = []
  for (const p of report.providers) {
    for (const w of p.windows) {
      const percent = currentPercent(w, now)
      if (percent < threshold) continue
      out.push({ key: `${p.provider}:${w.kind}:${w.scope ?? ''}:${w.resetsAt ?? 'sem-reinicio'}`, provider: p.provider, window: w, percent })
    }
  }
  return out
}

/** Primeira janela em `threshold`% ou mais (maior uso primeiro): motivo para pausar rotinas e gatilhos. */
export function usagePauseFor(report: UsageReport, threshold: number, now: number): UsagePause | null {
  const hit = usageAlerts(report, threshold, now).sort((a, b) => b.percent - a.percent)[0]
  if (!hit) return null
  return { provider: hit.provider, kind: hit.window.kind, scope: hit.window.scope, percent: hit.percent, until: hit.window.resetsAt }
}

/** Início da janela atual do provedor (reinício − duração); sem esse dado, as últimas 5 h ou 7 dias. */
export function windowStart(p: ProviderUsage | undefined, kind: 'session' | 'weekly', now: number): number {
  const minutes = kind === 'session' ? 300 : 7 * 24 * 60
  const w = p?.windows.find((x) => x.kind === kind && x.scope === null)
  if (w?.resetsAt && w.resetsAt > now) return w.resetsAt - (w.windowMinutes ?? minutes) * 60_000
  return now - minutes * 60_000
}

/** Fatia (0–100) de cada agente no peso total dos agentes do mesmo provedor no período. */
export function agentShares(agents: AgentUsage[], period: 'session' | 'week'): Map<string, number> {
  const totals = new Map<string, number>()
  for (const a of agents) totals.set(a.provider, (totals.get(a.provider) ?? 0) + a[period].weight)
  const out = new Map<string, number>()
  for (const a of agents) {
    const total = totals.get(a.provider) ?? 0
    out.set(a.terminalId, total > 0 ? (a[period].weight / total) * 100 : 0)
  }
  return out
}

export type UsageSeverity = 'normal' | 'warning' | 'critical'

/** Percentual que vale agora: uma janela que já reiniciou depois da leitura volta a zero. */
export function currentPercent(w: UsageWindow, now: number): number {
  if (w.resetsAt !== null && w.resetsAt <= now) return 0
  return Math.min(100, Math.max(0, w.usedPercent))
}

export function usageSeverity(percent: number): UsageSeverity {
  if (percent >= 90) return 'critical'
  if (percent >= 75) return 'warning'
  return 'normal'
}

/** Maior percentual atual entre todas as janelas de todos os provedores (null = sem dados). */
export function peakPercent(report: UsageReport, now: number): number | null {
  let peak: number | null = null
  for (const p of report.providers) for (const w of p.windows) peak = Math.max(peak ?? 0, currentPercent(w, now))
  return peak
}

/** Quebra uma duração (ms) em dias, horas e minutos, arredondando os minutos para cima. */
export function splitDuration(ms: number): { days: number; hours: number; minutes: number } {
  const total = Math.max(0, Math.ceil(ms / 60_000))
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 }
}
