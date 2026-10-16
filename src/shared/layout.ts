/**
 * Layout automático de recrutas (lógica pura, compartilhada entre main e renderer).
 *
 * Coordenadas em unidades do canvas, alinhadas à grade de 20. Os recrutas nascem abaixo do gerente,
 * centralizados sob ele e espaçados por igual; se o espaço estiver ocupado, a linha desce (de forma
 * determinística) até ficar livre. Depois da criação os nós se movem livremente.
 */

export interface LayoutPoint {
  x: number
  y: number
}

export interface LayoutSize {
  w: number
  h: number
}

export interface LayoutRect {
  position: LayoutPoint
  size: LayoutSize
}

export const LAYOUT_GRID = 20
export const DEFAULT_LAYOUT_GAP = 40

/** Ids dos handles de conexão dos nós (ver renderer/src/nodes/NodeFrame.tsx). */
export const NODE_HANDLES = { top: 't', right: 'r', bottom: 'b', left: 'l' } as const
export type NodeHandleId = (typeof NODE_HANDLES)[keyof typeof NODE_HANDLES]

/** Limite de iterações (proteção contra entradas patológicas; o salto por bloqueio já é O(n)). */
const MAX_ROW_STEPS = 10_000

// O "+ 0" transforma -0 em 0 (posições negativas pequenas arredondadas).
function snapRound(v: number): number {
  return Math.round(v / LAYOUT_GRID) * LAYOUT_GRID + 0
}

function snapUp(v: number): number {
  return Math.ceil(v / LAYOUT_GRID) * LAYOUT_GRID + 0
}

function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}

/**
 * Se o retângulo (x, y, size) colide com `r` (considerando uma folga `margin` entre eles), devolve a
 * coordenada y a partir da qual `r` deixa de bloquear; senão, null.
 */
function blockedUntil(x: number, y: number, size: LayoutSize, r: LayoutRect, margin: number): number | null {
  const rx = r.position.x
  const ry = r.position.y
  const hit =
    x < rx + r.size.w + margin && x + size.w + margin > rx && y < ry + r.size.h + margin && y + size.h + margin > ry
  return hit ? ry + r.size.h + margin : null
}

/** Maior y de desbloqueio entre os nós que colidem com o slot (ou null se o slot está livre). */
function slotBlock(x: number, y: number, size: LayoutSize, existing: readonly LayoutRect[], margin: number): number | null {
  let worst: number | null = null
  for (const r of existing) {
    const until = blockedUntil(x, y, size, r, margin)
    if (until !== null && (worst === null || until > worst)) worst = until
  }
  return worst
}

/** Próxima linha da grade de linhas (y0 + k * stride) que fica em ou abaixo de `target`. */
function nextRow(y: number, target: number, strideY: number): number {
  const k = Math.max(1, Math.ceil((target - y) / strideY))
  return y + k * strideY
}

/** Linha logo abaixo de todos os nós existentes (último recurso, sempre livre). */
function belowAll(existing: readonly LayoutRect[], startY: number, gap: number): number {
  let bottom = startY
  for (const r of existing) bottom = Math.max(bottom, r.position.y + r.size.h + gap)
  return snapUp(bottom)
}

/**
 * Posições de `count` recrutas numa linha abaixo do gerente, centralizada sob ele e com espaçamento
 * uniforme (`gap` entre os nós), alinhadas à grade. Se algum slot da linha colidir com um nó
 * existente, a linha inteira desce em passos de `size.h + gap` até ficar livre.
 */
