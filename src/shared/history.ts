import type { WorkspaceOp } from './ipc'
import type { CanvasEdge, CanvasNode, WorkspaceDoc } from './schemas'
import { edgeKey } from './workspaceOps'

/**
 * Desfazer/refazer baseado em operações inversas (calculadas contra o documento ANTES de aplicar).
 * Por ser baseado em operações, convive com mudanças concorrentes vindas do main (recrutamentos,
 * rotinas): desfazer só reverte o que o usuário fez.
 *
 * Regras de segurança:
 *  - desfazer a CRIAÇÃO de um terminal não o remove (encerraria um agente em execução);
 *  - desfazer a REMOÇÃO de um terminal recria o nó (e o processo é iniciado de novo).
 */
export interface HistoryEntry {
  /** Operações para desfazer. */
  undo: WorkspaceOp[]
  /** Operações para refazer (as originais). */
  redo: WorkspaceOp[]
}

/** Operações que não entram no histórico (navegação). */
function recordable(op: WorkspaceOp): boolean {
  return op.op !== 'setViewport' && op.op !== 'setActiveFloor'
}

export function inverseOps(doc: WorkspaceDoc, ops: readonly WorkspaceOp[]): WorkspaceOp[] {
  const inverse: WorkspaceOp[] = []
  // Simula a aplicação sequencial para inverter cada operação contra o estado correto.
  let nodes: CanvasNode[] = doc.nodes
  let edges: CanvasEdge[] = doc.edges
  for (const op of ops) {
    switch (op.op) {
      case 'addNodes': {
        const existing = new Set(nodes.map((n) => n.id))
        const added = op.nodes.filter((n) => !existing.has(n.id))
        const removable = added.filter((n) => n.kind !== 'terminal').map((n) => n.id)
        if (removable.length) inverse.unshift({ op: 'removeNodes', ids: removable })
        nodes = [...nodes, ...added]
        break
      }
      case 'removeNodes': {
        const ids = new Set(op.ids)
        const removedNodes = nodes.filter((n) => ids.has(n.id))
        const removedEdges = edges.filter((e) => ids.has(e.source) || ids.has(e.target))
        const restore: WorkspaceOp[] = []
        if (removedNodes.length) restore.push({ op: 'addNodes', nodes: removedNodes })
        if (removedEdges.length) restore.push({ op: 'addEdges', edges: removedEdges })
        inverse.unshift(...restore)
        nodes = nodes.filter((n) => !ids.has(n.id))
        edges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target))
        break
      }
      case 'updateNode': {
        const prev = nodes.find((n) => n.id === op.id)
        if (!prev) break
        const back: Record<string, unknown> = {}
        for (const k of Object.keys(op.patch)) {
          if (k === 'id' || k === 'kind') continue
          back[k] = (prev as unknown as Record<string, unknown>)[k]
        }
        inverse.unshift({ op: 'updateNode', id: op.id, patch: back as Partial<CanvasNode> })
        nodes = nodes.map((n) => (n.id === op.id ? ({ ...n, ...op.patch, id: n.id, kind: n.kind } as CanvasNode) : n))
        break
      }
      case 'addEdges': {
        const keys = new Set(edges.map((e) => edgeKey(e.source, e.target)))
        const added = op.edges.filter((e) => e.source !== e.target && !keys.has(edgeKey(e.source, e.target)))
        if (added.length) inverse.unshift({ op: 'removeEdges', ids: added.map((e) => e.id) })
        edges = [...edges, ...added]
        break
      }
      case 'removeEdges': {
        const ids = new Set(op.ids)
        const removed = edges.filter((e) => ids.has(e.id))
        if (removed.length) inverse.unshift({ op: 'addEdges', edges: removed })
        edges = edges.filter((e) => !ids.has(e.id))
        break
      }
      default:
        break
    }
  }
  return inverse
}

/** Entrada de histórico para um lote de operações do usuário (ou null se nada a registrar). */
export function historyEntry(doc: WorkspaceDoc, ops: readonly WorkspaceOp[]): HistoryEntry | null {
  const rec = ops.filter(recordable)
  if (rec.length === 0) return null
  const undo = inverseOps(doc, rec)
  if (undo.length === 0) return null
  return { undo, redo: rec }
}
