import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readSubscriptionUsage } from './subscriptionUsage'

const tokenCount = (timestamp: string, used: number): string =>
  JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: { type: 'token_count', rate_limits: { primary: { used_percent: used, window_minutes: 300, resets_at: 1_760_000_000 }, secondary: null } }
  })

describe('leitura do uso da assinatura no disco', () => {
  const dirs: string[] = []
  const tmp = (prefix: string): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    dirs.push(d)
    return d
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  it('sem arquivos dos agentes, não há provedores', async () => {
    expect(await readSubscriptionUsage({ CLAUDE_CONFIG_DIR: tmp('claude-'), CODEX_HOME: tmp('codex-') })).toEqual({ providers: [] })
  })

  it('lê o cache do Claude e o histórico mais recente do Codex (inclusive retomado em pasta de dia antiga)', async () => {
    const claude = tmp('claude-')
    const codex = tmp('codex-')
    fs.writeFileSync(
      path.join(claude, '.claude.json'),
      JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: 10, utilization: { five_hour: { utilization: 44, resets_at: null } } } })
    )
    const day = (d: string): string => {
      const dir = path.join(codex, 'sessions', '2026', '10', d)
      fs.mkdirSync(dir, { recursive: true })
      return dir
    }
    // Arquivo do dia 02, retomado depois: modificado por último, mesmo estando numa pasta antiga.
    const retomado = path.join(day('02'), 'rollout-2026-10-02T08-00-00-aaaa.jsonl')
    const recente = path.join(day('10'), 'rollout-2026-10-10T08-00-00-bbbb.jsonl')
    fs.writeFileSync(recente, tokenCount('2026-10-10T08:00:00.000Z', 20) + '\n')
    // Muita coisa antes do evento: só o fim do arquivo é lido.
    fs.writeFileSync(retomado, 'x'.repeat(600 * 1024) + '\n' + tokenCount('2026-10-10T09:00:00.000Z', 70) + '\n')
    fs.utimesSync(recente, new Date('2026-10-10T08:00:00Z'), new Date('2026-10-10T08:00:00Z'))
    fs.utimesSync(retomado, new Date('2026-10-10T09:00:00Z'), new Date('2026-10-10T09:00:00Z'))

    const report = await readSubscriptionUsage({ CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex })
    expect(report.providers.map((p) => [p.provider, p.windows[0]?.usedPercent])).toEqual([
      ['claude', 44],
      ['codex', 70]
    ])
  })

  it('JSON do Claude no meio de uma escrita mantém a última leitura boa', async () => {
    const claude = tmp('claude-')
    const file = path.join(claude, '.claude.json')
    fs.writeFileSync(file, JSON.stringify({ cachedUsageUtilization: { utilization: { five_hour: { utilization: 15 } } } }))
    const env = { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: tmp('codex-') }
    expect((await readSubscriptionUsage(env)).providers[0]?.windows[0]?.usedPercent).toBe(15)
    fs.writeFileSync(file, '{"cachedUsageUtilization": {"utiliz')
    expect((await readSubscriptionUsage(env)).providers[0]?.windows[0]?.usedPercent).toBe(15)
  })
})