export function layoutRecruits(
  manager: LayoutRect,
  count: number,
  existing: readonly LayoutRect[],
  size: LayoutSize,
  gap = DEFAULT_LAYOUT_GAP
): LayoutPoint[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  if (n === 0) return []
  const g = Math.max(0, finiteOr(gap, DEFAULT_LAYOUT_GAP))
  const margin = g / 2
  const strideX = snapUp(size.w + g)
  const strideY = snapUp(size.h + g)
  const total = (n - 1) * strideX + size.w
  const centerX = manager.position.x + manager.size.w / 2
  const startX = snapRound(centerX - total / 2)
  const xs = Array.from({ length: n }, (_v, i) => startX + i * strideX)
  const y0 = snapUp(manager.position.y + manager.size.h + g)

  let y = y0
  for (let step = 0; step < MAX_ROW_STEPS; step++) {
    let block: number | null = null
    for (const x of xs) {
      const until = slotBlock(x, y, size, existing, margin)
      if (until !== null && (block === null || until > block)) block = until
    }
    if (block === null) return xs.map((x) => ({ x, y }))
    // Descer uma linha por vez até sair do nó que bloqueia mais embaixo dá o mesmo resultado que saltar
    // direto para a primeira linha abaixo dele (enquanto ele bloquear, todas as linhas no meio colidem).
    y = nextRow(y, block, strideY)
  }
  const fallbackY = belowAll(existing, y0, g)
  return xs.map((x) => ({ x, y: fallbackY }))
}

/**
 * Posição de UM novo recruta: procura o primeiro slot livre abaixo do gerente, na ordem
 * centro, direita, esquerda, 2ª à direita, 2ª à esquerda... e só então desce uma linha. Recrutas
 * criados um a um (`orq recruit` várias vezes) ficam assim lado a lado e centralizados como grupo
 * (1 → centro; 3 → esquerda, centro, direita), em vez de empilhados.
 */
export function placeRecruit(
  manager: LayoutRect,
  existing: readonly LayoutRect[],
  size: LayoutSize,
  gap = DEFAULT_LAYOUT_GAP,
  maxPerSide = 3
): LayoutPoint {
  const g = Math.max(0, finiteOr(gap, DEFAULT_LAYOUT_GAP))
  const margin = g / 2
  const strideX = snapUp(size.w + g)
  const strideY = snapUp(size.h + g)
  const centerX = manager.position.x + manager.size.w / 2
  const baseX = snapRound(centerX - size.w / 2)
  const sides = Math.max(0, Math.floor(finiteOr(maxPerSide, 3)))
  const order: number[] = [0]
  for (let k = 1; k <= sides; k++) order.push(k, -k)
  const y0 = snapUp(manager.position.y + manager.size.h + g)

  let y = y0
  for (let step = 0; step < MAX_ROW_STEPS; step++) {
    // Menor y de desbloqueio entre as colunas: nenhuma coluna fica livre antes dele.
    let earliest: number | null = null
    for (const k of order) {
      const x = baseX + k * strideX
      const until = slotBlock(x, y, size, existing, margin)
      if (until === null) return { x, y }
      if (earliest === null || until < earliest) earliest = until
    }
    y = nextRow(y, earliest ?? y + strideY, strideY)
  }
  return { x: baseX, y: belowAll(existing, y0, g) }
}

/**
 * Handles para ligar dois nós de forma legível: pelo eixo de maior afastamento relativo (ao tamanho
 * dos nós), saindo do lado de `a` voltado para `b` e chegando no lado de `b` voltado para `a`.
 */
export function pickHandles(a: LayoutRect, b: LayoutRect): { sourceHandle: NodeHandleId; targetHandle: NodeHandleId } {
  const dx = b.position.x + b.size.w / 2 - (a.position.x + a.size.w / 2)
  const dy = b.position.y + b.size.h / 2 - (a.position.y + a.size.h / 2)
  const rx = Math.abs(dx) / Math.max(1, (a.size.w + b.size.w) / 2)
  const ry = Math.abs(dy) / Math.max(1, (a.size.h + b.size.h) / 2)
  if (ry >= rx) {
    return dy >= 0
      ? { sourceHandle: NODE_HANDLES.bottom, targetHandle: NODE_HANDLES.top }
      : { sourceHandle: NODE_HANDLES.top, targetHandle: NODE_HANDLES.bottom }
  }
  return dx >= 0
    ? { sourceHandle: NODE_HANDLES.right, targetHandle: NODE_HANDLES.left }
    : { sourceHandle: NODE_HANDLES.left, targetHandle: NODE_HANDLES.right }
}
