import { describe, expect, it } from 'vitest'
import { characterPrompt, fitSingle, sheetCell, sheetLayout } from './characterSheet'

describe('folha de sprites do personagem', () => {
  it('reconhece a grade 4×5 de células 1:2 em qualquer escala; o resto é quadro único', () => {
    expect(sheetLayout(64, 160)).toEqual({ kind: 'sheet', cellW: 16, cellH: 32 })
    expect(sheetLayout(128, 320)).toEqual({ kind: 'sheet', cellW: 32, cellH: 64 })
    expect(sheetLayout(64, 128)).toEqual({ kind: 'single', width: 64, height: 128 })
    expect(sheetLayout(16, 32)).toEqual({ kind: 'single', width: 16, height: 32 })
  })

  it('célula pedida, ou o primeiro quadro da linha, ou o primeiro da frente', () => {
    const filled = new Set(['0,0', '1,0', '0,2', '2,2'])
    const f = (c: number, r: number) => filled.has(`${c},${r}`)
    expect(sheetCell('side', 2, f)).toEqual({ col: 2, row: 2 })
    expect(sheetCell('side', 3, f)).toEqual({ col: 0, row: 2 })
    expect(sheetCell('front', 5, f)).toEqual({ col: 1, row: 0 })
    expect(sheetCell('cheer', 0, f)).toEqual({ col: 0, row: 0 })
    expect(sheetCell('sit', 1, f)).toEqual({ col: 0, row: 0 })
  })

  it('imagem única cabe no quadro mantendo a proporção, no chão', () => {
    expect(fitSingle(64, 64, 16, 32)).toEqual({ x: 0, y: 16, w: 16, h: 16 })
    expect(fitSingle(10, 40, 16, 32)).toEqual({ x: 4, y: 0, w: 8, h: 32 })
  })

  it('instruções para o agente com o formato exato', () => {
    const p = characterPrompt('um robô azul com antena')
    expect(p).toContain('um robô azul com antena')
    expect(p).toContain('64×160')
    expect(p).toContain('4 colunas × 5 linhas')
  })
})
