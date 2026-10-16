import { describe, expect, it } from 'vitest'
import { addClaudeLines, addCodexLines, pruneEntries, totalsSince, type ParsedUsage } from './agentUsage'

const empty = (): ParsedUsage => ({ entries: new Map(), model: null })

const claude = (id: string, at: string, usage: Record<string, unknown>, model = 'claude-opus-5'): string =>
  JSON.stringify({ type: 'assistant', timestamp: at, requestId: 'r', message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'oi' }], usage } })

describe('tokens do Claude Code por resposta', () => {
  it('a mesma resposta em várias linhas conta uma vez; pesos por tipo de token', () => {
    const u = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 } }
    const p = empty()
    addClaudeLines([claude('msg_1', '2026-10-10T10:00:00Z', u), claude('msg_1', '2026-10-10T10:00:01Z', u), claude('msg_2', '2026-10-10T11:00:00Z', { input_tokens: 5, output_tokens: 1 }, 'claude-sonnet-5')].join('\n'), p)
    expect(p.entries.size).toBe(2)
    expect(p.model).toBe('claude-sonnet-5')
    // msg_1: 10 + 1000*0,1 + 200*2 (cache de 1 h) + 100*5 = 1010; msg_2: 5 + 1*5 = 10
    expect(totalsSince(p.entries.values(), 0)).toEqual({ input: 15, output: 101, cacheRead: 1000, cacheWrite: 200, weight: 1020 })
    expect(totalsSince(p.entries.values(), Date.parse('2026-10-10T10:30:00Z')).weight).toBe(10)
  })

  it('sem detalhe do cache, a gravação vale 1,25; linhas de usuário, cortadas ou estranhas são ignoradas', () => {
    const p = empty()
    addClaudeLines(
      [
        '{"type":"assistant","message":{"usage":', // cortada
        JSON.stringify({ type: 'user', timestamp: '2026-10-10T10:00:00Z', message: { content: 'usage assistant' } }),
        claude('msg_3', 'ontem', { output_tokens: 9 }),
        claude('msg_4', '2026-10-10T10:00:00Z', { cache_creation_input_tokens: 100 }, '<synthetic>')
      ].join('\n'),
      p
    )
    expect([...p.entries.keys()]).toEqual(['msg_4'])
    expect(p.entries.get('msg_4')?.weight).toBe(125)
    expect(p.model).toBeNull()
  })
})

describe('tokens do Codex por resposta', () => {
  const tokenCount = (at: string, last: Record<string, number>, total: number): string =>
    JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: last, total_token_usage: { total_tokens: total } }, rate_limits: null } })

  it('entrada sem a parte em cache; saída pesa 8; modelo vem do turn_context; evento repetido conta uma vez', () => {
    const p = empty()
    const ev = tokenCount('2026-10-10T10:00:00Z', { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 }, 1050)
    addCodexLines(
      [
        JSON.stringify({ timestamp: '2026-10-10T09:59:00Z', type: 'turn_context', payload: { cwd: 'C:/x', model: 'gpt-5-codex' } }),
        ev,
        ev,
        JSON.stringify({ timestamp: '2026-10-10T10:00:01Z', type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: {} } })
      ].join('\n'),
      p
    )
    expect(p.model).toBe('gpt-5-codex')
    expect(totalsSince(p.entries.values(), 0)).toEqual({ input: 200, output: 50, cacheRead: 800, cacheWrite: 0, weight: 680 })
  })

  it('descarta respostas antigas', () => {
    const p = empty()
    addCodexLines(tokenCount('2026-10-01T10:00:00Z', { input_tokens: 1, output_tokens: 1 }, 2) + '\n' + tokenCount('2026-10-10T10:00:00Z', { input_tokens: 1, output_tokens: 1 }, 4), p)
    pruneEntries(p, Date.parse('2026-10-05T00:00:00Z'))
    expect(p.entries.size).toBe(1)
  })
})
