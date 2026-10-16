import { describe, expect, it } from 'vitest'
import { summarizeAway, type ActivityEvent } from './activity'

let seq = 0
const ev = (at: number, e: Partial<ActivityEvent> & Pick<ActivityEvent, 'kind' | 'who'>): ActivityEvent => ({ id: ++seq, at, dir: '/ws', ...e })

describe('resumo de "enquanto você estava fora"', () => {
  it('conta por tipo, só depois de sair, e só deixa pendente quem ainda espera', () => {
    const events = [
      ev(50, { kind: 'done', who: 'antigo', terminalId: 't0' }),
      ev(100, { kind: 'done', who: 'construtor', terminalId: 't1' }),
      ev(110, { kind: 'message', who: 'revisor', to: 'construtor', mood: 'complaint' }),
      ev(120, { kind: 'waiting', who: 'construtor', terminalId: 't1' }),
      ev(130, { kind: 'done', who: 'construtor', terminalId: 't1' }),
      ev(140, { kind: 'waiting', who: 'revisor', terminalId: 't2' }),
      ev(150, { kind: 'message', who: 'revisor', to: 'testador', mood: 'praise' }),
      ev(160, { kind: 'board', who: '', detail: '#3 Validar CPF → QA' }),
      ev(170, { kind: 'routine', who: 'Testes' }),
      ev(180, { kind: 'exited', who: 'testador', terminalId: 't3' }),
      ev(190, { kind: 'limit', who: '', dir: '', detail: 'pausado: Claude em 96%' })
    ]
    const s = summarizeAway(events, 100, 100 + 42 * 60_000)
    expect(s).toEqual({
      minutes: 42,
      done: [{ who: 'construtor', count: 2 }],
      waiting: ['revisor'],
      messages: 2,
      complaints: 1,
      praises: 1,
      board: ['#3 Validar CPF → QA'],
      routines: 1,
      exited: ['testador'],
      limit: ['pausado: Claude em 96%'],
      total: 10
    })
  })

  it('pausa e retomada repetidas em seguida aparecem uma vez cada', () => {
    const events = [
      ev(100, { kind: 'limit', who: '', dir: '', detail: 'retomadas' }),
      ev(110, { kind: 'limit', who: '', dir: '', detail: 'retomadas' }),
      ev(120, { kind: 'limit', who: '', dir: '', detail: 'pausadas: Claude em 96%' }),
      ev(130, { kind: 'limit', who: '', dir: '', detail: 'retomadas' }),
      ev(140, { kind: 'limit', who: '', dir: '', detail: 'retomadas' })
    ]
    expect(summarizeAway(events, 100, 200).limit).toEqual(['retomadas', 'pausadas: Claude em 96%', 'retomadas'])
  })

  it('nada aconteceu: total zero', () => {
    expect(summarizeAway([ev(10, { kind: 'done', who: 'x' })], 100, 200).total).toBe(0)
  })
})
