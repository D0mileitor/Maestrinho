import type { SceneRect } from '@shared/office'

/**
 * Onde pôr a decoração de um cenário (árvores, mesas do refeitório, sofás…): só em espaços livres,
 * sem cobrir mesas, quadros, tapetes e passarelas. Lógica pura; o desenho fica em scenery.ts.
 */

export interface DecorSpec {
  kind: string
  /** Tamanho em unidades da cena (retângulo a partir do canto superior esquerdo). */
  w: number
  h: number
  /** Quantidade máxima (as que não couberem ficam de fora). */
  count: number
  /** Encostado na parede do fundo, perto das bordas (laterais e frente) ou espalhado. */
  prefer: 'wall' | 'edges' | 'spread'
}

export interface Placed {
  kind: string
  x: number
  y: number
  w: number
  h: number
  /** Variação estável (cor, modelo). */
  v: number
}

export interface PlaceOptions {
  width: number
  height: number
  /** Primeira linha do chão (abaixo da parede). */
  floorTop: number
  blocked: SceneRect[]
  seed: number
  /** Folga mínima entre itens e obstáculos. */
  gap?: number
  /** Passo da grade de posições testadas. */
  step?: number
}

function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

function overlaps(a: SceneRect, b: SceneRect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = []
  for (let v = from; v <= to; v += step) out.push(v)
  if (out.length && out[out.length - 1] !== to) out.push(to)
  return out
}

export function placeDecor(specs: DecorSpec[], o: PlaceOptions): Placed[] {
  const gap = o.gap ?? 6
  const step = o.step ?? 8
  const taken: SceneRect[] = []
  const out: Placed[] = []
  specs.forEach((spec, si) => {
    if (spec.w + 4 > o.width || o.floorTop + spec.h + 2 > o.height) return
    const cands: { x: number; y: number; score: number }[] = []
    // Grade + as posições exatas encostadas na borda direita e na de baixo (senão a esquerda sempre ganha).
    const xs = range(2, o.width - 2 - spec.w, step)
    const ys = range(o.floorTop, o.height - 2 - spec.h, step)
    for (const y of ys) {
      for (const x of xs) {
        const noise = mix(mix(o.seed, si), mix(x, y)) / 0xffffffff
        let score: number
        if (spec.prefer === 'wall') score = y - o.floorTop + noise * 6
        else if (spec.prefer === 'edges') score = Math.min(x, o.width - (x + spec.w), o.height - (y + spec.h)) + noise * 24
        else score = noise
        cands.push({ x, y, score })
      }
    }
    cands.sort((a, b) => a.score - b.score)
    let placed = 0
    for (const c of cands) {
      if (placed >= spec.count) break
      const r = { x0: c.x - gap, x1: c.x + spec.w + gap, y0: c.y - gap, y1: c.y + spec.h + gap }
      if (o.blocked.some((b) => overlaps(r, b)) || taken.some((b) => overlaps(r, b))) continue
      taken.push({ x0: c.x, x1: c.x + spec.w, y0: c.y, y1: c.y + spec.h })
      out.push({ kind: spec.kind, x: c.x, y: c.y, w: spec.w, h: spec.h, v: mix(o.seed + placed, mix(c.x, c.y)) % 1000 })
      placed++
    }
  })
  return out
}
