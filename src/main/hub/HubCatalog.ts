import { CatalogFileSchema, catalogEntry, searchCatalog, type HubEntry, type HubPage } from '@shared/hub'
import { PartituraSchema, type Partitura } from '@shared/schemas'
import { log } from '../util/log'
import { CATALOG_FILES } from './catalogFiles'

/**
 * Partituras prontas que vêm com o app (exemplos/partituras): o painel lista, busca e insere no canvas.
 * Nada vem da rede. Cada arquivo passa pelo schema ao carregar; um inválido fica de fora (e o teste do
 * catálogo falha antes de ele chegar a um build).
 */
export class HubCatalog {
  private readonly entries: HubEntry[] = []
  private readonly partituras = new Map<string, Partitura>()

  constructor(files: Readonly<Record<string, unknown>> = CATALOG_FILES) {
    for (const [file, raw] of Object.entries(files)) {
      const parsed = CatalogFileSchema.safeParse(raw)
      if (!parsed.success || this.partituras.has(parsed.data.hub.id)) {
        log.warn('catálogo: partitura inválida ou repetida, ignorada', { file: file.split('/').pop() })
        continue
      }
      this.entries.push(catalogEntry(parsed.data))
      // Sem a chave `hub`: daqui em diante é uma partitura como qualquer outra.
      this.partituras.set(parsed.data.hub.id, PartituraSchema.parse(parsed.data))
    }
    this.entries.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }

  list(q: string): HubPage {
    const items = searchCatalog(this.entries, q)
    return { items, total: items.length }
  }

  partitura(id: string): Partitura {
    const p = this.partituras.get(id)
    if (!p) throw new Error(`a partitura "${id}" não existe no catálogo`)
    return structuredClone(p)
  }
}
