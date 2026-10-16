import { describe, expect, it } from 'vitest'
import { lastLines, lastRows, logicalLinesBackward, searchLines, type BufferLike } from './bufferText'

/** Buffer falso: cada item é [texto, quebrada pelo wrap?]. */
function buffer(rows: [string, boolean][]): BufferLike & { reads: number } {
  const b = {
    reads: 0,
    length: rows.length,
    getLine(y: number) {
      const r = rows[y]
      if (!r) return undefined
      return {
        isWrapped: r[1],
        translateToString: () => {
          b.reads++
          return r[0]
        }
      }
    }
  }
  return b
}

describe('texto do buffer do terminal', () => {
  const rows: [string, boolean][] = [
    ['continuação de uma linha antiga', true],
    ['PS C:\\> echo ', false],
    ['olá mundo, operação ', true],
    ['concluída', true],
    ['', false],
    ['fim   ', false],
    ['', false],
    ['', false]
  ]

  it('une as linhas quebradas e anda do fim para o começo', () => {
    expect([...logicalLinesBackward(buffer(rows))]).toEqual([
      { text: '', y: 7 },
      { text: '', y: 6 },
      { text: 'fim   ', y: 5 },
      { text: '', y: 4 },
      { text: 'PS C:\\> echo olá mundo, operação concluída', y: 1 },
      { text: 'continuação de uma linha antiga', y: 0 }
    ])
  })

  it('últimas linhas: ignora vazias do fim, tira espaços e lê só o necessário', () => {
    const b = buffer(rows)
    expect(lastLines(b, 1)).toBe('fim')
    expect(b.reads).toBe(3)
    expect(lastLines(buffer(rows), 3)).toBe('PS C:\\> echo olá mundo, operação concluída\n\nfim')
    expect(lastLines(buffer([]), 5)).toBe('')
  })

  it('busca sem acento e sem maiúsculas, da mais recente, com limite', () => {
    expect(searchLines(buffer(rows), 'OPERACAO', 5)).toEqual([{ text: 'PS C:\\> echo olá mundo, operação concluída', y: 1 }])
    expect(searchLines(buffer(rows), 'a', 2).map((m) => m.y)).toEqual([1, 0])
    expect(searchLines(buffer(rows), '   ', 5)).toEqual([])
    // Só as últimas 3 linhas físicas: a linha antiga não entra.
    expect(searchLines(buffer(rows), 'antiga', 5, 3)).toEqual([])
  })
})

describe('linhas físicas da tela', () => {
  it('não junta a linha que ocupou a largura toda com a seguinte (ConPTY)', () => {
    const b = buffer([
      ['──────────', false],
      ['☐ Formato  ☐ Validação', true],
      ['', false],
      ['❯ 1. Sim', false],
      ['  2. Não', false],
      ['', false]
    ])
    expect(lastRows(b, 40)).toBe('──────────\n☐ Formato  ☐ Validação\n\n❯ 1. Sim\n  2. Não')
    expect(lastLines(b, 40)).toContain('──────────☐ Formato')
  })

  it('pega só as últimas linhas pedidas', () => {
    const b = buffer([
      ['a', false],
      ['b', false],
      ['c', false]
    ])
    expect(lastRows(b, 2)).toBe('b\nc')
  })
})

