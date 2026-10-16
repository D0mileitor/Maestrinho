import { describe, expect, it } from 'vitest'
import { titleBarColors } from './titleBar'

describe('titleBarColors', () => {
  it('acompanha o tema (fundo e símbolos com contraste)', () => {
    expect(titleBarColors('dark')).toEqual({ color: '#151b27', symbolColor: '#b7bdc9' })
    expect(titleBarColors('light')).toEqual({ color: '#e9edf3', symbolColor: '#3f4a5c' })
  })
})
