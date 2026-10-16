import { z } from 'zod'
import type { ProviderUsage, UsageWindow } from '@shared/usage'

/**
 * Leitores do uso da assinatura de cada provedor, a partir do que o próprio agente guarda no disco
 * (sem rede, sem tocar em tokens). Lógica pura: quem lê os arquivos é subscriptionUsage.ts.
 *
 * Os formatos são internos dos agentes e podem mudar: os schemas são tolerantes (campo inválido vira
 * ausente) e, se nada fizer sentido, o provedor simplesmente não aparece.
 */

const SESSION_MINUTES = 300
const WEEK_MINUTES = 7 * 24 * 60

/** Data ISO (aceita microssegundos, como "2026-10-14T18:00:00.429778+00:00") em ms; null se inválida. */
export function parseIsoTime(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value.replace(/(\.\d{3})\d+/, '$1'))
  return Number.isFinite(ms) ? ms : null
}

// ---------------------------------------------------------------- Claude Code

const ClaudeWindowSchema = z
  .object({ utilization: z.number().nullable().optional(), resets_at: z.string().max(64).nullable().optional() })
  .nullable()
  .optional()
  .catch(null)

const ClaudeLimitSchema = z.object({
  kind: z.string().max(64),
  group: z.string().max(64).nullable().optional(),
  percent: z.number().nullable().optional(),
  resets_at: z.string().max(64).nullable().optional(),
  scope: z
    .object({ model: z.object({ display_name: z.string().max(100).nullable().optional() }).nullable().optional() })
    .nullable()
    .optional()
})

/** Trecho do ~/.claude.json usado aqui: o cache de uso que o Claude Code mantém (o mesmo do /usage). */
const ClaudeConfigSchema = z.object({
  cachedUsageUtilization: z
    .object({
      fetchedAtMs: z.number().optional().catch(undefined),
      utilization: z.object({
        five_hour: ClaudeWindowSchema,
        seven_day: ClaudeWindowSchema,
        seven_day_opus: ClaudeWindowSchema,
        seven_day_sonnet: ClaudeWindowSchema,
        limits: z.array(ClaudeLimitSchema).max(50).optional().catch(undefined)
      })
    })
    .optional()
    .catch(undefined),
  oauthAccount: z
    .object({ userRateLimitTier: z.string().max(100).nullable().optional() })
    .nullable()
    .optional()
    .catch(undefined)
})

/** "default_claude_max_5x" → "Max 5x"; null quando o nível não é reconhecido. */
export function claudePlan(tier: string | null | undefined): string | null {
  if (!tier) return null
  const max = /max_(\d+)x/i.exec(tier)
  if (max) return `Max ${max[1]}x`
  if (/(^|_)pro($|_)/i.test(tier)) return 'Pro'
  if (/team/i.test(tier)) return 'Team'
  if (/enterprise/i.test(tier)) return 'Enterprise'
  return null
}

const KIND_ORDER: Record<UsageWindow['kind'], number> = { session: 0, weekly: 1, other: 2 }

function sortWindows(windows: UsageWindow[]): UsageWindow[] {
  return windows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Number(a.scope !== null) - Number(b.scope !== null))
}

/** Uso da assinatura do Claude a partir do conteúdo (já com JSON.parse) do ~/.claude.json. */
export function claudeUsageFromConfig(raw: unknown): ProviderUsage | null {
  const parsed = ClaudeConfigSchema.safeParse(raw)
  const cache = parsed.success ? parsed.data.cachedUsageUtilization : undefined
  if (!cache) return null
  const u = cache.utilization
  const windows: UsageWindow[] = []
  if (u.limits?.length) {
    for (const l of u.limits) {
      const usedPercent = l.percent ?? 0
      const resetsAt = parseIsoTime(l.resets_at)
      const model = l.scope?.model?.display_name?.trim() || null
      if (l.kind === 'session') windows.push({ kind: 'session', windowMinutes: SESSION_MINUTES, scope: null, usedPercent, resetsAt })
      else if (l.kind === 'weekly_all') windows.push({ kind: 'weekly', windowMinutes: WEEK_MINUTES, scope: null, usedPercent, resetsAt })
      else if (l.group === 'weekly' && model) windows.push({ kind: 'weekly', windowMinutes: WEEK_MINUTES, scope: model, usedPercent, resetsAt })
      else if (usedPercent > 0) windows.push({ kind: 'other', windowMinutes: null, scope: model, usedPercent, resetsAt })
    }
  } else {
    // Formato anterior ao "limits": uma chave por janela.
    const add = (w: z.infer<typeof ClaudeWindowSchema>, kind: UsageWindow['kind'], minutes: number, scope: string | null): void => {
      if (w && typeof w.utilization === 'number') {
        windows.push({ kind, windowMinutes: minutes, scope, usedPercent: w.utilization, resetsAt: parseIsoTime(w.resets_at) })
      }
    }
    add(u.five_hour, 'session', SESSION_MINUTES, null)
    add(u.seven_day, 'weekly', WEEK_MINUTES, null)
    add(u.seven_day_opus, 'weekly', WEEK_MINUTES, 'Opus')
    add(u.seven_day_sonnet, 'weekly', WEEK_MINUTES, 'Sonnet')
  }
  if (windows.length === 0) return null
  const tier = parsed.success ? parsed.data.oauthAccount?.userRateLimitTier : null
  return { provider: 'claude', plan: claudePlan(tier), updatedAt: cache.fetchedAtMs ?? null, windows: sortWindows(windows) }
}

