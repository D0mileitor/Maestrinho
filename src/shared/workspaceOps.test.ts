import { describe, expect, it } from 'vitest'
import type { WorkspaceOp } from './ipc'
import {
  WorkspaceDocSchema,
  type CanvasEdge,
  type CanvasNode,
  type Floor,
  type NoteNodeData,
  type TerminalNodeData,
  type WorkspaceDoc
} from './schemas'
import { applyWorkspaceOps, edgeKey } from './workspaceOps'

function terminal(id: string, extra: Partial<TerminalNodeData> = {}): TerminalNodeData {
  return {
    id,
    kind: 'terminal',
    name: id,
    presetId: 'shell',
    cwd: '',
    autoStart: true,
    position: { x: 0, y: 0 },
    size: { w: 400, h: 300 },
    ...extra
  }
}

function note(id: string): NoteNodeData {
  return { id, kind: 'note', file: `${id}.md`, position: { x: 500, y: 0 }, size: { w: 300, h: 200 } }
}

function edge(id: string, source: string, target: string): CanvasEdge {
  return { id, source, target }
}

function floor(id: string): Floor {
  return {
    id,
    name: id,
    branch: `floor/${id}`,
    baseBranch: 'main',
    worktreePath: `/tmp/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

function makeDoc(partial: Partial<WorkspaceDoc> = {}): WorkspaceDoc {
  return WorkspaceDocSchema.parse({ version: 1, id: 'ws-teste', name: 'Projeto', ...partial })
}

function apply(doc: WorkspaceDoc, ...ops: WorkspaceOp[]): WorkspaceDoc {
  return applyWorkspaceOps(doc, ops)
}

const nodeIds = (doc: WorkspaceDoc): string[] => doc.nodes.map((n) => n.id)
const edgeIds = (doc: WorkspaceDoc): string[] => doc.edges.map((e) => e.id)

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

describe('applyWorkspaceOps: addNodes', () => {
  it('adiciona nós novos ao final, na ordem recebida', () => {
    const doc = makeDoc({ nodes: [terminal('t1')] })
    const out = apply(doc, { op: 'addNodes', nodes: [terminal('t2'), note('n1')] })
    expect(nodeIds(out)).toEqual(['t1', 't2', 'n1'])
  })

  it('ignora nós cujo id já existe (o original não é substituído)', () => {
    const doc = makeDoc({ nodes: [terminal('t1', { name: 'original' })] })
    const out = apply(doc, { op: 'addNodes', nodes: [terminal('t1', { name: 'impostor' }), terminal('t2')] })
    expect(nodeIds(out)).toEqual(['t1', 't2'])
    expect(out.nodes[0]).toMatchObject({ id: 't1', name: 'original' })
  })

  it('sem nós novos, mantém o mesmo array de nós (sem cópia desnecessária)', () => {
    const doc = makeDoc({ nodes: [terminal('t1')] })
    const out = apply(doc, { op: 'addNodes', nodes: [terminal('t1')] }, { op: 'addNodes', nodes: [] })
    expect(out.nodes).toBe(doc.nodes)
  })

  // Regressão: antes só comparava com os nós já existentes e ids repetidos no lote entravam duplicados.
  it('ids repetidos dentro do mesmo lote entram uma vez só (o primeiro vence)', () => {
    const doc = makeDoc({ nodes: [terminal('t1')] })
    const out = apply(doc, { op: 'addNodes', nodes: [terminal('t2'), terminal('t2', { name: 'repetido' })] })
    expect(nodeIds(out)).toEqual(['t1', 't2'])
    expect(out.nodes[1]).toMatchObject({ id: 't2', name: 't2' })
  })
})

describe('applyWorkspaceOps: updateNode', () => {
  it('aplica o patch (posição, tamanho, nome)', () => {
    const doc = makeDoc({ nodes: [terminal('t1'), terminal('t2')] })
    const out = apply(doc, {
      op: 'updateNode',
      id: 't1',
      patch: { position: { x: 10, y: 20 }, size: { w: 500, h: 320 }, name: 'revisor' }
    })
    expect(out.nodes[0]).toMatchObject({ id: 't1', position: { x: 10, y: 20 }, size: { w: 500, h: 320 }, name: 'revisor' })
    expect(out.nodes[1]).toBe(doc.nodes[1])
  })

  it('id e kind são imutáveis mesmo se vierem no patch', () => {
    const doc = makeDoc({ nodes: [terminal('t1')] })
    const patch = { id: 'outro', kind: 'note', name: 'renomeado' } as unknown as Partial<CanvasNode>
    const out = apply(doc, { op: 'updateNode', id: 't1', patch })
    expect(nodeIds(out)).toEqual(['t1'])
    expect(out.nodes[0]).toMatchObject({ id: 't1', kind: 'terminal', name: 'renomeado' })
  })

  it('patch inválido é rejeitado e o nó original é mantido (mesma referência)', () => {
    const doc = makeDoc({ nodes: [terminal('t1')] })
    const original = doc.nodes[0]
    const invalid: Partial<CanvasNode>[] = [
      { name: 'nome com espaço' } as Partial<CanvasNode>,
      { size: { w: 10, h: 10 } },
      { position: { x: Number.POSITIVE_INFINITY, y: 0 } },
      { presetId: 'id inválido!' } as Partial<CanvasNode>
    ]
    for (const patch of invalid) {
      const out = apply(doc, { op: 'updateNode', id: 't1', patch })
      expect(out.nodes[0]).toBe(original)
    }
  })

  it('patch de outro tipo de nó que torna o nó inválido é rejeitado', () => {
    const doc = makeDoc({ nodes: [note('n1')] })
    const out = apply(doc, { op: 'updateNode', id: 'n1', patch: { file: '../fora.md' } as Partial<CanvasNode> })
    expect(out.nodes[0]).toBe(doc.nodes[0])
  })

  it('id inexistente não altera nada', () => {
    const doc = makeDoc({ nodes: [terminal('t1')] })
    const out = apply(doc, { op: 'updateNode', id: 'nao-existe', patch: { position: { x: 1, y: 1 } } })
    expect(out.nodes).toEqual(doc.nodes)
  })

  it('descarta campos desconhecidos do patch (validação do schema)', () => {
    const doc = makeDoc({ nodes: [terminal('t1')] })
    const patch = { campoEstranho: 'x' } as unknown as Partial<CanvasNode>
    const out = apply(doc, { op: 'updateNode', id: 't1', patch })
    expect(out.nodes[0]).not.toHaveProperty('campoEstranho')
  })

  it('campo opcional com undefined é removido (ex.: tirar o papel do terminal)', () => {
    const doc = makeDoc({ nodes: [terminal('t1', { roleId: 'revisor', manager: true })] })
    const out = apply(doc, { op: 'updateNode', id: 't1', patch: { roleId: undefined } })
    const t = out.nodes[0] as TerminalNodeData
    expect(t.roleId).toBeUndefined()
    expect(t.manager).toBe(true)
  })
})

describe('applyWorkspaceOps: removeNodes', () => {
  it('remove os nós e, em cascata, as conexões ligadas a eles', () => {
    const doc = makeDoc({
      nodes: [terminal('t1'), terminal('t2'), terminal('t3')],
      edges: [edge('e1', 't1', 't2'), edge('e2', 't2', 't3'), edge('e3', 't1', 't3')]
    })
    const out = apply(doc, { op: 'removeNodes', ids: ['t2'] })
    expect(nodeIds(out)).toEqual(['t1', 't3'])
    expect(edgeIds(out)).toEqual(['e3'])
  })

  it('ids desconhecidos são ignorados', () => {
    const doc = makeDoc({ nodes: [terminal('t1')], edges: [] })
    const out = apply(doc, { op: 'removeNodes', ids: ['x', 'y'] })
    expect(nodeIds(out)).toEqual(['t1'])
  })
})

describe('applyWorkspaceOps: addEdges / removeEdges', () => {
  const base = (): WorkspaceDoc => makeDoc({ nodes: [terminal('t1'), terminal('t2'), terminal('t3'), note('n1')] })

  it('adiciona conexão válida (inclusive terminal ↔ nota)', () => {
    const out = apply(base(), { op: 'addEdges', edges: [edge('e1', 't1', 't2'), edge('e2', 't1', 'n1')] })
    expect(edgeIds(out)).toEqual(['e1', 'e2'])
  })

  it('rejeita laço (origem igual ao destino)', () => {
    const out = apply(base(), { op: 'addEdges', edges: [edge('e1', 't1', 't1')] })
    expect(out.edges).toEqual([])
  })

  it('rejeita duplicata de conexão existente nos dois sentidos', () => {
    const doc = apply(base(), { op: 'addEdges', edges: [edge('e1', 't1', 't2')] })
    const out = apply(doc, { op: 'addEdges', edges: [edge('e2', 't1', 't2'), edge('e3', 't2', 't1')] })
    expect(edgeIds(out)).toEqual(['e1'])
    expect(out.edges).toBe(doc.edges)
  })

  it('deduplica dentro do mesmo lote (inclusive no sentido inverso)', () => {
    const out = apply(base(), {
      op: 'addEdges',
      edges: [edge('e1', 't1', 't2'), edge('e2', 't2', 't1'), edge('e3', 't1', 't2'), edge('e4', 't2', 't3')]
    })
    expect(edgeIds(out)).toEqual(['e1', 'e4'])
  })

  it('rejeita conexões com nós inexistentes', () => {
    const out = apply(base(), { op: 'addEdges', edges: [edge('e1', 't1', 'tx'), edge('e2', 'ty', 't1')] })
    expect(out.edges).toEqual([])
  })

  it('ops são aplicadas em sequência: nó adicionado antes pode ser conectado no mesmo lote', () => {
    const out = apply(
      base(),
      { op: 'addNodes', nodes: [terminal('t9')] },
      { op: 'addEdges', edges: [edge('e1', 't1', 't9')] }
    )
    expect(edgeIds(out)).toEqual(['e1'])
  })

  it('conexão a um nó removido no mesmo lote é rejeitada', () => {
    const out = apply(base(), { op: 'removeNodes', ids: ['t2'] }, { op: 'addEdges', edges: [edge('e1', 't1', 't2')] })
    expect(out.edges).toEqual([])
  })

  it('removeEdges remove por id e ignora ids desconhecidos', () => {
    const doc = apply(base(), { op: 'addEdges', edges: [edge('e1', 't1', 't2'), edge('e2', 't2', 't3')] })
    const out = apply(doc, { op: 'removeEdges', ids: ['e1', 'zzz'] })
    expect(edgeIds(out)).toEqual(['e2'])
    expect(nodeIds(out)).toEqual(nodeIds(doc))
  })

  it('depois de remover, a mesma conexão pode ser recriada', () => {
    let doc = apply(base(), { op: 'addEdges', edges: [edge('e1', 't1', 't2')] })
    doc = apply(doc, { op: 'removeEdges', ids: ['e1'] })
    doc = apply(doc, { op: 'addEdges', edges: [edge('e2', 't2', 't1')] })
    expect(edgeIds(doc)).toEqual(['e2'])
  })
})

describe('edgeKey', () => {
  it('é simétrica (a conexão vale nos dois sentidos)', () => {
    expect(edgeKey('a', 'b')).toBe(edgeKey('b', 'a'))
    expect(edgeKey('t-1', 't-2')).toBe('t-1|t-2')
  })

  it('pares diferentes geram chaves diferentes', () => {
    expect(edgeKey('a', 'bc')).not.toBe(edgeKey('ab', 'c'))
  })
})

describe('applyWorkspaceOps: viewport, floor ativo, nome e floors', () => {
  it('setViewport substitui o viewport', () => {
    const out = apply(makeDoc(), { op: 'setViewport', viewport: { x: -120, y: 40.5, zoom: 0.75 } })
    expect(out.viewport).toEqual({ x: -120, y: 40.5, zoom: 0.75 })
  })

  it('setActiveFloor define o floor; null volta ao andar principal (undefined)', () => {
    const doc = makeDoc({ floors: [floor('f1')] })
    const on = apply(doc, { op: 'setActiveFloor', floorId: 'f1' })
    expect(on.activeFloorId).toBe('f1')
    const off = apply(on, { op: 'setActiveFloor', floorId: null })
    expect(off.activeFloorId).toBeUndefined()
  })

  it('setName apara espaços, ignora nome vazio e limita a 120 caracteres', () => {
    const doc = makeDoc()
    expect(apply(doc, { op: 'setName', name: '  Meu Projeto  ' }).name).toBe('Meu Projeto')
    expect(apply(doc, { op: 'setName', name: '   ' }).name).toBe('Projeto')
    expect(apply(doc, { op: 'setName', name: '' }).name).toBe('Projeto')
    expect(apply(doc, { op: 'setName', name: 'x'.repeat(200) }).name).toHaveLength(120)
  })

  it('setOfficeScene: cenário pronto ou imagem do projeto; valor inválido é ignorado; null volta ao padrão', () => {
    const doc = makeDoc()
    expect(apply(doc, { op: 'setOfficeScene', scene: 'inferno' }).officeScene).toBe('inferno')
    expect(apply(doc, { op: 'setOfficeScene', scene: 'arquivo:Praia (2).png' }).officeScene).toBe('arquivo:Praia (2).png')
    const set = apply(doc, { op: 'setOfficeScene', scene: 'jardim' })
    expect(apply(set, { op: 'setOfficeScene', scene: 'arquivo:../x.png' as 'jardim' }).officeScene).toBe('jardim')
    expect(apply(set, { op: 'setOfficeScene', scene: null }).officeScene).toBeUndefined()
  })

  it('setFloors substitui a lista e limpa activeFloorId se o floor ativo sumiu', () => {
    const doc = apply(makeDoc({ floors: [floor('f1'), floor('f2')] }), { op: 'setActiveFloor', floorId: 'f2' })
    const kept = apply(doc, { op: 'setFloors', floors: [floor('f2')] })
    expect(kept.floors.map((f) => f.id)).toEqual(['f2'])
    expect(kept.activeFloorId).toBe('f2')
    const cleared = apply(doc, { op: 'setFloors', floors: [floor('f1')] })
    expect(cleared.activeFloorId).toBeUndefined()
    expect(apply(doc, { op: 'setFloors', floors: [] }).activeFloorId).toBeUndefined()
  })

  it('preserva campos não tocados (versão, id)', () => {
    const out = apply(makeDoc(), { op: 'setName', name: 'Outro' })
    expect(out.version).toBe(1)
    expect(out.id).toBe('ws-teste')
  })
})

describe('applyWorkspaceOps: imutabilidade', () => {
  it('não modifica o documento recebido (nem arrays/objetos internos)', () => {
    const doc = makeDoc({
      nodes: [terminal('t1'), terminal('t2'), note('n1')],
      edges: [edge('e1', 't1', 't2')],
      floors: [floor('f1')],
      activeFloorId: 'f1'
    })
    const snapshot = structuredClone(doc)
    deepFreeze(doc)
    const ops: WorkspaceOp[] = [
      { op: 'addNodes', nodes: [terminal('t3')] },
      { op: 'updateNode', id: 't1', patch: { name: 'novo', position: { x: 5, y: 5 } } },
      { op: 'addEdges', edges: [edge('e2', 't2', 't3')] },
      { op: 'removeEdges', ids: ['e1'] },
      { op: 'removeNodes', ids: ['n1'] },
      { op: 'setViewport', viewport: { x: 1, y: 2, zoom: 2 } },
      { op: 'setName', name: 'Renomeado' },
      { op: 'setFloors', floors: [] },
      { op: 'setActiveFloor', floorId: null }
    ]
    const out = applyWorkspaceOps(doc, ops)
    expect(doc).toEqual(snapshot)
    expect(out).not.toBe(doc)
    expect(nodeIds(out)).toEqual(['t1', 't2', 't3'])
    expect(edgeIds(out)).toEqual(['e2'])
    expect(out.name).toBe('Renomeado')
    expect(out.floors).toEqual([])
  })

  it('o resultado continua válido pelo schema do workspace', () => {
    const doc = makeDoc({ nodes: [terminal('t1'), terminal('t2')] })
    const out = apply(
      doc,
      { op: 'addEdges', edges: [edge('e1', 't1', 't2')] },
      { op: 'updateNode', id: 't2', patch: { roleId: 'revisor' } }
    )
    expect(WorkspaceDocSchema.safeParse(out).success).toBe(true)
  })

  it('lista de ops vazia devolve um documento equivalente', () => {
    const doc = makeDoc({ nodes: [terminal('t1')] })
    expect(applyWorkspaceOps(doc, [])).toEqual(doc)
  })
})
