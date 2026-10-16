import { describe, expect, it } from 'vitest'
import { keyParts, parseHintText } from './content'

describe('parseHintText', () => {
  it('separa título, explicação e atalho', () => {
    expect(parseHintText('Buscar (Ctrl+K)')).toEqual({ title: 'Buscar', keys: ['Ctrl+K'] })
    expect(parseHintText('Selecionar (V)')).toEqual({ title: 'Selecionar', keys: ['V'] })
    expect(parseHintText('C:\\projeto\nClique duas vezes para renomear')).toEqual({ title: 'C:\\projeto', body: 'Clique duas vezes para renomear' })
  })

  it('parênteses que não são atalho ficam no título', () => {
    expect(parseHintText('Hibernar (guarda a conversa)')).toEqual({ title: 'Hibernar (guarda a conversa)' })
  })

  it('texto vazio não vira hint', () => {
    expect(parseHintText('  \n ')).toBeNull()
  })
})

describe('keyParts', () => {
  it('quebra o atalho em teclas', () => {
    expect(keyParts('Ctrl+Shift+B')).toEqual(['Ctrl', 'Shift', 'B'])
    expect(keyParts('Ctrl+,')).toEqual(['Ctrl', ','])
    expect(keyParts('Ctrl++')).toEqual(['Ctrl', '+'])
    expect(keyParts('Esc')).toEqual(['Esc'])
  })
})