// ---------------------------------------------------------------- Codex

const CodexWindowSchema = z
  .object({
    used_percent: z.number(),
    window_minutes: z.number().nullable().optional(),
    /** Segundos desde a época (versões novas). */
    resets_at: z.number().nullable().optional(),
    /** Segundos a partir do evento (versões antigas). */
    resets_in_seconds: z.number().nullable().optional()
  })
  .nullable()
  .optional()
  .catch(null)

/** Linha do histórico do Codex (rollout-*.jsonl) com o evento de contagem de tokens e limites. */
const CodexTokenCountSchema = z.object({
  timestamp: z.string().max(64).optional(),
  type: z.literal('event_msg'),
  payload: z.object({
    type: z.literal('token_count'),
    rate_limits: z
      .object({
        limit_id: z.string().max(100).nullable().optional(),
        primary: CodexWindowSchema,
        secondary: CodexWindowSchema,
        plan_type: z.string().max(40).nullable().optional()
      })
      .nullable()
      .optional()
  })
})

type CodexLimits = NonNullable<z.infer<typeof CodexTokenCountSchema>['payload']['rate_limits']>

/** "plus" → "Plus". */
export function codexPlan(planType: string | null | undefined): string | null {
  const p = planType?.trim()
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : null
}

function codexWindow(w: z.infer<typeof CodexWindowSchema>, fallback: 'session' | 'weekly', at: number | null): UsageWindow | null {
  if (!w) return null
  const minutes = w.window_minutes ?? null
  const kind: UsageWindow['kind'] =
    minutes === null ? fallback : minutes === SESSION_MINUTES ? 'session' : minutes === WEEK_MINUTES ? 'weekly' : 'other'
  let resetsAt: number | null = null
  if (typeof w.resets_at === 'number') resetsAt = w.resets_at * 1000
  else if (typeof w.resets_in_seconds === 'number' && at !== null) resetsAt = at + w.resets_in_seconds * 1000
  return { kind, windowMinutes: minutes ?? (fallback === 'session' ? SESSION_MINUTES : WEEK_MINUTES), scope: null, usedPercent: w.used_percent, resetsAt }
}

/**
 * Último evento com limites num trecho do histórico do Codex. Prefere o limite geral (sem limit_id ou
 * "codex") a limites de apelidos de modelo. Linhas cortadas ou de outros tipos são ignoradas.
 */
export function codexLatestLimits(text: string): { at: number | null; limits: CodexLimits } | null {
  const lines = text.split('\n')
  let fallback: { at: number | null; limits: CodexLimits } | null = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (!line.includes('"rate_limits"') || !line.includes('"token_count"')) continue
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      continue
    }
    const parsed = CodexTokenCountSchema.safeParse(json)
    const limits = parsed.success ? parsed.data.payload.rate_limits : null
    if (!parsed.success || !limits || (!limits.primary && !limits.secondary)) continue
    const found = { at: parseIsoTime(parsed.data.timestamp), limits }
    if (!limits.limit_id || limits.limit_id === 'codex') return found
    fallback ??= found
  }
  return fallback
}

/** Uso da assinatura do Codex a partir dos trechos finais dos históricos mais recentes. */
export function codexUsageFromTails(tails: string[]): ProviderUsage | null {
  let best: { at: number | null; limits: CodexLimits } | null = null
  for (const text of tails) {
    const found = codexLatestLimits(text)
    if (found && (!best || (found.at ?? 0) > (best.at ?? 0))) best = found
  }
  if (!best) return null
  const windows = [codexWindow(best.limits.primary, 'session', best.at), codexWindow(best.limits.secondary, 'weekly', best.at)].filter(
    (w): w is UsageWindow => w !== null
  )
  if (windows.length === 0) return null
  return { provider: 'codex', plan: codexPlan(best.limits.plan_type), updatedAt: best.at, windows: sortWindows(windows) }
}
