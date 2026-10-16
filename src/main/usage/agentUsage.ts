import { z } from 'zod'
import type { TokenTotals } from '@shared/usage'

/**
 * Tokens por resposta, lidos dos históricos dos agentes (Claude Code: `message.usage`; Codex: eventos
 * `token_count`). Lógica pura; a leitura incremental dos arquivos fica em AgentUsageService.
 *
 * `weight` aproxima o peso de cada resposta no limite da assinatura com as proporções de preço dos
 * provedores (iguais em todos os modelos de cada um): entrada = 1; Claude: cache lido 0,1, cache
 * gravado 1,25 (5 min) ou 2 (1 h), saída 5; Codex: cache lido 0,1, saída 8. Serve para dividir o uso
 * entre agentes, não para estimar o limite em si.
 */
export interface UsageEntry {
  at: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  weight: number
}

const n = z.number().nonnegative().optional().catch(undefined)

const ClaudeAssistantSchema = z.object({
  type: z.literal('assistant'),
  timestamp: z.string().max(64),
  message: z.object({
    id: z.string().min(1).max(200),
    model: z.string().max(100).optional().catch(undefined),
    usage: z.object({
      input_tokens: n,
      output_tokens: n,
      cache_read_input_tokens: n,
      cache_creation_input_tokens: n,
      cache_creation: z.object({ ephemeral_5m_input_tokens: n, ephemeral_1h_input_tokens: n }).optional().catch(undefined)
    })
  })
})

const CodexUsageSchema = z.object({ input_tokens: n, cached_input_tokens: n, output_tokens: n, total_tokens: n })

const CodexLineSchema = z.union([
  z.object({
    timestamp: z.string().max(64),
    type: z.literal('event_msg'),
    payload: z.object({ type: z.literal('token_count'), info: z.object({ last_token_usage: CodexUsageSchema, total_token_usage: CodexUsageSchema.optional() }) })
  }),
  z.object({ type: z.literal('turn_context'), payload: z.object({ model: z.string().max(100) }) })
])

export interface ParsedUsage {
  /** Por chave (Claude: id da resposta, que se repete em várias linhas; Codex: momento + total acumulado). */
  entries: Map<string, UsageEntry>
  /** Último modelo visto. */
  model: string | null
}

/** Linhas completas de um trecho de histórico do Claude Code, acumuladas em `into`. */
export function addClaudeLines(text: string, into: ParsedUsage): void {
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      continue
    }
    const parsed = ClaudeAssistantSchema.safeParse(json)
    if (!parsed.success) continue
    const at = Date.parse(parsed.data.timestamp)
    if (!Number.isFinite(at)) continue
    const m = parsed.data.message
    const u = m.usage
    const input = u.input_tokens ?? 0
    const output = u.output_tokens ?? 0
    const cacheRead = u.cache_read_input_tokens ?? 0
    const cacheWrite = u.cache_creation_input_tokens ?? 0
    const hour = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
    const fiveMin = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : cacheWrite
    const weight = input + cacheRead * 0.1 + fiveMin * 1.25 + hour * 2 + output * 5
    into.entries.set(m.id, { at, input, output, cacheRead, cacheWrite, weight })
    if (m.model && !m.model.startsWith('<')) into.model = m.model
  }
}

/** Linhas completas de um trecho de histórico do Codex (rollout-*.jsonl), acumuladas em `into`. */
export function addCodexLines(text: string, into: ParsedUsage): void {
  for (const line of text.split('\n')) {
    const tokens = line.includes('"token_count"') && line.includes('"last_token_usage"')
    if (!tokens && !line.includes('"turn_context"')) continue
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      continue
    }
    const parsed = CodexLineSchema.safeParse(json)
    if (!parsed.success) continue
    const d = parsed.data
    if (d.type === 'turn_context') {
      into.model = d.payload.model
      continue
    }
    const at = Date.parse(d.timestamp)
    if (!Number.isFinite(at)) continue
    const u = d.payload.info.last_token_usage
    const cacheRead = u.cached_input_tokens ?? 0
    const input = Math.max(0, (u.input_tokens ?? 0) - cacheRead)
    const output = u.output_tokens ?? 0
    const total = d.payload.info.total_token_usage?.total_tokens ?? u.total_tokens ?? 0
    into.entries.set(`${d.timestamp}|${total}`, { at, input, output, cacheRead, cacheWrite: 0, weight: input + cacheRead * 0.1 + output * 8 })
  }
}

/** Soma das respostas a partir de `since` (ms). */
export function totalsSince(entries: Iterable<UsageEntry>, since: number): TokenTotals {
  const t: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, weight: 0 }
  for (const e of entries) {
    if (e.at < since) continue
    t.input += e.input
    t.output += e.output
    t.cacheRead += e.cacheRead
    t.cacheWrite += e.cacheWrite
    t.weight += e.weight
  }
  t.weight = Math.round(t.weight)
  return t
}

/** Descarta respostas anteriores a `before` (o histórico só interessa até a semana atual). */
export function pruneEntries(parsed: ParsedUsage, before: number): void {
  for (const [k, e] of parsed.entries) if (e.at < before) parsed.entries.delete(k)
}
