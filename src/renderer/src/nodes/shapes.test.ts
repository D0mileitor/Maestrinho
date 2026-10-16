import { describe, expect, it } from 'vitest'
import { ShapeNodeSchema } from '@shared/schemas'
import type { CreationTool } from '../canvas/CreationOverlay'
import type { FlowRect } from '../store/appStore'
import { createShapeNode, simplify } from './shapes'

type Pt = [number, number]

const rect: FlowRect = { x: 100, y: 200, w: 300, h: 150 }

/** Distância de p à reta que passa por a e b (mesma métrica do RDP). */
function distToLine(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len
}

/** Gerador pseudoaleatório determinístico (LCG) para testes reproduzíveis. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('createShapeNode', () => {
  it('ferramenta de texto cria forma "text" com texto inicial', () => {
    const node = createShapeNode('text', rect, undefined, undefined)
    expect(node).toMatchObject({
      kind: 'shape',
      shape: 'text',
      text: 'Texto',
      color: '',
      position: { x: 100, y: 200 },
      size: { w: 300, h: 150 },
      strokeWidth: 2
    })
    expect(node.id).toMatch(/^s-[0-9a-z]{10}$/)
    expect(node.points).toBeUndefined()
  })

  it('mapeia retângulo, seta e desenho livre para os tipos de forma', () => {
    expect(createShapeNode('rect', rect, undefined, undefined).shape).toBe('rect')
    expect(createShapeNode('arrow', rect, [[0, 0], [300, 150]], undefined).shape).toBe('arrow')
    expect(createShapeNode('draw', rect, [[0, 0], [10, 10]], undefined).shape).toBe('drawing')
  })

  it('outras ferramentas caem no retângulo', () => {
    for (const tool of ['terminal', 'note', 'portal'] as CreationTool[]) {
      expect(createShapeNode(tool, rect, undefined, undefined).shape).toBe('rect')
    }
  })

  it('só o texto começa com conteúdo; desenho livre usa traço mais grosso', () => {
    expect(createShapeNode('rect', rect, undefined, undefined).text).toBe('')
    expect(createShapeNode('arrow', rect, undefined, undefined).strokeWidth).toBe(2)
    expect(createShapeNode('draw', rect, [[0, 0], [5, 5]], undefined).strokeWidth).toBe(2.5)
  })

  it('aplica tamanho mínimo de 80x60', () => {
    const node = createShapeNode('rect', { x: 1, y: 2, w: 5, h: 10 }, undefined, undefined)
    expect(node.size).toEqual({ w: 80, h: 60 })
    expect(node.position).toEqual({ x: 1, y: 2 })
  })

  it('pontos: menos de 2 viram undefined; com 2+ são simplificados', () => {
    expect(createShapeNode('draw', rect, [], undefined).points).toBeUndefined()
    expect(createShapeNode('draw', rect, [[1, 1]], undefined).points).toBeUndefined()
    expect(createShapeNode('arrow', rect, [[0, 0], [300, 150]], undefined).points).toEqual([
      [0, 0],
      [300, 150]
    ])
    const straight: Pt[] = Array.from({ length: 50 }, (_, i) => [i * 2, i])
    expect(createShapeNode('draw', rect, straight, undefined).points).toEqual([
      [0, 0],
      [98, 49]
    ])
  })

  it('repassa o floor e gera ids diferentes a cada chamada', () => {
    expect(createShapeNode('rect', rect, undefined, 'f1').floorId).toBe('f1')
    expect(createShapeNode('rect', rect, undefined, undefined).floorId).toBeUndefined()
    const ids = new Set(Array.from({ length: 100 }, () => createShapeNode('rect', rect, undefined, undefined).id))
    expect(ids.size).toBe(100)
  })

  it('o resultado é válido pelo schema de forma (com e sem floor/pontos)', () => {
    const samples = [
      createShapeNode('text', rect, undefined, undefined),
      createShapeNode('draw', rect, [[0, 0], [10, 3], [20, 0]], 'f-1'),
      createShapeNode('arrow', { x: -50.5, y: 0, w: 0, h: 0 }, [[0, 0], [1, 1]], undefined)
    ]
    for (const s of samples) expect(ShapeNodeSchema.safeParse(s).success).toBe(true)
  })
})

describe('simplify (Ramer–Douglas–Peucker)', () => {
  it('menos de 3 pontos: devolve a mesma lista', () => {
    const two: Pt[] = [
      [0, 0],
      [5, 5]
    ]
    expect(simplify(two, 1)).toBe(two)
    const one: Pt[] = [[1, 2]]
    expect(simplify(one, 1)).toBe(one)
  })

  it('pontos colineares viram só as duas pontas', () => {
    expect(
      simplify(
        [
          [0, 0],
          [1, 1],
          [2, 2],
          [3, 3],
          [10, 10]
        ],
        0.5
      )
    ).toEqual([
      [0, 0],
      [10, 10]
    ])
    const line: Pt[] = Array.from({ length: 100 }, (_, i) => [i, 3 * i + 1])
    expect(simplify(line, 0.01)).toEqual([line[0], line[99]])
  })

  it('ruído abaixo de epsilon some; desvio acima de epsilon fica', () => {
    const noisy: Pt[] = [
      [0, 0],
      [2, 0.5],
      [4, -0.4],
      [6, 0.3],
      [10, 0]
    ]
    expect(simplify(noisy, 1)).toEqual([
      [0, 0],
      [10, 0]
    ])
    const peak: Pt[] = [
      [0, 0],
      [5, 5],
      [10, 0]
    ]
    expect(simplify(peak, 1)).toEqual(peak)
  })

  it('preserva cantos de um traço em L', () => {
    const l: Pt[] = [
      ...Array.from({ length: 11 }, (_, i): Pt => [i, 0]),
      ...Array.from({ length: 10 }, (_, i): Pt => [10, i + 1])
    ]
    expect(simplify(l, 0.5)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10]
    ])
  })

  it('traço fechado (início = fim) não colapsa num ponto', () => {
    const square: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0]
    ]
    expect(simplify(square, 1)).toEqual(square)
  })

  it('não altera a lista de entrada', () => {
    const pts: Pt[] = [
      [0, 0],
      [1, 0.1],
      [2, 0],
      [3, 5],
      [4, 0]
    ]
    const copy = structuredClone(pts)
    simplify(pts, 0.5)
    expect(pts).toEqual(copy)
  })

  it('propriedade: mantém as pontas, preserva a ordem e todo ponto removido fica a até epsilon do trecho', () => {
    const random = rng(42)
    for (let run = 0; run < 30; run++) {
      const pts: Pt[] = []
      let x = 0
      let y = 0
      const n = 3 + Math.floor(random() * 200)
      for (let i = 0; i < n; i++) {
        x += random() * 4
        y += (random() - 0.5) * 6
        pts.push([x, y])
      }
      const eps = 0.5 + random() * 3
      const kept = simplify(pts, eps)
      const idx = kept.map((p) => pts.indexOf(p))
      expect(idx[0]).toBe(0)
      expect(idx[idx.length - 1]).toBe(pts.length - 1)
      for (let j = 1; j < idx.length; j++) expect(idx[j]!).toBeGreaterThan(idx[j - 1]!)
      for (let j = 0; j + 1 < idx.length; j++) {
        const a = pts[idx[j]!]!
        const b = pts[idx[j + 1]!]!
        for (let i = idx[j]! + 1; i < idx[j + 1]!; i++) {
          expect(distToLine(pts[i]!, a, b)).toBeLessThanOrEqual(eps + 1e-9)
        }
      }
    }
  })
})
