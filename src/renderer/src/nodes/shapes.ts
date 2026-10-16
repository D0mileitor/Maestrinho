import { newId } from '@shared/ids'
import type { ShapeNodeData } from '@shared/schemas'
import type { FlowRect } from '../store/appStore'
import type { CreationTool } from '../canvas/CreationOverlay'

/** Cria o documento de uma forma (retângulo, texto, seta, desenho livre). */
export function createShapeNode(
  tool: CreationTool,
  rect: FlowRect,
  points: [number, number][] | undefined,
  floorId: string | undefined
): ShapeNodeData {
  const shape: ShapeNodeData['shape'] =
    tool === 'text' ? 'text' : tool === 'arrow' ? 'arrow' : tool === 'draw' ? 'drawing' : 'rect'
  return {
    id: newId('s'),
    kind: 'shape',
    shape,
    text: shape === 'text' ? 'Texto' : '',
    color: '',
    position: { x: rect.x, y: rect.y },
    size: { w: Math.max(80, rect.w), h: Math.max(60, rect.h) },
    points: points && points.length > 1 ? simplify(points, 1.2) : undefined,
    strokeWidth: shape === 'drawing' ? 2.5 : 2,
    floorId
  }
}

/** Simplificação Ramer–Douglas–Peucker para reduzir pontos de traços livres. */
export function simplify(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length < 3) return points
  const [first, last] = [points[0]!, points[points.length - 1]!]
  let maxDist = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicular(points[i]!, first, last)
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist <= epsilon) return [first, last]
  const left = simplify(points.slice(0, index + 1), epsilon)
  const right = simplify(points.slice(index), epsilon)
  return [...left.slice(0, -1), ...right]
}

function perpendicular(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len
}
