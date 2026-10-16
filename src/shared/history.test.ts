import { describe, expect, it } from 'vitest'
import type { WorkspaceDoc } from './schemas'
import { applyWorkspaceOps } from './workspaceOps'
import { historyEntry } from './history'

const base: WorkspaceDoc = {
  version: 1,
  id: 'ws',
  name: 'ws',
  viewport: { x: 0, y: 0, zoom: 1 },
  floors: [],
  nodes: [
    { id: 't1', kind: 'terminal', name: 'a', presetId: 'shell', cwd: '', autoStart: true, position: { x: 0, y: 0 }, size: { w: 600, h: 420 } },
    { id: 'n1', kind: 'note', file: 'spec.md', position: { x: 700, y: 0 }, size: { w: 400, h: 320 } }
  ],
  edges: [{ id: 'e1', source: 't1', target: 'n1' }]
}

function roundTrip(ops: Parameters<typeof historyEntry>[1]): { after: WorkspaceDoc; undone: WorkspaceDoc } {
  const entry = historyEntry(base, ops)!
  const after = applyWorkspaceOps(base, entry.redo)
  const undone = applyWorkspaceOps(after, entry.undo)
  return { after, undone }
}

describe('histórico (desfazer/refazer)', () => {
  it('desfaz movimento e redimensionamento', () => {
    const { after, undone } = roundTrip([{ op: 'updateNode', id: 't1', patch: { position: { x: 100, y: 40 }, size: { w: 800, h: 500 } } }])
    expect(after.nodes[0]!.position).toEqual({ x: 100, y: 40 })
    expect(undone).toEqual(base)
  })

  it('desfaz remoção de nós recriando nós e conexões', () => {
    const { after, undone } = roundTrip([{ op: 'removeNodes', ids: ['n1'] }])
    expect(after.edges).toHaveLength(0)
    expect(undone.nodes.map((n) => n.id).sort()).toEqual(['n1', 't1'])
    expect(undone.edges).toEqual(base.edges)
  })

  it('desfaz criação de nota/forma, mas nunca remove terminal criado', () => {
    const entry = historyEntry(base, [
      {
        op: 'addNodes',
        nodes: [
          { id: 't2', kind: 'terminal', name: 'b', presetId: 'shell', cwd: '', autoStart: true, position: { x: 0, y: 500 }, size: { w: 600, h: 420 } },
          { id: 's1', kind: 'shape', shape: 'rect', text: '', color: '', position: { x: 0, y: 0 }, size: { w: 100, h: 80 } }
        ]
      }
    ])!
    expect(entry.undo).toEqual([{ op: 'removeNodes', ids: ['s1'] }])
  })

  it('desfaz criação e remoção de conexões', () => {
    const add = roundTrip([{ op: 'removeEdges', ids: ['e1'] }])
    expect(add.after.edges).toHaveLength(0)
    expect(add.undone.edges).toEqual(base.edges)
  })

  it('ignora navegação (viewport/floor) e lotes sem efeito', () => {
    expect(historyEntry(base, [{ op: 'setViewport', viewport: { x: 1, y: 2, zoom: 1 } }])).toBeNull()
    expect(historyEntry(base, [{ op: 'removeNodes', ids: ['nao-existe'] }])).toBeNull()
  })

  it('inverte lotes com várias operações na ordem correta', () => {
    const { undone } = roundTrip([
      { op: 'updateNode', id: 'n1', patch: { position: { x: 900, y: 0 } } },
      { op: 'removeEdges', ids: ['e1'] },
      { op: 'removeNodes', ids: ['n1'] }
    ])
    expect(undone.nodes.find((n) => n.id === 'n1')!.position).toEqual({ x: 700, y: 0 })
    expect(undone.edges).toEqual(base.edges)
  })
})
