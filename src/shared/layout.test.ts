import { describe, expect, it } from 'vitest'
import { LAYOUT_GRID, layoutRecruits, pickHandles, placeRecruit, type LayoutRect } from './layout'

const SIZE = { w: 600, h: 420 }
const GAP = 40

function rect(x: number, y: number, w = SIZE.w, h = SIZE.h): LayoutRect {
  return { position: { x, y }, size: { w, h } }
}

function overlaps(a: LayoutRect, b: LayoutRect): boolean {
  return (
    a.position.x < b.position.x + b.size.w &&
    a.position.x + a.size.w > b.position.x &&
    a.position.y < b.position.y + b.size.h &&
    a.position.y + a.size.h > b.position.y
  )
}

function onGrid(v: number): boolean {
  return Math.abs(v % LAYOUT_GRID) === 0
}

function asRects(points: { x: number; y: number }[], size = SIZE): LayoutRect[] {
  return points.map((p) => ({ position: p, size }))
}

/** Gerador pseudoaleatório determinístico (LCG) para os testes de propriedade. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('layoutRecruits', () => {
  const manager = rect(1000, 200)

  it('não devolve nada para quantidade zero ou inválida', () => {
    expect(layoutRecruits(manager, 0, [], SIZE)).toEqual([])
    expect(layoutRecruits(manager, -3, [], SIZE)).toEqual([])
    expect(layoutRecruits(manager, Number.NaN, [], SIZE)).toEqual([])
  })

  it('coloca a linha abaixo do gerente, centralizada, com espaçamento uniforme e na grade', () => {
    const pts = layoutRecruits(manager, 3, [], SIZE, GAP)
    expect(pts).toHaveLength(3)
    const ys = new Set(pts.map((p) => p.y))
    expect(ys.size).toBe(1)
    expect(pts[0]!.y).toBeGreaterThanOrEqual(manager.position.y + manager.size.h + GAP)
    for (const p of pts) {
      expect(onGrid(p.x)).toBe(true)
      expect(onGrid(p.y)).toBe(true)
    }
    const dx1 = pts[1]!.x - pts[0]!.x
    const dx2 = pts[2]!.x - pts[1]!.x
    expect(dx1).toBe(dx2)
    expect(dx1).toBeGreaterThanOrEqual(SIZE.w + GAP)
    const rowCenter = (pts[0]!.x + pts[2]!.x + SIZE.w) / 2
    const managerCenter = manager.position.x + manager.size.w / 2
    expect(Math.abs(rowCenter - managerCenter)).toBeLessThanOrEqual(LAYOUT_GRID / 2)
    const rects = asRects(pts)
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false)
  })

  it('centraliza também quantidades pares e tamanhos fora da grade', () => {
    const odd = { w: 333, h: 250 }
    const pts = layoutRecruits(rect(7, 13, 517, 301), 4, [], odd, GAP)
    const rowCenter = (pts[0]!.x + pts[3]!.x + odd.w) / 2
    expect(Math.abs(rowCenter - (7 + 517 / 2))).toBeLessThanOrEqual(LAYOUT_GRID / 2)
    for (const p of pts) expect(onGrid(p.x)).toBe(true)
    const rects = asRects(pts, odd)
    for (let i = 0; i < rects.length - 1; i++) expect(overlaps(rects[i]!, rects[i + 1]!)).toBe(false)
  })

  it('desce a linha inteira em passos de size.h + gap quando um slot está ocupado', () => {
    const free = layoutRecruits(manager, 3, [], SIZE, GAP)
    const blocker = rect(free[2]!.x + 50, free[2]!.y + 10, 200, 100)
    const pts = layoutRecruits(manager, 3, [manager, blocker], SIZE, GAP)
    const step = Math.ceil((SIZE.h + GAP) / LAYOUT_GRID) * LAYOUT_GRID
    expect(pts.map((p) => p.x)).toEqual(free.map((p) => p.x))
    expect(pts[0]!.y).toBe(free[0]!.y + step)
    expect(new Set(pts.map((p) => p.y)).size).toBe(1)
    for (const r of asRects(pts)) expect(overlaps(r, blocker)).toBe(false)
  })

  it('pula vários nós empilhados de uma vez e continua determinístico', () => {
    const free = layoutRecruits(manager, 2, [], SIZE, GAP)
    const stack = [0, 1, 2, 3].map((i) => rect(free[0]!.x, free[0]!.y + i * 300, 300, 280))
    const a = layoutRecruits(manager, 2, stack, SIZE, GAP)
    const b = layoutRecruits(manager, 2, [...stack].reverse(), SIZE, GAP)
    expect(a).toEqual(b)
    for (const r of asRects(a)) for (const s of stack) expect(overlaps(r, s)).toBe(false)
  })

  it('ignora nós que não estão no caminho da linha', () => {
    const free = layoutRecruits(manager, 2, [], SIZE, GAP)
    const farAway = [rect(-5000, free[0]!.y), rect(9000, free[0]!.y), rect(free[0]!.x, -3000)]
    expect(layoutRecruits(manager, 2, farAway, SIZE, GAP)).toEqual(free)
  })

  it('nunca sobrepõe nós existentes (propriedade, entradas aleatórias)', () => {
    const rand = lcg(42)
    for (let round = 0; round < 200; round++) {
      const mgr = rect(Math.round(rand() * 2000 - 1000), Math.round(rand() * 2000 - 1000), 400 + Math.round(rand() * 400), 300 + Math.round(rand() * 300))
      const existing: LayoutRect[] = [mgr]
      const n = Math.floor(rand() * 25)
      for (let i = 0; i < n; i++) {
        existing.push(
          rect(
            mgr.position.x + Math.round(rand() * 3000 - 1500),
            mgr.position.y + Math.round(rand() * 3000 - 200),
            80 + Math.round(rand() * 900),
            60 + Math.round(rand() * 900)
          )
        )
      }
      const count = 1 + Math.floor(rand() * 6)
      const pts = layoutRecruits(mgr, count, existing, SIZE, GAP)
      expect(pts).toHaveLength(count)
      const placed = asRects(pts)
      for (const p of placed) for (const e of existing) expect(overlaps(p, e)).toBe(false)
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i]!, placed[j]!)).toBe(false)
      }
      const rowCenter = (pts[0]!.x + pts[pts.length - 1]!.x + SIZE.w) / 2
      expect(Math.abs(rowCenter - (mgr.position.x + mgr.size.w / 2))).toBeLessThanOrEqual(LAYOUT_GRID / 2)
    }
  })
})

describe('placeRecruit', () => {
  const manager = rect(0, 0)

  it('distribui recrutas criados um a um lado a lado: centro, direita, esquerda', () => {
    const existing: LayoutRect[] = [manager]
    const placed: { x: number; y: number }[] = []
    for (let i = 0; i < 3; i++) {
      const p = placeRecruit(manager, existing, SIZE, GAP)
      placed.push(p)
      existing.push({ position: p, size: SIZE })
    }
    expect(new Set(placed.map((p) => p.y)).size).toBe(1)
    const [center, right, left] = placed
    expect(right!.x).toBeGreaterThan(center!.x)
    expect(left!.x).toBeLessThan(center!.x)
    // Três recrutas: o grupo fica centralizado sob o gerente.
    const groupCenter = (left!.x + right!.x + SIZE.w) / 2
    expect(Math.abs(groupCenter - (manager.position.x + manager.size.w / 2))).toBeLessThanOrEqual(LAYOUT_GRID / 2)
    for (let i = 1; i < existing.length; i++) {
      for (let j = i + 1; j < existing.length; j++) expect(overlaps(existing[i]!, existing[j]!)).toBe(false)
    }
  })

  it('desce uma linha quando a primeira está toda ocupada', () => {
    const first = placeRecruit(manager, [manager], SIZE, GAP)
    const wall = rect(-10_000, first.y, 20_000, 100)
    const p = placeRecruit(manager, [manager, wall], SIZE, GAP)
    expect(p.y).toBeGreaterThan(first.y)
    expect(overlaps({ position: p, size: SIZE }, wall)).toBe(false)
    expect(onGrid(p.x)).toBe(true)
    expect(onGrid(p.y)).toBe(true)
  })

  it('nunca sobrepõe nós existentes (propriedade)', () => {
    const rand = lcg(7)
    for (let round = 0; round < 200; round++) {
      const existing: LayoutRect[] = [manager]
      const n = Math.floor(rand() * 30)
      for (let i = 0; i < n; i++) {
        existing.push(rect(Math.round(rand() * 4000 - 2000), Math.round(rand() * 3000), 80 + Math.round(rand() * 800), 60 + Math.round(rand() * 800)))
      }
      const p = placeRecruit(manager, existing, SIZE, GAP)
      for (const e of existing) expect(overlaps({ position: p, size: SIZE }, e)).toBe(false)
    }
  })
})

describe('pickHandles', () => {
  const a = rect(0, 0)

  it('liga pelo eixo de maior afastamento', () => {
    expect(pickHandles(a, rect(0, 600))).toEqual({ sourceHandle: 'b', targetHandle: 't' })
    expect(pickHandles(a, rect(0, -600))).toEqual({ sourceHandle: 't', targetHandle: 'b' })
    expect(pickHandles(a, rect(900, 0))).toEqual({ sourceHandle: 'r', targetHandle: 'l' })
    expect(pickHandles(a, rect(-900, 0))).toEqual({ sourceHandle: 'l', targetHandle: 'r' })
  })

  it('recruta na diagonal logo abaixo do gerente usa as bordas inferior/superior', () => {
    expect(pickHandles(a, rect(640, 460))).toEqual({ sourceHandle: 'b', targetHandle: 't' })
    expect(pickHandles(a, rect(-640, 460))).toEqual({ sourceHandle: 'b', targetHandle: 't' })
  })
})
