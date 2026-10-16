import { describe, expect, it } from 'vitest'
import { fontFamilyList, uiFontVars } from './uiFont'

describe('fonte da interface', () => {
  it('nomes ganham aspas; genéricas não; vazio = nenhuma', () => {
    expect(fontFamilyList('Segoe UI, Arial,sans-serif')).toBe('"Segoe UI", "Arial", sans-serif')
    expect(fontFamilyList(`'IBM Plex Sans', "3270 Nerd Font"`)).toBe('"IBM Plex Sans", "3270 Nerd Font"')
    expect(fontFamilyList(' , ')).toBeNull()
    expect(fontFamilyList('')).toBeNull()
  })

  it('descarta o que poderia escapar do valor CSS', () => {
    expect(fontFamilyList('Arial; color: red } body { x')).toBe('"Arial color: red  body  x"')
    expect(fontFamilyList('url(x)')).toBe('"urlx"')
  })

  it('variáveis: padrão remove tudo; fonte vale também para a condensada; tamanho vira escala sobre 13 px', () => {
    expect(uiFontVars({ uiFontFamily: '', uiFontSize: 13 })).toEqual({ '--font-ui': null, '--font-condensed': null, '--font-scale': null })
    expect(uiFontVars({ uiFontFamily: 'Inter', uiFontSize: 16 })).toEqual({
      '--font-ui': '"Inter", sans-serif',
      '--font-condensed': '"Inter", sans-serif',
      '--font-scale': '1.2308'
    })
    expect(uiFontVars({ uiFontFamily: '', uiFontSize: 99 })['--font-scale']).toBe('1.5385')
    expect(uiFontVars({ uiFontFamily: '', uiFontSize: Number.NaN })['--font-scale']).toBeNull()
  })
})
