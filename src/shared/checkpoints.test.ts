import { describe, expect, it } from 'vitest'
import { checkpointPlan, checkpointRef, checkpointsToPrune, checkpointSubject, parseCheckpoints, SAFETY_TERMINAL } from './checkpoints'

describe('checkpoints', () => {
  it('referência ordenável pelo instante e lista do mais novo para o mais antigo', () => {
    const a = checkpointRef(1_700_000_000_000, 't1')
    const b = checkpointRef(1_700_000_100_000, 'term_2')
    const s = checkpointRef(1_700_000_200_000, SAFETY_TERMINAL)
    expect(a).toBe('refs/maestrinho/checkpoints/1700000000000-t1')
    const out = [
      `${a}\0${checkpointSubject('construtor', false)}`,
      `${s}\0${checkpointSubject('', true)}`,
      `${b}\0${checkpointSubject('revisor', false)}\r`,
      'refs/maestrinho/checkpoints/lixo\0x',
      'refs/heads/main\0commit qualquer',
      ''
    ].join('\n')
    expect(parseCheckpoints(out)).toEqual([
      { id: s, at: 1_700_000_200_000, terminalId: SAFETY_TERMINAL, name: '', safety: true },
      { id: b, at: 1_700_000_100_000, terminalId: 'term_2', name: 'revisor', safety: false },
      { id: a, at: 1_700_000_000_000, terminalId: 't1', name: 'construtor', safety: false }
    ])
  })

  it('apaga os que passam do limite ou da idade', () => {
    const list = [1, 2, 3, 4].map((i) => ({ id: `r${i}`, at: i * 1000, terminalId: 't', name: 't', safety: false }))
    expect(checkpointsToPrune(list, 2, 1e9, 5000)).toEqual(['r2', 'r1'])
    expect(checkpointsToPrune(list, 10, 2500, 5000)).toEqual(['r2', 'r1'])
    expect(checkpointsToPrune(list, 10, 1e9, 5000)).toEqual([])
  })

  it('plano: criados depois saem, modificados/apagados voltam, arquivos do app ficam', () => {
    const z = ['A', 'novo.ts', 'M', 'src/a.ts', 'D', 'apagado.md', 'T', 'link', 'A', '.maestrinho/workspace.json', 'M', '.claude/skills/orq/SKILL.md', ''].join('\0')
    expect(checkpointPlan(z)).toEqual({ restore: ['src/a.ts', 'apagado.md', 'link'], remove: ['novo.ts'] })
    expect(checkpointPlan('')).toEqual({ restore: [], remove: [] })
  })
})
