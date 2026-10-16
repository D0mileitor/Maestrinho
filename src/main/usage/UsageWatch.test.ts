import { describe, expect, it } from 'vitest'
import type { UsagePause, UsageReport } from '@shared/usage'
import { UsageWatch } from './UsageWatch'

const report = (session: number, resetsAt: number | null = 10_000_000): UsageReport => ({
  providers: [{ provider: 'claude', plan: null, updatedAt: 0, windows: [{ kind: 'session', windowMinutes: 300, scope: null, usedPercent: session, resetsAt }] }]
})

function setup(settings = { usageAlertPercent: 80, usagePausePercent: 95 }) {
  let current = report(10)
  const notes: string[] = []
  const pauses: (UsagePause | null)[] = []
  const watch = new UsageWatch({
    read: async () => current,
    settings: () => settings,
    notify: (title) => notes.push(title),
    onPauseChanged: (p) => pauses.push(p)
  })
  return { watch, notes, pauses, set: (r: UsageReport) => (current = r) }
}

describe('vigia do uso da assinatura', () => {
  it('avisa uma vez ao passar do limite e de novo na janela seguinte', async () => {
    const s = setup()
    await s.watch.check(0)
    expect(s.notes).toEqual([])
    s.set(report(82))
    await s.watch.check(0)
    await s.watch.check(0)
    expect(s.notes).toEqual(['Claude: 82% da sessão de 5 h'])
    s.set(report(85, 20_000_000))
    await s.watch.check(0)
    expect(s.notes).toHaveLength(2)
  })

  it('pausa acima do limite de pausa e retoma quando a janela reinicia', async () => {
    const s = setup()
    s.set(report(96, 5_000))
    await s.watch.check(0)
    expect(s.watch.paused()).toMatchObject({ provider: 'claude', kind: 'session', percent: 96, until: 5_000 })
    expect(s.notes).toContain('Rotinas e gatilhos pausados')
    await s.watch.check(1_000)
    expect(s.pauses).toHaveLength(1)
    // Passou do horário de reinício: a leitura antiga vale 0%.
    await s.watch.check(6_000)
    expect(s.watch.paused()).toBeNull()
    expect(s.notes).toContain('Rotinas e gatilhos retomados')
    expect(s.pauses).toEqual([expect.objectContaining({ percent: 96 }), null])
    // Retomou uma vez só: as leituras seguintes, ainda abaixo do limite, não repetem.
    await s.watch.check(7_000)
    await s.watch.check(8_000)
    expect(s.pauses).toHaveLength(2)
  })

  it('uso normal em várias leituras: não registra pausa nem retomada', async () => {
    const s = setup()
    for (let i = 0; i < 5; i++) await s.watch.check(i * 1_000)
    expect(s.pauses).toEqual([])
    expect(s.notes).toEqual([])
  })

  it('tudo desligado (0): não lê nada, não avisa e não pausa', async () => {
    const s = setup({ usageAlertPercent: 0, usagePausePercent: 0 })
    s.set(report(99))
    await s.watch.check(0)
    expect(s.notes).toEqual([])
    expect(s.watch.paused()).toBeNull()
    expect(s.pauses).toEqual([])
  })
})
