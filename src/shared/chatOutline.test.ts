import { describe, expect, it } from 'vitest'
import { currentIndex, outlineText, tickWindow } from './chatOutline'

describe('outlineText', () => {
  it('junta as linhas e corta textos longos com reticências', () => {
    expect(outlineText('  como ficou\n\na situação  da ctc? ')).toBe('como ficou a situação da ctc?')
    const long = outlineText('a'.repeat(300), 20)
    expect(long).toHaveLength(20)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('currentIndex', () => {
  const tops = [0, 400, 900, 1500]
  it('é a última mensagem que começa acima de um terço da tela', () => {
    expect(currentIndex(tops, 0, 600, false)).toBe(0)
    expect(currentIndex(tops, 300, 600, false)).toBe(1)
    expect(currentIndex(tops, 750, 600, false)).toBe(2)
  })
  it('acima da primeira mensagem não marca nenhuma', () => {
    expect(currentIndex([200, 800], 0, 300, false)).toBe(-1)
  })
  it('no fim da conversa marca a última que aparece na tela', () => {
    expect(currentIndex(tops, 1000, 600, false)).toBe(2)
    expect(currentIndex(tops, 1000, 600, true)).toBe(3)
  })
  it('ignora mensagens que não estão na tela', () => {
    expect(currentIndex([0, Number.POSITIVE_INFINITY, 500], 400, 600, false)).toBe(2)
  })
})

describe('tickWindow', () => {
  it('mostra todos quando cabem', () => {
    expect(tickWindow(5, 2, 24)).toEqual([0, 5])
  })
  it('com muitas mensagens, mostra a janela em volta da atual', () => {
    expect(tickWindow(100, 50, 10)).toEqual([45, 55])
    expect(tickWindow(100, 1, 10)).toEqual([0, 10])
    expect(tickWindow(100, 99, 10)).toEqual([90, 100])
  })
})
