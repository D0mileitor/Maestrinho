import type { WorkspaceOp } from './ipc'
import { CanvasNodeSchema, OfficeSceneRefSchema, type CanvasNode, type WorkspaceDoc } from './schemas'

/**
 * Aplicação pura de operações ao documento do workspace. Usada no main (fonte da verdade) e no
 * renderer (aplicação otimista), garantindo o mesmo resultado nos dois lados.
 * Retorna um novo documento; o original não é modificado.
 */
export function applyWorkspaceOps(doc: WorkspaceDoc, ops: readonly WorkspaceOp[]): WorkspaceDoc {
  let nodes = doc.nodes
  let edges = doc.edges
  let viewport = doc.viewport
  let activeFloorId = doc.activeFloorId
  let name = doc.name
  let floors = doc.floors
  let officeScene = doc.officeScene

  for (const op of ops) {
    switch (op.op) {
      case 'addNodes': {
        const existing = new Set(nodes.map((n) => n.id))
        const fresh = op.nodes.filter((n) => {
          // Ids repetidos (no documento ou no próprio lote) entram uma vez só.
          if (existing.has(n.id)) return false
          existing.add(n.id)
          return true
        })
        if (fresh.length) nodes = [...nodes, ...fresh]
        break
      }
      case 'updateNode': {
        nodes = nodes.map((n) => {
          if (n.id !== op.id) return n
          // id e kind nunca mudam por patch
          const merged = { ...n, ...op.patch, id: n.id, kind: n.kind } as CanvasNode
          const valid = CanvasNodeSchema.safeParse(merged)
          return valid.success ? valid.data : n
        })
        break
      }
      case 'removeNodes': {
        const ids = new Set(op.ids)
        nodes = nodes.filter((n) => !ids.has(n.id))
        edges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target))
        break
      }
      case 'addEdges': {
        const nodeIds = new Set(nodes.map((n) => n.id))
        const seen = new Set(edges.map((e) => edgeKey(e.source, e.target)))
        const fresh = []
        for (const e of op.edges) {
          if (e.source === e.target) continue
          if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue
          const key = edgeKey(e.source, e.target)
          if (seen.has(key)) continue
          seen.add(key)
          fresh.push(e)
        }
        if (fresh.length) edges = [...edges, ...fresh]
        break
      }
      case 'removeEdges': {
        const ids = new Set(op.ids)
        edges = edges.filter((e) => !ids.has(e.id))
        break
      }
      case 'setViewport':
        viewport = op.viewport
        break
      case 'setActiveFloor':
        activeFloorId = op.floorId ?? undefined
        break
      case 'setName':
        if (op.name.trim()) name = op.name.trim().slice(0, 120)
        break
      case 'setFloors':
        floors = op.floors
        if (activeFloorId && !floors.some((f) => f.id === activeFloorId)) activeFloorId = undefined
        break
      case 'setOfficeScene':
        if (op.scene === null) officeScene = undefined
        else if (OfficeSceneRefSchema.safeParse(op.scene).success) officeScene = op.scene
        break
    }
  }
  return { ...doc, nodes, edges, viewport, activeFloorId, name, floors, officeScene }
}

/** Chave não direcionada de uma conexão (a conexão vale nos dois sentidos). */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}
