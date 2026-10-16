import { describe, expect, it } from 'vitest'
import { claudePlan, claudeUsageFromConfig, codexLatestLimits, codexPlan, codexUsageFromTails, parseIsoTime } from './providers'

const RESET = '2026-10-14T18:00:00.429778+00:00'
const RESET_MS = Date.parse('2026-10-14T18:00:00.429Z')

describe('uso da assinatura do Claude (cache do ~/.claude.json)', () => {
  it('lê o formato com "limits": sessão, semana e semana por modelo', () => {
    const usage = claudeUsageFromConfig({
      projects: { 'C:/x': { history: [] } },
      oauthAccount: { userRateLimitTier: 'default_claude_max_5x' },
      cachedUsageUtilization: {
        fetchedAtMs: 1_000,
        accountUuid: 'conta',
        utilization: {
          five_hour: { utilization: 0, resets_at: null },
          seven_day: { utilization: 32, resets_at: RESET },
          limits: [
            { kind: 'weekly_scoped', group: 'weekly', percent: 5, severity: 'normal', resets_at: RESET, scope: { model: { id: null, display_name: 'Fable' } }, is_active: false },
            { kind: 'weekly_all', group: 'weekly', percent: 32, severity: 'normal', resets_at: RESET, scope: null, is_active: true },
            { kind: 'session', group: 'session', percent: 12.5, severity: 'normal', resets_at: null, scope: null, is_active: false }
          ]
        }
      }
    })
    expect(usage).toEqual({
      provider: 'claude',
      plan: 'Max 5x',
      updatedAt: 1_000,
      windows: [
        { kind: 'session', windowMinutes: 300, scope: null, usedPercent: 12.5, resetsAt: null },
        { kind: 'weekly', windowMinutes: 10080, scope: null, usedPercent: 32, resetsAt: RESET_MS },
        { kind: 'weekly', windowMinutes: 10080, scope: 'Fable', usedPercent: 5, resetsAt: RESET_MS }
      ]
    })
  })

  it('cai no formato antigo (uma chave por janela) quando não há "limits"', () => {
    const usage = claudeUsageFromConfig({
      cachedUsageUtilization: {
        fetchedAtMs: 5,
        utilization: {
          five_hour: { utilization: 40, resets_at: RESET },
          seven_day: { utilization: 10, resets_at: RESET },
          seven_day_opus: { utilization: 3, resets_at: RESET },
          seven_day_sonnet: null
        }
      }
    })
    expect(usage?.plan).toBeNull()
    expect(usage?.windows.map((w) => [w.kind, w.scope, w.usedPercent])).toEqual([
      ['session', null, 40],
      ['weekly', null, 10],
      ['weekly', 'Opus', 3]
    ])
  })

  it('campos estranhos não derrubam o resto; sem cache, o provedor não aparece', () => {
    const usage = claudeUsageFromConfig({
      oauthAccount: 'não é objeto',
      cachedUsageUtilization: { fetchedAtMs: 'ontem', utilization: { five_hour: { utilization: 7 }, limits: 'quebrado' } }
    })
    expect(usage).toEqual({ provider: 'claude', plan: null, updatedAt: null, windows: [{ kind: 'session', windowMinutes: 300, scope: null, usedPercent: 7, resetsAt: null }] })
    expect(claudeUsageFromConfig({ projects: {} })).toBeNull()
    expect(claudeUsageFromConfig(null)).toBeNull()
    expect(claudeUsageFromConfig({ cachedUsageUtilization: { utilization: { five_hour: null, limits: [] } } })).toBeNull()
  })

  it('nome do plano a partir do nível de limite', () => {
    expect(claudePlan('default_claude_max_20x')).toBe('Max 20x')
    expect(claudePlan('default_claude_pro')).toBe('Pro')
    expect(claudePlan('default_raven')).toBeNull()
    expect(claudePlan(undefined)).toBeNull()
  })
})

