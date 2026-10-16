import { describe, expect, it } from 'vitest'
import { fontChoice, OTHER_FONT } from './fonts'

describe('opção marcada na lista de fontes', () => {
  const listed = ['Segoe UI', 'Arial']
  it('vazio é a padrão; nome da lista é ele mesmo; o resto é "Outra fonte…"', () => {
    expect(fontChoice('', listed)).toBe('')
    expect(fontChoice('  ', listed)).toBe('')
    expect(fontChoice('Arial', listed)).toBe('Arial')
    expect(fontChoice(' Segoe UI ', listed)).toBe('Segoe UI')
    expect(fontChoice('Fira Sans', listed)).toBe(OTHER_FONT)
    expect(fontChoice('Segoe UI, Arial', listed)).toBe(OTHER_FONT)
  })
})
