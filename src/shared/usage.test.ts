import { describe, expect, it } from 'vitest'
import { agentShares, currentPercent, peakPercent, splitDuration, usageAlerts, usagePauseFor, usageSeverity, windowStart, type UsageWindow } from './usage'

const win = (usedPercent: number, resetsAt: number | null): UsageWindow => ({ kind: 'weekly', windowMinutes: 10080, scope: null, usedPercent, resetsAt })

describe('uso da assinatura', () => {
  it('janela que já reiniciou depois da leitura volta a zero; percentual fica entre 0 e 100', () => {
    expect(currentPercent(win(40, 2_000), 1_000)).toBe(40)
    expect(currentPercent(win(40, 2_000), 2_000)).toBe(0)
    expect(currentPercent(win(40, null), 9_999)).toBe(40)
    expect(currentPercent(win(130, null), 0)).toBe(100)
    expect(currentPercent(win(-3, null), 0)).toBe(0)
  })

  it('gravidade por faixa', () => {
    expect(usageSeverity(74.9)).toBe('normal')
    expect(usageSeverity(75)).toBe('warning')
    expect(usageSeverity(90)).toBe('critical')
  })

  it('pico entre todos os provedores', () => {
    expect(peakPercent({ providers: [] }, 0)).toBeNull()
    const report = {
      providers: [
        { provider: 'claude', plan: null, updatedAt: null, windows: [win(10, null), win(95, 500)] },
        { provider: 'codex', plan: null, updatedAt: null, windows: [win(60, null)] }
      ]
    }
    expect(peakPercent(report, 0)).toBe(95)
    expect(peakPercent(report, 600)).toBe(60)
  })

  it('alertas, motivo de pausa, início da janela e fatia de cada agente', () => {
    const report = {
      providers: [
        { provider: 'claude', plan: null, updatedAt: null, windows: [{ ...win(81, 9_000_000), kind: 'session' as const, windowMinutes: 300 }, win(96, 20_000_000)] }
      ]
    }
    expect(usageAlerts(report, 80, 0).map((a) => a.key)).toEqual(['claude:session::9000000', 'claude:weekly::20000000'])
    expect(usageAlerts(report, 0, 0)).toEqual([])
    expect(usagePauseFor(report, 95, 0)).toEqual({ provider: 'claude', kind: 'weekly', scope: null, percent: 96, until: 20_000_000 })
    expect(usagePauseFor(report, 97, 0)).toBeNull()
    expect(windowStart(report.providers[0], 'session', 0)).toBe(9_000_000 - 300 * 60_000)
    expect(windowStart(undefined, 'session', 1_000_000_000)).toBe(1_000_000_000 - 300 * 60_000)
    const t = (weight: number) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, weight })
    const agent = (id: string, provider: 'claude' | 'codex', w: number) => ({ terminalId: id, name: id, workspace: 'ws', provider, model: null, session: t(w), week: t(w) })
    const shares = agentShares([agent('a', 'claude', 30), agent('b', 'claude', 10), agent('c', 'codex', 5), agent('d', 'codex', 0)], 'session')
    expect(Object.fromEntries(shares)).toEqual({ a: 75, b: 25, c: 100, d: 0 })
  })

  it('duração em dias, horas e minutos (minutos arredondados para cima)', () => {
    expect(splitDuration(0)).toEqual({ days: 0, hours: 0, minutes: 0 })
    expect(splitDuration(61_000)).toEqual({ days: 0, hours: 0, minutes: 2 })
    expect(splitDuration((2 * 1440 + 3 * 60 + 5) * 60_000)).toEqual({ days: 2, hours: 3, minutes: 5 })
    expect(splitDuration(-5)).toEqual({ days: 0, hours: 0, minutes: 0 })
  })
})