const tokenCount = (timestamp: string, rateLimits: unknown): string =>
  JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rateLimits } })

describe('uso da assinatura do Codex (histórico rollout-*.jsonl)', () => {
  const primary = { used_percent: 21.4, window_minutes: 300, resets_at: 1_760_000_000 }
  const secondary = { used_percent: 55, window_minutes: 10080, resets_at: 1_760_400_000 }

  it('usa o último evento com limites e ignora linhas cortadas ou de outros tipos', () => {
    const text = [
      '{"timestamp":"2026-10-10T10:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"prim', // cortada (começo do trecho)
      tokenCount('2026-10-10T10:00:00.000Z', { primary: { ...primary, used_percent: 1 }, secondary, plan_type: 'plus' }),
      tokenCount('2026-10-10T11:00:00.000Z', { primary, secondary, plan_type: 'plus' }),
      JSON.stringify({ timestamp: '2026-10-10T11:00:01.000Z', type: 'response_item', payload: { type: 'message', content: 'rate_limits token_count' } }),
      tokenCount('2026-10-10T11:00:02.000Z', null),
      ''
    ].join('\n')
    expect(codexUsageFromTails([text])).toEqual({
      provider: 'codex',
      plan: 'Plus',
      updatedAt: Date.parse('2026-10-10T11:00:00.000Z'),
      windows: [
        { kind: 'session', windowMinutes: 300, scope: null, usedPercent: 21.4, resetsAt: 1_760_000_000_000 },
        { kind: 'weekly', windowMinutes: 10080, scope: null, usedPercent: 55, resetsAt: 1_760_400_000_000 }
      ]
    })
  })

  it('versões antigas: reinício relativo ao evento (resets_in_seconds) e janelas sem duração', () => {
    const text = tokenCount('2026-10-10T12:00:00.000Z', { primary: { used_percent: 30, resets_in_seconds: 3600 }, secondary: { used_percent: 60 } })
    const usage = codexUsageFromTails([text])
    expect(usage?.windows).toEqual([
      { kind: 'session', windowMinutes: 300, scope: null, usedPercent: 30, resetsAt: Date.parse('2026-10-10T13:00:00.000Z') },
      { kind: 'weekly', windowMinutes: 10080, scope: null, usedPercent: 60, resetsAt: null }
    ])
  })

  it('prefere o limite geral ao de um apelido de modelo e o evento mais novo entre os arquivos', () => {
    const geral = tokenCount('2026-10-10T09:00:00.000Z', { limit_id: 'codex', primary })
    const apelido = tokenCount('2026-10-10T09:30:00.000Z', { limit_id: 'codex_mini', primary: { ...primary, used_percent: 99 } })
    expect(codexLatestLimits([geral, apelido].join('\n'))?.limits.limit_id).toBe('codex')
    const antigo = tokenCount('2026-10-09T09:00:00.000Z', { primary: { ...primary, used_percent: 5 } })
    const novo = tokenCount('2026-10-10T09:00:00.000Z', { primary: { ...primary, used_percent: 8 } })
    expect(codexUsageFromTails([antigo, novo, 'lixo'])?.windows[0]?.usedPercent).toBe(8)
    expect(codexUsageFromTails([novo, antigo])?.windows[0]?.usedPercent).toBe(8)
  })

  it('sem eventos de limite, o provedor não aparece', () => {
    expect(codexUsageFromTails([])).toBeNull()
    expect(codexUsageFromTails([tokenCount('2026-10-10T09:00:00.000Z', { primary: null, secondary: null })])).toBeNull()
  })

  it('nome do plano e datas com microssegundos', () => {
    expect(codexPlan('pro')).toBe('Pro')
    expect(codexPlan('')).toBeNull()
    expect(parseIsoTime(RESET)).toBe(RESET_MS)
    expect(parseIsoTime('amanhã')).toBeNull()
  })
})
