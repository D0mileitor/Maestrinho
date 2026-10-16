import { describe, expect, it } from 'vitest'
import { ApiError } from '@shared/api'
import type { CanvasEdge, CanvasNode, WorkspaceDoc } from '@shared/schemas'
import {
  areConnected,
  connectedNotes,
  connectedPortals,
  connectedTerminals,
  findEdge,
  matchNotes,
  matchTerminals,
  neighbors,
  normalizeName,
  resolveNoteRef,
  resolveTerminalRef,
  terminalNodes
} from './graph'

const pos = { position: { x: 0, y: 0 }, size: { w: 600, h: 420 } }

function term(id: string, name: string, extra: Partial<CanvasNode> = {}): CanvasNode {
  return { id, kind: 'terminal', name, presetId: 'shell', cwd: '', autoStart: true, ...pos, ...extra } as CanvasNode
}
function note(id: string, file: string): CanvasNode {
  return { id, kind: 'note', file, ...pos }
}
function portal(id: string, url: string): CanvasNode {
  return { id, kind: 'portal', url, ...pos }
}
function edge(id: string, source: string, target: string): CanvasEdge {
  return { id, source, target }
}

function makeDoc(nodes: CanvasNode[], edges: CanvasEdge[]): WorkspaceDoc {
  return { version: 1, id: 'ws-1', name: 'teste', nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, floors: [] }
}

const doc = makeDoc(
  [
    term('t-con', 'construtor'),
    term('t-rev', 'Revisor'),
    term('t-tes', 'testador'),
    term('t-sol', 'solitario'),
    term('t-acc', 'Revisão'),
    note('n-spec', 'spec.md'),
    note('n-plan', 'planos/sprint-1.md'),
    note('n-sol', 'solta.md'),
    portal('p-docs', 'https://example.com'),
    { id: 's-1', kind: 'shape', shape: 'rect', text: '', color: '', ...pos }
  ],
  [
    edge('e1', 't-con', 't-rev'),
    edge('e2', 't-tes', 't-con'), // sentido inverso: conexões são bidirecionais
    edge('e3', 't-con', 'n-spec'),
    edge('e4', 'n-plan', 't-con'),
    edge('e5', 't-con', 'p-docs'),
    edge('e6', 't-con', 's-1'),
    edge('e7', 't-rev', 't-con') // duplicada no sentido oposto
  ]
)

function apiError(fn: () => unknown): ApiError {
  try {
    fn()
  } catch (err) {
    if (err instanceof ApiError) return err
    throw err
  }
  throw new Error('esperava ApiError')
}

describe('grafo de conexões', () => {
  it('vizinhos sem repetição, nos dois sentidos', () => {
    expect(neighbors(doc, 't-con')).toEqual(['t-rev', 't-tes', 'n-spec', 'n-plan', 'p-docs', 's-1'])
    expect(neighbors(doc, 't-rev')).toEqual(['t-con'])
    expect(neighbors(doc, 't-sol')).toEqual([])
  })

  it('areConnected vale nos dois sentidos e nunca para o próprio nó', () => {
    expect(areConnected(doc, 't-con', 't-tes')).toBe(true)
    expect(areConnected(doc, 't-tes', 't-con')).toBe(true)
    expect(areConnected(doc, 't-rev', 't-tes')).toBe(false)
    expect(areConnected(doc, 't-con', 't-con')).toBe(false)
    expect(findEdge(doc, 't-rev', 't-con')?.id).toBe('e1')
  })

  it('separa terminais, notas e portais conectados', () => {
    expect(connectedTerminals(doc, 't-con').map((t) => t.id)).toEqual(['t-rev', 't-tes'])
    expect(connectedNotes(doc, 't-con').map((n) => n.file)).toEqual(['spec.md', 'planos/sprint-1.md'])
    expect(connectedPortals(doc, 't-con').map((p) => p.id)).toEqual(['p-docs'])
    expect(terminalNodes(doc)).toHaveLength(5)
  })

  it('normaliza nomes sem acentos e sem maiúsculas', () => {
    expect(normalizeName('  RevisÃo  ')).toBe('revisao')
    expect(normalizeName('Ação')).toBe('acao')
  })
})

