import { describe, expect, it } from 'vitest'
import {
  describeInterval,
  describeTrigger,
  globToRegExp,
  isDue,
  matchingFiles,
  nextRunAt,
  parseRoutineSteps,
  renderRoutineScript,
  triggerMatches,
  underHourlyCap
} from './routines'

describe('parseRoutineSteps', () => {
  it('separa passos por linhas contendo apenas &&', () => {
    const script = 'Rode os testes\n&&\nCorrija o que falhou\n  &&  \nFaça commit'
    expect(parseRoutineSteps(script)).toEqual(['Rode os testes', 'Corrija o que falhou', 'Faça commit'])
  })

  it('mantém && no meio de uma linha (não é separador)', () => {
    expect(parseRoutineSteps('npm test && npm run lint')).toEqual(['npm test && npm run lint'])
  })

  it('preserva várias linhas dentro de um passo e aceita CRLF', () => {
    expect(parseRoutineSteps('linha 1\r\nlinha 2\r\n&&\r\nfim')).toEqual(['linha 1\nlinha 2', 'fim'])
  })

  it('ignora passos vazios e separadores repetidos', () => {
    expect(parseRoutineSteps('&&\n\n&&\nA\n&&\n&&\n')).toEqual(['A'])
    expect(parseRoutineSteps('   ')).toEqual([])
  })
})

describe('agenda', () => {
  const createdAt = '2026-09-30T10:00:00.000Z'
  it('primeiro disparo é um intervalo após a criação', () => {
    expect(nextRunAt({ intervalMinutes: 10, createdAt })).toBe(Date.parse(createdAt) + 600_000)
  })
  it('depois de rodar, conta a partir do último disparo', () => {
    const lastRunAt = '2026-09-30T10:25:00.000Z'
    expect(nextRunAt({ intervalMinutes: 10, createdAt, lastRunAt })).toBe(Date.parse(lastRunAt) + 600_000)
  })
  it('isDue respeita enabled e o horário', () => {
    const base = { intervalMinutes: 10, createdAt, enabled: true }
    expect(isDue(base, Date.parse(createdAt) + 599_999)).toBe(false)
    expect(isDue(base, Date.parse(createdAt) + 600_000)).toBe(true)
    expect(isDue({ ...base, enabled: false }, Date.parse(createdAt) + 9e9)).toBe(false)
  })
  it('descreve intervalos em português', () => {
    expect(describeInterval(10)).toBe('a cada 10 minutos')
    expect(describeInterval(1)).toBe('a cada minuto')
    expect(describeInterval(60)).toBe('a cada hora')
    expect(describeInterval(180)).toBe('a cada 3 horas')
    expect(describeInterval(1440)).toBe('todo dia')
  })
})

describe('gatilhos por evento', () => {
  it('rotina com gatilho de evento não dispara pelo relógio', () => {
    const base = { intervalMinutes: 1, createdAt: '2020-01-01T00:00:00Z', enabled: true }
    expect(isDue({ ...base, trigger: { kind: 'interval' } }, Date.now())).toBe(true)
    expect(isDue({ ...base, trigger: { kind: 'agentDone', sourceId: 't1' } }, Date.now())).toBe(false)
  })

  it('glob: **, *, ?, {a,b}; sem "/" vale em qualquer pasta', () => {
    expect(globToRegExp('src/**/*.ts').test('src/a/b/c.ts')).toBe(true)
    expect(globToRegExp('src/**/*.ts').test('src/c.ts')).toBe(true)
    expect(globToRegExp('src/**/*.ts').test('lib/c.ts')).toBe(false)
    expect(globToRegExp('*.{ts,tsx}').test('a/b/Comp.tsx')).toBe(true)
    expect(globToRegExp('*.{ts,tsx}').test('a/b/Comp.css')).toBe(false)
    expect(globToRegExp('docs/?.md').test('docs/a.md')).toBe(true)
    expect(globToRegExp('docs/?.md').test('docs/ab.md')).toBe(false)
    expect(globToRegExp('a+b(1).txt').test('a+b(1).txt')).toBe(true)
    expect(globToRegExp('SRC/*.ts', true).test('src/x.ts')).toBe(true)
    expect(globToRegExp('SRC/*.ts').test('src/x.ts')).toBe(false)
    expect(matchingFiles(['src/a.ts', 'README.md', 'tests/b.test.ts'], 'src/**, *.md')).toEqual(['src/a.ts', 'README.md'])
  })

  it('evento casa com o gatilho certo', () => {
    expect(triggerMatches({ kind: 'agentDone', sourceId: 't1' }, { kind: 'agentDone', terminalId: 't1' })).toBe(true)
    expect(triggerMatches({ kind: 'agentDone', sourceId: 't1' }, { kind: 'agentDone', terminalId: 't2' })).toBe(false)
    const msg = { kind: 'message' as const, fromId: 'rev', toId: 'con', mood: 'complaint' as const }
    expect(triggerMatches({ kind: 'message', fromId: 'rev', mood: 'complaint' }, msg)).toBe(true)
    expect(triggerMatches({ kind: 'message', fromId: 'rev', mood: 'praise' }, msg)).toBe(false)
    expect(triggerMatches({ kind: 'message', toId: 'tes', mood: 'any' }, msg)).toBe(false)
    expect(triggerMatches({ kind: 'message', mood: 'any' }, { ...msg, mood: null })).toBe(true)
    expect(triggerMatches({ kind: 'boardColumn', column: 'qa' }, { kind: 'boardColumn', column: 'qa' })).toBe(true)
    expect(triggerMatches({ kind: 'fileChange', pattern: '*.ts' }, { kind: 'fileChange', files: ['a/b.ts'] })).toBe(true)
    expect(triggerMatches({ kind: 'fileChange', pattern: '*.ts' }, { kind: 'fileChange', files: ['a/b.md'] })).toBe(false)
    expect(triggerMatches({ kind: 'interval' }, { kind: 'agentDone', terminalId: 't1' })).toBe(false)
  })

  it('variáveis no texto e teto por hora', () => {
    expect(renderRoutineScript('{origem} terminou; revise {arquivos} {desconhecida}', { origem: 'construtor', arquivos: 'a.ts' })).toBe(
      'construtor terminou; revise a.ts {desconhecida}'
    )
    const fired = [0, 1_000, 3_600_500]
    expect(underHourlyCap(fired, 2, 3_601_000)).toBe(true)
    expect(fired).toEqual([3_600_500])
    expect(underHourlyCap([1, 2], 2, 10)).toBe(false)
  })

  it('descrição em pt-BR', () => {
    const name = (id: string) => ({ rev: 'revisor', con: 'construtor' })[id] ?? id
    const d = (trigger: Parameters<typeof describeTrigger>[0]['trigger']) => describeTrigger({ intervalMinutes: 30, trigger }, name, () => 'QA')
    expect(d(undefined)).toBe('a cada 30 minutos')
    expect(d({ kind: 'agentDone', sourceId: 'con' })).toBe('quando construtor terminar')
    expect(d({ kind: 'message', fromId: 'rev', toId: 'con', mood: 'complaint' })).toBe('quando revisor mandar uma reprovação para construtor')
    expect(d({ kind: 'message', mood: 'any' })).toBe('quando um agente mandar mensagem')
    expect(d({ kind: 'boardColumn', column: 'qa' })).toBe('quando um cartão entrar em "QA"')
    expect(d({ kind: 'fileChange', pattern: 'src/**' })).toBe('quando mudar src/**')
  })
})
