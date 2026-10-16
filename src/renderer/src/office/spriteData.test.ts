import { describe, expect, it } from 'vitest'
import { defaultLook, HAIR_STYLES } from '@shared/office'
import { buildGrid, palette, validateSprites } from './spriteData'

describe('sprites do escritório', () => {
  it('todos os desenhos têm 16 colunas e só letras com cor', () => {
    expect(validateSprites()).toEqual([])
  })

  it('toda combinação de vista, estilo e acessório gera 32×16 só com cores da paleta', () => {
    const base = defaultLook('t-1')
    const pal = palette(base)
    for (const hairStyle of HAIR_STYLES) {
      for (const acc of [{}, { glasses: true, beard: true, headphones: true, badge: true }, { cap: true }]) {
        const look = { ...base, hairStyle, ...acc }
        for (const view of ['front', 'back', 'side', 'cheer', 'sit'] as const) {
          for (const frame of [0, 1, 2, 3]) {
            const g = buildGrid(look, view, frame, frame === 2, frame === 0)
            expect(g).toHaveLength(32)
            for (const row of g) {
              expect(row).toHaveLength(16)
              for (const ch of row) if (ch !== '.') expect(pal[ch], `${view}/${hairStyle}/${ch}`).toBeDefined()
            }
          }
        }
      }
    }
  })

  it('piscada fecha os olhos e respiração desce o tronco', () => {
    const look = { ...defaultLook('x'), glasses: false, headphones: false }
    const open = buildGrid(look, 'front', 0, false, false)
    const closed = buildGrid(look, 'front', 0, false, true)
    expect(open[7]!.includes('w')).toBe(true)
    expect(closed[7]!.includes('w')).toBe(false)
    const breath = buildGrid(look, 'front', 0, true, false)
    expect(breath[8]).toEqual(open[7])
  })
})