describe('resolveTerminalRef', () => {
  it('resolve por id, nome exato, sem maiúsculas e com "@"', () => {
    expect(resolveTerminalRef(doc, 't-tes').id).toBe('t-tes')
    expect(resolveTerminalRef(doc, 'Revisor').id).toBe('t-rev')
    expect(resolveTerminalRef(doc, 'REVISOR').id).toBe('t-rev')
    expect(resolveTerminalRef(doc, '@testador').id).toBe('t-tes')
    expect(resolveTerminalRef(doc, ' "construtor" ').id).toBe('t-con')
  })

  it('aceita nome sem acento quando não há ambiguidade', () => {
    expect(resolveTerminalRef(doc, 'revisao').id).toBe('t-acc')
    expect(resolveTerminalRef(doc, 'REVISÃO').id).toBe('t-acc')
  })

  it('não encontrado lista os terminais conectados ao chamador', () => {
    const err = apiError(() => resolveTerminalRef(doc, 'fantasma', { from: 't-con' }))
    expect(err.code).toBe('not_found')
    expect(err.message).toContain('"fantasma"')
    expect(err.message).toContain('"Revisor"')
    expect(err.message).toContain('"testador"')
    expect(err.message).not.toContain('solitario')
    const lonely = apiError(() => resolveTerminalRef(doc, 'x', { from: 't-sol' }))
    expect(lonely.message).toContain('Nenhum terminal está conectado a "solitario"')
  })

  it('nome ambíguo gera conflito', () => {
    const amb = makeDoc([term('a', 'Dev'), term('b', 'dev'), term('c', 'Dév')], [])
    expect(resolveTerminalRef(amb, 'Dev').id).toBe('a') // nome exato vence
    const err = apiError(() => resolveTerminalRef(makeDoc([term('a', 'Dev'), term('b', 'DEV')], []), 'dev'))
    expect(err.code).toBe('conflict')
    expect(err.message).toContain('"Dev"')
    expect(err.message).toContain('"DEV"')
  })

  it('referência vazia ou entre workspaces não casa', () => {
    expect(matchTerminals(doc, '   ')).toEqual([])
    const err = apiError(() => resolveTerminalRef(doc, 'revisor @ outro'))
    expect(err.code).toBe('not_found')
    expect(err.message).toContain('outro workspace')
  })
})

describe('resolveNoteRef', () => {
  it('resolve por id, arquivo, arquivo sem .md e nome do arquivo', () => {
    expect(resolveNoteRef(doc, 'n-spec').file).toBe('spec.md')
    expect(resolveNoteRef(doc, 'spec.md').id).toBe('n-spec')
    expect(resolveNoteRef(doc, 'SPEC').id).toBe('n-spec')
    expect(resolveNoteRef(doc, 'planos/sprint-1').id).toBe('n-plan')
    expect(resolveNoteRef(doc, 'sprint-1.md').id).toBe('n-plan')
    expect(resolveNoteRef(doc, 'planos\\sprint-1.md').id).toBe('n-plan')
    expect(resolveNoteRef(doc, '.maestrinho/notes/spec.md').id).toBe('n-spec')
  })

  it('não encontrada lista as notas conectadas', () => {
    const err = apiError(() => resolveNoteRef(doc, 'inexistente', { from: 't-con' }))
    expect(err.code).toBe('not_found')
    expect(err.message).toContain('"spec.md"')
    expect(err.message).toContain('"planos/sprint-1.md"')
    expect(err.message).not.toContain('solta.md')
  })

  it('nome de arquivo repetido em pastas diferentes é ambíguo', () => {
    const d = makeDoc([note('a', 'x/spec.md'), note('b', 'y/spec.md')], [])
    expect(matchNotes(d, 'spec')).toHaveLength(2)
    expect(apiError(() => resolveNoteRef(d, 'spec')).code).toBe('conflict')
    expect(resolveNoteRef(d, 'y/spec').id).toBe('b')
  })
})
