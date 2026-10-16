import { describe, expect, it } from 'vitest'
import { placeHint } from './place'

const view = { w: 1000, h: 700 }
const tip = { w: 200, h: 60 }

describe('placeHint', () => {
  it('fica embaixo do elemento, centralizado', () => {
    const p = placeHint({ x: 400, y: 10, w: 40, h: 30 }, tip, view)
    expect(p).toEqual({ x: 320, y: 48, side: 'below', arrow: 100 })
  })

  it('vai para cima quando não cabe embaixo', () => {
    const p = placeHint({ x: 400, y: 660, w: 40, h: 30 }, tip, view)
    expect(p.side).toBe('above')
    expect(p.y).toBe(660 - 8 - 60)
  })

  it('não sai da janela pela direita e a seta continua no elemento', () => {
    const p = placeHint({ x: 970, y: 10, w: 24, h: 24 }, tip, view)
    expect(p.x).toBe(1000 - 8 - 200)
    expect(p.arrow).toBe(982 - p.x)
  })

  it('não sai pela esquerda; a seta fica perto da borda sem passar dela', () => {
    const p = placeHint({ x: 0, y: 10, w: 10, h: 24 }, tip, view)
    expect(p.x).toBe(8)
    expect(p.arrow).toBe(10)
  })

  it('em item de menu, fica ao lado (à direita; à esquerda se não couber)', () => {
    expect(placeHint({ x: 100, y: 300, w: 180, h: 28 }, tip, view, 'side')).toEqual({ x: 288, y: 284, side: 'right', arrow: 30 })
    const p = placeHint({ x: 700, y: 300, w: 180, h: 28 }, tip, view, 'side')
    expect(p.side).toBe('left')
    expect(p.x).toBe(700 - 8 - 200)
  })
})
