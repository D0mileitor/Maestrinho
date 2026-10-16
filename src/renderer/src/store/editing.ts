import { newId, uniqueName } from '@shared/ids'
import type { CanvasEdge, CanvasNode } from '@shared/schemas'
import { canvasBridge, snap } from '../canvas/bridge'
import { useApp } from './appStore'

/**
 * Edição do canvas: copiar/colar, duplicar e organizar em grade. Colar/duplicar cria nós novos
 * (ids novos, nomes únicos); terminais colados iniciam uma conversa nova (sem sessionId) e
 * recebem as conexões internas do grupo copiado.
 */

interface Clip {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

let clipboard: Clip | null = null

function selectedNodes(): CanvasNode[] {
  const s = useApp.getState()
  const doc = s.active?.doc
  if (!doc) return []
  const ids = new Set(s.selection)
  return doc.nodes.filter((n) => ids.has(n.id))
}

export function copySelection(): number {
  const doc = useApp.getState().active?.doc
  const nodes = selectedNodes()
  if (!doc || nodes.length === 0) return 0
  const ids = new Set(nodes.map((n) => n.id))
  clipboard = {
    nodes: structuredClone(nodes),
    edges: structuredClone(doc.edges.filter((e) => ids.has(e.source) && ids.has(e.target)))
  }
  return nodes.length
}

export function hasClipboard(): boolean {
  return Boolean(clipboard && clipboard.nodes.length)
}

/** Instancia o clip com o canto superior esquerdo em `origin`. */
function instantiate(clip: Clip, origin: { x: number; y: number }): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const s = useApp.getState()
  const doc = s.active!.doc
  const minX = Math.min(...clip.nodes.map((n) => n.position.x))
  const minY = Math.min(...clip.nodes.map((n) => n.position.y))
  const taken = doc.nodes.flatMap((n) => (n.kind === 'terminal' ? [n.name] : []))
  const idMap = new Map<string, string>()
  const nodes: CanvasNode[] = clip.nodes.map((n) => {
    const id = newId(n.kind === 'terminal' ? 't' : n.kind === 'note' ? 'n' : n.kind === 'portal' ? 'w' : 's')
    idMap.set(n.id, id)
    const position = { x: snap(origin.x + (n.position.x - minX)), y: snap(origin.y + (n.position.y - minY)) }
    const base = { ...structuredClone(n), id, position, floorId: doc.activeFloorId }
    if (base.kind === 'terminal') {
      const name = uniqueName(base.name, taken)
      taken.push(name)
      const copy = { ...base, name }
      delete (copy as { sessionId?: string }).sessionId
      return copy
    }
    return base
  })
  for (const n of nodes) {
    if (n.kind === 'terminal' && n.recruitedBy) {
      const mapped = idMap.get(n.recruitedBy)
      if (mapped) n.recruitedBy = mapped
      else delete n.recruitedBy
    }
  }
  const edges = clip.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({ ...e, id: newId('e'), source: idMap.get(e.source)!, target: idMap.get(e.target)! }))
  return { nodes, edges }
}

function insert(clip: Clip, origin: { x: number; y: number }): void {
  const s = useApp.getState()
  if (!s.active) return
  const { nodes, edges } = instantiate(clip, origin)
  void s.applyOps([{ op: 'addNodes', nodes }, ...(edges.length ? [{ op: 'addEdges' as const, edges }] : [])])
  s.setSelection(nodes.map((n) => n.id))
}

/** Cola no centro da área visível. */
export function pasteClipboard(): void {
  if (!clipboard || clipboard.nodes.length === 0) return
  const c = canvasBridge()?.viewportCenter() ?? { x: 0, y: 0 }
  const w = Math.max(...clipboard.nodes.map((n) => n.position.x + n.size.w)) - Math.min(...clipboard.nodes.map((n) => n.position.x))
  const h = Math.max(...clipboard.nodes.map((n) => n.position.y + n.size.h)) - Math.min(...clipboard.nodes.map((n) => n.position.y))
  insert(clipboard, { x: c.x - w / 2, y: c.y - h / 2 })
}

/** Duplica a seleção logo ao lado (40 unidades para baixo/direita). */
export function duplicateSelection(): void {
  const doc = useApp.getState().active?.doc
  const nodes = selectedNodes()
  if (!doc || nodes.length === 0) return
  const ids = new Set(nodes.map((n) => n.id))
  const clip: Clip = { nodes, edges: doc.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) }
  const minX = Math.min(...nodes.map((n) => n.position.x))
  const minY = Math.min(...nodes.map((n) => n.position.y))
  insert(clip, { x: minX + 40, y: minY + 40 })
}

/**
 * Organiza a seleção em grade (colunas ≈ raiz quadrada), a partir do canto superior esquerdo do
 * grupo, com espaçamento de 40. Repetir alterna entre grade e linha única.
 */
let tidyRow = false
export function tidySelection(): void {
  const s = useApp.getState()
  const nodes = selectedNodes().filter((n) => n.kind !== 'shape')
  if (nodes.length < 2) return
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  const cols = tidyRow ? sorted.length : Math.ceil(Math.sqrt(sorted.length))
  tidyRow = !tidyRow
  const gap = 40
  const originX = snap(Math.min(...sorted.map((n) => n.position.x)))
  const originY = snap(Math.min(...sorted.map((n) => n.position.y)))
  const colWidths: number[] = []
  const rowHeights: number[] = []
  sorted.forEach((n, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    colWidths[c] = Math.max(colWidths[c] ?? 0, n.size.w)
    rowHeights[r] = Math.max(rowHeights[r] ?? 0, n.size.h)
  })
  const ops = sorted.map((n, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    const x = originX + colWidths.slice(0, c).reduce((a, b) => a + b + gap, 0)
    const y = originY + rowHeights.slice(0, r).reduce((a, b) => a + b + gap, 0)
    return { op: 'updateNode' as const, id: n.id, patch: { position: { x: snap(x), y: snap(y) } } }
  })
  void s.applyOps(ops)
}
