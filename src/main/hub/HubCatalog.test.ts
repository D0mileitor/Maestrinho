import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CatalogFileSchema } from '@shared/hub'
import { builtinPresets } from '../store/defaults'
import { CATALOG_FILES } from './catalogFiles'
import { HubCatalog } from './HubCatalog'

const DIR = path.resolve(__dirname, '../../../exemplos/partituras')
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))

describe('arquivos de exemplos/partituras', () => {
  it('todos entram no bundle', () => {
    expect(files.length).toBeGreaterThan(0)
    expect(Object.keys(CATALOG_FILES).map((k) => path.basename(k)).sort()).toEqual([...files].sort())
  })

  describe.each(files)('%s', (file) => {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')) as unknown

    it('passa no schema e o id do cartão é o nome do arquivo', () => {
      const parsed = CatalogFileSchema.safeParse(raw)
      expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues[0])).toBe(true)
      expect(`${CatalogFileSchema.parse(raw).hub.id}.json`).toBe(file)
    })

    it('conexões, papéis e notas apontam para o que existe; nomes de terminal únicos; presets de fábrica', () => {
      const p = CatalogFileSchema.parse(raw)
      const presets = new Set(builtinPresets().map((x) => x.id))
      const ids = new Set(p.nodes.map((n) => n.id))
      expect(ids.size).toBe(p.nodes.length)
      expect(new Set(p.edges.map((e) => e.id)).size).toBe(p.edges.length)
      for (const e of p.edges) {
        expect(ids.has(e.source), `${e.id}: origem ${e.source}`).toBe(true)
        expect(ids.has(e.target), `${e.id}: destino ${e.target}`).toBe(true)
      }
      const roleIds = new Set(p.roles.map((r) => r.id))
      const names = new Set<string>()
      for (const n of p.nodes) {
        if (n.kind === 'terminal') {
          if (n.roleId) expect(roleIds.has(n.roleId), `${n.name}: papel ${n.roleId}`).toBe(true)
          expect(presets.has(n.presetId), `${n.name}: preset ${n.presetId}`).toBe(true)
          expect(names.has(n.name)).toBe(false)
          names.add(n.name)
        }
        if (n.kind === 'note') expect(p.notes[n.file], `nota ${n.file}`).toBeDefined()
      }
    })
  })
})

describe('HubCatalog', () => {
  it('lista o catálogo embutido em ordem de nome e busca pelo texto', () => {
    const catalog = new HubCatalog()
    const all = catalog.list('')
    expect(all.total).toBe(files.length)
    const names = all.items.map((e) => e.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt-BR')))
    const found = catalog.list('esteira')
    expect(found.items.map((e) => e.id)).toContain('esteira-dev-qa-doc')
    expect(found.total).toBeLessThan(all.total)
  })

  it('entrega a partitura sem a chave do cartão, e uma cópia a cada vez', () => {
    const catalog = new HubCatalog()
    const p = catalog.partitura('esteira-dev-qa-doc')
    expect('hub' in p).toBe(false)
    p.name = 'mexido'
    expect(catalog.partitura('esteira-dev-qa-doc').name).not.toBe('mexido')
    expect(() => catalog.partitura('nao-existe')).toThrow(/não existe/)
  })

  it('ignora arquivo inválido ou com id repetido', () => {
    const raw = CATALOG_FILES[Object.keys(CATALOG_FILES)[0]!]
    const catalog = new HubCatalog({ 'a.json': raw, 'b.json': raw, 'c.json': { version: 1 } })
    expect(catalog.list('').total).toBe(1)
  })
})
