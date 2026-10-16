import type { AgentPreset, Role, TerminalNodeData } from './schemas'

/**
 * Modelo, esforço e nome da sessão dos agentes (lógica pura). Cada terminal pode escolher o modelo e o
 * esforço; sem escolha, vale o padrão da função (papel) para aquele tipo de agente; sem padrão, o do
 * próprio agente. O nome da sessão segue "{projeto}/{agente}" (aparece no app do celular e no /resume).
 */

export type AgentFamily = 'claude' | 'codex'

/** Tipo do agente de um preset (para saber quais modelos e esforços valem). */
export function agentFamily(preset: Pick<AgentPreset, 'agentEvents' | 'sessionStore' | 'command'>): AgentFamily | null {
  if (preset.agentEvents === 'claude' || preset.agentEvents === 'codex') return preset.agentEvents
  if (preset.sessionStore === 'claude' || preset.sessionStore === 'codex') return preset.sessionStore
  const base = preset.command.replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')
  return base === 'claude' || base === 'codex' ? base : null
}

/** Esforços aceitos por tipo de agente, do menor para o maior. */
export const EFFORTS: Record<AgentFamily, readonly string[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
}

/** Modelos sugeridos do Claude Code (apelidos que sempre apontam para a versão mais nova). */
export const CLAUDE_MODELS: readonly string[] = ['fable', 'opus', 'sonnet', 'haiku']

/** Nome de modelo seguro para virar argumento (sem espaços nem começar com "-"). */
export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,99}$/
export const EFFORT_RE = /^[a-z]{2,16}$/

/**
 * Esforço pedido convertido para um que o agente aceita: o mesmo, ou o mais próximo na escala (ex.:
 * "max" no Codex antigo vira "xhigh"; "minimal" no Claude vira "low").
 */
export function fitEffort(effort: string, family: AgentFamily, accepted: readonly string[] = EFFORTS[family]): string | null {
  if (accepted.includes(effort)) return effort
  const scale = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
  const want = scale.indexOf(effort)
  if (want < 0 || accepted.length === 0) return null
  let best: string | null = null
  let bestDist = Infinity
  for (const a of accepted) {
    const i = scale.indexOf(a)
    if (i < 0) continue
    const d = Math.abs(i - want)
    // Empate: fica com o menor (não gastar mais do que o pedido).
    if (d < bestDist || (d === bestDist && best !== null && i < scale.indexOf(best))) {
      best = a
      bestDist = d
    }
  }
  return best
}

/** Modelo e esforço que valem para o terminal: escolha dele > padrão da função > nada (padrão do agente). */
export function effectiveModelEffort(
  node: Pick<TerminalNodeData, 'model' | 'effort'>,
  role: Pick<Role, 'agentDefaults'> | undefined,
  family: AgentFamily | null
): { model: string | null; effort: string | null; fromRole: { model: boolean; effort: boolean } } {
  const defaults = family ? role?.agentDefaults?.[family] : undefined
  const model = node.model?.trim() || defaults?.model?.trim() || null
  const rawEffort = node.effort?.trim() || defaults?.effort?.trim() || null
  const effort = rawEffort && family ? fitEffort(rawEffort, family) : rawEffort
  return {
    model: model && MODEL_RE.test(model) ? model : null,
    effort: effort && EFFORT_RE.test(effort) ? effort : null,
    fromRole: { model: !node.model?.trim() && Boolean(defaults?.model?.trim()), effort: !node.effort?.trim() && Boolean(defaults?.effort?.trim()) }
  }
}

/** Nome da sessão: "{projeto}/{agente}" (ex.: "loja-online/dev"). */
export function sessionTitle(project: string, terminal: string): string {
  const p = project.replace(/[\x00-\x1f\x7f]+/g, ' ').trim() || 'projeto'
  return `${p}/${terminal}`.slice(0, 120)
}

/** O mesmo nome em minúsculas e hífens (prefixo dos nomes automáticos do Remote Control do Claude Code). */
export function sessionSlug(project: string, terminal: string): string {
  return (
    `${project}-${terminal}`
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'maestrinho'
  )
}

/** Troca {model}, {effort}, {title} e {titleSlug} nos argumentos de um preset. */
export function fillArgs(template: readonly string[] | undefined, vars: { model?: string; effort?: string; title?: string; titleSlug?: string }): string[] {
  if (!template || template.length === 0) return []
  const keys = ['model', 'effort', 'title', 'titleSlug'] as const
  // Sem o valor de algum placeholder usado, o grupo inteiro fica de fora.
  for (const k of keys) if (template.some((a) => a.includes(`{${k}}`)) && !vars[k]) return []
  return template.map((a) => a.replace(/\{(model|effort|title|titleSlug)\}/g, (_m, k: (typeof keys)[number]) => vars[k] ?? ''))
}
