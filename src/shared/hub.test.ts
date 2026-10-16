import { describe, expect, it } from 'vitest'
import { CatalogFileSchema, HubEntrySchema, catalogEntry, searchCatalog, type CatalogFile } from './hub'

const file: CatalogFile = CatalogFileSchema.parse({
  version: 1,
  name: 'Revisão em par',
  createdAt: '2026-10-01T00:00:00.000Z',
  nodes: [
    { id: 't-autor', kind: 'terminal', name: 'autor', presetId: 'claude', roleId: 'r-autor', position: { x: 100, y: 50 }, size: { w: 600, h: 420 } },
    { id: 't-rev', kind: 'terminal', name: 'revisor', presetId: 'codex', roleId: 'r-rev', position: { x: 760, y: 50 }, size: { w: 600, h: 420 } },
    { id: 't-rev2', kind: 'terminal', name: 'revisor2', presetId: 'codex', roleId: 'r-rev', position: { x: 760, y: 500 }, size: { w: 600, h: 420 } },
    { id: 'n-par', kind: 'note', file: 'par.md', position: { x: 100, y: 500 }, size: { w: 400, h: 300 } },
    { id: 's-titulo', kind: 'shape', shape: 'text', text: 'x'.repeat(200), position: { x: 100, y: 0 }, size: { w: 1200, h: 60 } }
  ],
  edges: [
    { id: 'e1', source: 't-autor', target: 't-rev' },
    { id: 'e2', source: 't-autor', target: 'sumiu' }
  ],
  roles: [
    { id: 'r-autor', name: 'Par - Autor', instructions: '', color: '#5b8def' },
    { id: 'r-rev', name: 'Par - Revisor', instructions: '' }
  ],
  notes: { 'par.md': '# Par\n' },
  hub: { id: 'revisao-em-par', description: 'Um escreve, outro revisa.', tags: ['revisão', 'código'], version: '1.0' }
})

describe('catalogEntry', () => {
  const entry = catalogEntry(file)

  it('resume a partitura no cartão e passa no schema', () => {
    expect(HubEntrySchema.safeParse(entry).success).toBe(true)
    expect(entry).toMatchObject({
      id: 'revisao-em-par',
      name: 'Revisão em par',
      description: 'Um escreve, outro revisa.',
      agents: 3,
      notes: ['par.md'],
      roles: ['Par - Autor', 'Par - Revisor'],
      presets: ['claude', 'codex'],
      version: '1.0',
      updatedAt: '2026-10-01T00:00:00.000Z'
    })
  })

  it('miniatura: posições a partir do canto do desenho, cor do papel e conexões por índice', () => {
    const [autor, , , , titulo] = entry.preview.nodes
    expect(autor).toMatchObject({ kind: 'terminal', x: 0, y: 50, label: 'autor', color: '#5b8def' })
    expect(titulo).toMatchObject({ kind: 'shape', x: 0, y: 0, color: '' })
    expect(titulo!.label).toHaveLength(80)
    // A conexão para um nó que não existe fica de fora.
    expect(entry.preview.edges).toEqual([[0, 1]])
  })
})

describe('searchCatalog', () => {
  const entries = [catalogEntry(file), { ...catalogEntry(file), id: 'outra', name: 'Esteira de QA', tags: ['playwright'], roles: [] }]

  it('sem texto devolve tudo', () => {
    expect(searchCatalog(entries, '  ')).toHaveLength(2)
  })

  it('ignora acento e maiúscula, e exige todas as palavras', () => {
    expect(searchCatalog(entries, 'REVISAO').map((e) => e.id)).toEqual(['revisao-em-par'])
    expect(searchCatalog(entries, 'playwright esteira').map((e) => e.id)).toEqual(['outra'])
    expect(searchCatalog(entries, 'playwright revisão')).toEqual([])
  })

  it('acha também por papel e preset', () => {
    expect(searchCatalog(entries, 'autor').map((e) => e.id)).toEqual(['revisao-em-par'])
    expect(searchCatalog(entries, 'codex')).toHaveLength(2)
  })
})

describe('CatalogFileSchema', () => {
  it('exige o texto do cartão com id válido', () => {
    const { hub: _hub, ...partitura } = file
    expect(CatalogFileSchema.safeParse(partitura).success).toBe(false)
    expect(CatalogFileSchema.safeParse({ ...file, hub: { id: '../x' } }).success).toBe(false)
  })
})
