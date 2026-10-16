import { z } from 'zod'
import { PartituraSchema } from './schemas'

/**
 * Partituras prontas: fluxos de agentes que vêm com o app (exemplos/partituras) para ajudar no começo.
 * Nada vem da rede. O painel mostra um cartão por partitura (HubEntry, calculado aqui a partir dela) e, ao
 * inserir, a partitura passa pelo mesmo caminho de qualquer outra (só id de preset, nunca linha de comando).
 */

export const HUB_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
/** Tipo do arrastar-e-soltar de um cartão do catálogo para o canvas. */
export const HUB_DRAG_TYPE = 'application/x-maestrinho-hub'

export const HubPreviewSchema = z.object({
  nodes: z
    .array(
      z.object({
        kind: z.string().max(20),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        label: z.string().max(80).default(''),
        color: z.string().max(16).default('')
      })
    )
    .max(500),
  edges: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(5000)
})
export type HubPreview = z.infer<typeof HubPreviewSchema>

export const HubEntrySchema = z.object({
  id: z.string().regex(HUB_ID_RE),
  name: z.string().min(1).max(120),
  description: z.string().max(600).default(''),
  tags: z.array(z.string().max(30)).max(12).default([]),
  author: z.string().max(80).default(''),
  version: z.string().max(20).default(''),
  updatedAt: z.string().max(40).default(''),
  agents: z.number().int().min(0),
  notes: z.array(z.string().max(200)).max(200).default([]),
  roles: z.array(z.string().max(60)).max(200).default([]),
  presets: z.array(z.string().max(64)).max(50).default([]),
  preview: HubPreviewSchema
})
export type HubEntry = z.infer<typeof HubEntrySchema>

export const HubPageSchema = z.object({
  items: z.array(HubEntrySchema).max(500),
  total: z.number().int().min(0)
})
export type HubPage = z.infer<typeof HubPageSchema>

/**
 * Arquivo do catálogo embutido (exemplos/partituras/<id>.json): uma partitura comum, com o texto do cartão
 * na chave `hub`. Importado pelo diálogo de partituras, o arquivo funciona igual (a chave é ignorada).
 */
export const CatalogFileSchema = PartituraSchema.extend({
  hub: z.object({
    id: z.string().regex(HUB_ID_RE),
    description: z.string().max(600).default(''),
    tags: z.array(z.string().max(30)).max(12).default([]),
    author: z.string().max(80).default(''),
    version: z.string().max(20).default('')
  })
})
export type CatalogFile = z.infer<typeof CatalogFileSchema>

const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))]

/** Cartão de uma partitura: quantos agentes, notas, papéis e presets ela traz, e a miniatura do desenho. */
export function catalogEntry(p: CatalogFile): HubEntry {
  const terminals = p.nodes.flatMap((n) => (n.kind === 'terminal' ? [n] : []))
  const roleById = new Map(p.roles.map((r) => [r.id, r]))
  const minX = p.nodes.length ? Math.min(...p.nodes.map((n) => n.position.x)) : 0
  const minY = p.nodes.length ? Math.min(...p.nodes.map((n) => n.position.y)) : 0
  const index = new Map(p.nodes.map((n, i) => [n.id, i]))
  const label = (n: (typeof p.nodes)[number]): string => {
    if (n.kind === 'terminal') return n.name
    if (n.kind === 'note') return n.file
    if (n.kind === 'portal') return n.title || n.url
    return n.text
  }
  return {
    id: p.hub.id,
    name: p.name,
    description: p.hub.description,
    tags: p.hub.tags,
    author: p.hub.author,
    version: p.hub.version,
    updatedAt: p.createdAt,
    agents: terminals.length,
    notes: uniq(p.nodes.flatMap((n) => (n.kind === 'note' ? [n.file] : []))),
    roles: uniq(terminals.map((t) => (t.roleId ? (roleById.get(t.roleId)?.name ?? '') : ''))),
    presets: uniq(terminals.map((t) => t.presetId)),
    preview: {
      nodes: p.nodes.map((n) => ({
        kind: n.kind,
        x: n.position.x - minX,
        y: n.position.y - minY,
        w: n.size.w,
        h: n.size.h,
        label: label(n).slice(0, 80),
        color: n.kind === 'terminal' && n.roleId ? (roleById.get(n.roleId)?.color ?? '') : ''
      })),
      edges: p.edges.flatMap((e) => {
        const a = index.get(e.source)
        const b = index.get(e.target)
        return a === undefined || b === undefined ? [] : [[a, b] as [number, number]]
      })
    }
  }
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Filtra pelo texto (sem diferenciar acento nem maiúscula): cada palavra precisa aparecer no cartão. */
export function searchCatalog(entries: readonly HubEntry[], q: string): HubEntry[] {
  const terms = fold(q).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...entries]
  return entries.filter((e) => {
    const text = fold([e.name, e.description, ...e.tags, ...e.roles, ...e.presets].join(' '))
    return terms.every((t) => text.includes(t))
  })
}
