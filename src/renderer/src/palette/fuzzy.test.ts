import { describe, expect, it } from 'vitest'
import { fuzzyScore, multiTermScore, normalize } from './fuzzy'

describe('normalize', () => {
  it('remove acentos e passa para minúsculas', () => {
    expect(normalize('Café')).toBe('cafe')
    expect(normalize('AÇÃO Rápida')).toBe('acao rapida')
    expect(normalize('Ñandú über')).toBe('nandu uber')
  })

  it('texto sem acentos só muda a caixa', () => {
    expect(normalize('Terminal-01')).toBe('terminal-01')
  })
})

describe('fuzzyScore', () => {
  it('consulta vazia casa tudo com pontuação 0', () => {
    expect(fuzzyScore('', 'qualquer coisa')).toEqual({ score: 0, positions: [] })
  })

  it('casa subsequências (letras na ordem, não necessariamente juntas) e devolve as posições', () => {
    const r = fuzzyScore('rvs', 'revisor')
    expect(r.score).toBeGreaterThan(0)
    expect(r.positions).toEqual([0, 2, 4])
  })

  it('sem casamento (ou fora de ordem) devolve -1', () => {
    expect(fuzzyScore('xyz', 'revisor')).toEqual({ score: -1, positions: [] })
    expect(fuzzyScore('ba', 'abc')).toEqual({ score: -1, positions: [] })
    expect(fuzzyScore('revisores', 'revisor')).toEqual({ score: -1, positions: [] })
  })

  it('ignora acentos e maiúsculas tanto na consulta quanto no texto', () => {
    expect(fuzzyScore('acao', 'Ação Rápida').positions).toEqual([0, 1, 2, 3])
    expect(fuzzyScore('ÁÇÃO', 'acao').score).toBeGreaterThan(0)
    expect(fuzzyScore('LIDER', 'Líder').score).toBe(fuzzyScore('lider', 'lider').score)
  })

  it('bônus de início de palavra (+6) após espaço, ".", "_", "-", "/" e "\\"', () => {
    const base = fuzzyScore('t', 'abxt').score
    for (const sep of [' ', '.', '_', '-', '/', '\\']) {
      expect(fuzzyScore('t', `ab${sep}t`).score - base, JSON.stringify(sep)).toBeCloseTo(6, 6)
    }
    // O primeiro caractere do texto também conta como início de palavra.
    expect(fuzzyScore('t', 'tabc').score).toBeGreaterThan(fuzzyScore('t', 'atbc').score)
  })

  it('bônus de sequência contínua (+4 por letra seguida)', () => {
    expect(fuzzyScore('ab', 'xabx').score - fuzzyScore('ab', 'xaxb').score).toBeCloseTo(4, 6)
  })

  it('prefere casamentos que começam mais cedo e textos mais curtos', () => {
    expect(fuzzyScore('rev', 'zrevisor').score).toBeGreaterThan(fuzzyScore('rev', 'zzzzzzrevisor').score)
    expect(fuzzyScore('nota', 'nota').score).toBeGreaterThan(fuzzyScore('nota', 'nota com texto longo').score)
  })

  it('início de palavra pesa mais que letras soltas no meio', () => {
    // "ct" em "code-test" casa dois inícios de palavra; em "acetate", letras no meio.
    expect(fuzzyScore('ct', 'code-test').score).toBeGreaterThan(fuzzyScore('ct', 'acetate').score)
  })
})

describe('multiTermScore', () => {
  it('consulta vazia ou só com espaços: pontuação 0', () => {
    expect(multiTermScore('', ['a'])).toEqual({ score: 0, positions: [] })
    expect(multiTermScore('   ', ['a'])).toEqual({ score: 0, positions: [] })
  })

  it('todas as palavras precisam casar (E lógico), cada uma em qualquer campo', () => {
    const fields = ['revisor', 'terminal', 'Projeto Alfa']
    expect(multiTermScore('rev term', fields).score).toBeGreaterThan(0)
    expect(multiTermScore('alfa rev', fields).score).toBeGreaterThan(0)
    expect(multiTermScore('rev xyz', fields)).toEqual({ score: -1, positions: [] })
    expect(multiTermScore('xyz', fields)).toEqual({ score: -1, positions: [] })
  })

  it('a pontuação total soma a melhor pontuação de cada palavra', () => {
    const fields = ['revisor', 'terminal']
    const single = multiTermScore('rev', fields).score
    expect(multiTermScore('rev rev', fields).score).toBeCloseTo(single * 2, 6)
  })

  it('o primeiro campo (nome) vale 1,5x os demais', () => {
    const inName = multiTermScore('nota', ['nota', 'x']).score
    const inOther = multiTermScore('nota', ['x', 'nota']).score
    expect(inName / inOther).toBeCloseTo(1.5, 6)
  })

  it('posições para destaque vêm da primeira palavra quando ela casa no primeiro campo', () => {
    expect(multiTermScore('rev term', ['revisor', 'terminal']).positions).toEqual([0, 1, 2])
    expect(multiTermScore('term rev', ['revisor', 'terminal']).positions).toEqual([])
  })

  it('ignora acentos e espaços extras entre as palavras', () => {
    expect(multiTermScore('  líder   time ', ['Lider do Time']).score).toBeGreaterThan(0)
    expect(multiTermScore('acao', ['Ação']).positions).toEqual([0, 1, 2, 3])
  })

  it('ao ordenar, casamento no nome fica à frente do casamento em outro campo; sem casamento sai', () => {
    const items = [
      { label: 'meu-terminal', fields: ['meu-terminal', 'revisão do código'] },
      { label: 'notas-gerais', fields: ['notas-gerais', 'nota'] },
      { label: 'revisor', fields: ['revisor', 'terminal'] }
    ]
    const ranked = items
      .map((item) => ({ label: item.label, score: multiTermScore('rev', item.fields).score }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
    expect(ranked.map((r) => r.label)).toEqual(['revisor', 'meu-terminal'])
  })
})
