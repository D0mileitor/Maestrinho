import { describe, expect, it } from 'vitest'
import { placeDecor, type DecorSpec } from './decor'

const specs: DecorSpec[] = [
  { kind: 'arvore', w: 40, h: 60, count: 6, prefer: 'edges' },
  { kind: 'geladeira', w: 22, h: 42, count: 2, prefer: 'wall' },
  { kind: 'banco', w: 30, h: 14, count: 4, prefer: 'spread' }
]
const blocked = [
  { x0: 100, x1: 200, y0: 56, y1: 160 },
  { x0: 300, x1: 380, y0: 200, y1: 280 },
  { x0: 0, x1: 600, y0: 230, y1: 250 }
]
const opts = { width: 600, height: 340, floorTop: 84, blocked, seed: 7 }

describe('placeDecor', () => {
  it('só em espaço livre: sem cobrir obstáculos nem outros itens, dentro do chão', () => {
    const placed = placeDecor(specs, opts)
    expect(placed.length).toBeGreaterThan(6)
    const rects = placed.map((p) => ({ x0: p.x, x1: p.x + p.w, y0: p.y, y1: p.y + p.h }))
    const hit = (a: (typeof rects)[number], b: (typeof rects)[number]): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
    rects.forEach((r, i) => {
      expect(r.x0).toBeGreaterThanOrEqual(2)
      expect(r.x1).toBeLessThanOrEqual(598)
      expect(r.y0).toBeGreaterThanOrEqual(84)
      expect(r.y1).toBeLessThanOrEqual(338)
      for (const b of blocked) expect(hit(r, b)).toBe(false)
      rects.forEach((o, j) => j !== i && expect(hit(r, o)).toBe(false))
    })
  })

  it('preferências: "wall" encosta na parede, "edges" fica perto das bordas', () => {
    const placed = placeDecor(specs, opts)
    for (const g of placed.filter((p) => p.kind === 'geladeira')) expect(g.y).toBeLessThan(84 + 16)
    for (const a of placed.filter((p) => p.kind === 'arvore')) expect(Math.min(a.x, 600 - a.x - a.w, 340 - a.y - a.h)).toBeLessThan(32)
    // não só na borda esquerda
    const sides = new Set(placed.filter((p) => p.kind === 'arvore').map((a) => (a.x < 40 ? 'esq' : a.x + a.w > 560 ? 'dir' : 'baixo')))
    expect(sides.size).toBeGreaterThan(1)
  })

  it('é estável para a mesma entrada e respeita a quantidade máxima', () => {
    expect(placeDecor(specs, opts)).toEqual(placeDecor(specs, opts))
    expect(placeDecor(specs, opts).filter((p) => p.kind === 'banco').length).toBeLessThanOrEqual(4)
    expect(placeDecor([{ kind: 'x', w: 900, h: 10, count: 1, prefer: 'spread' }], opts)).toEqual([])
  })
})
