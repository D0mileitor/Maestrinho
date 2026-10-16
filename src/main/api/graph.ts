import { ApiError } from '@shared/api'
import { CLI_NAME, NOTES_DIR, WORKSPACE_META_DIR } from '@shared/constants'
import type {
  CanvasEdge,
  CanvasNode,
  NoteNodeData,
  PortalNodeData,
  TerminalNodeData,
  WorkspaceDoc
} from '@shared/schemas'

/**
 * Consultas puras ao grafo de conexões do workspace. As conexões valem nos dois sentidos para fins
 * de permissão: um agente só alcança os nós ligados diretamente a ele.
 */

type GraphDoc = Pick<WorkspaceDoc, 'nodes' | 'edges'>

/** Normaliza nomes para comparação: sem acentos, sem diferenciar maiúsculas, sem espaços nas pontas. */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

/** Ids dos vizinhos diretos (sem repetição, na ordem das conexões). */
export function neighbors(doc: Pick<WorkspaceDoc, 'edges'>, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const e of doc.edges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null
    if (other === null || other === id || seen.has(other)) continue
    seen.add(other)
    out.push(other)
  }
  return out
}

/** Conexão entre `a` e `b`, em qualquer sentido. */
export function findEdge(doc: Pick<WorkspaceDoc, 'edges'>, a: string, b: string): CanvasEdge | undefined {
  if (a === b) return undefined
  return doc.edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))
}

export function areConnected(doc: Pick<WorkspaceDoc, 'edges'>, a: string, b: string): boolean {
  return findEdge(doc, a, b) !== undefined
}

export function nodeById(doc: Pick<WorkspaceDoc, 'nodes'>, id: string): CanvasNode | undefined {
  return doc.nodes.find((n) => n.id === id)
}

export function terminalNodes(doc: Pick<WorkspaceDoc, 'nodes'>): TerminalNodeData[] {
  return doc.nodes.filter((n): n is TerminalNodeData => n.kind === 'terminal')
}

export function noteNodes(doc: Pick<WorkspaceDoc, 'nodes'>): NoteNodeData[] {
  return doc.nodes.filter((n): n is NoteNodeData => n.kind === 'note')
}

export function portalNodes(doc: Pick<WorkspaceDoc, 'nodes'>): PortalNodeData[] {
  return doc.nodes.filter((n): n is PortalNodeData => n.kind === 'portal')
}

function connectedOf<T extends CanvasNode>(doc: GraphDoc, id: string, guard: (n: CanvasNode) => n is T): T[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const out: T[] = []
  for (const other of neighbors(doc, id)) {
    const node = byId.get(other)
    if (node && guard(node)) out.push(node)
  }
  return out
}

const isTerminal = (n: CanvasNode): n is TerminalNodeData => n.kind === 'terminal'
const isNote = (n: CanvasNode): n is NoteNodeData => n.kind === 'note'
const isPortal = (n: CanvasNode): n is PortalNodeData => n.kind === 'portal'

export function connectedTerminals(doc: GraphDoc, id: string): TerminalNodeData[] {
  return connectedOf(doc, id, isTerminal)
}

export function connectedNotes(doc: GraphDoc, id: string): NoteNodeData[] {
  return connectedOf(doc, id, isNote)
}

export function connectedPortals(doc: GraphDoc, id: string): PortalNodeData[] {
  return connectedOf(doc, id, isPortal)
}

// ------------------------------------------------------------------ resolução de referências

/** Limpa a referência digitada pelo agente: espaços, aspas e "@" inicial ("@revisor"). */
function cleanRef(ref: string): string {
  let r = ref.trim()
  if (r.length >= 2 && /^["'].*["']$/su.test(r)) r = r.slice(1, -1).trim()
  return r.replace(/^@+/, '').trim()
}

function quoteList(items: string[]): string {
  return items.map((s) => `"${s}"`).join(', ')
}

function displayName(doc: GraphDoc, id: string | undefined): string {
  if (!id) return 'este terminal'
  const n = nodeById(doc, id)
  return n && n.kind === 'terminal' ? `"${n.name}"` : 'este terminal'
}

/** Primeiro nível de correspondência não vazio (id > nome exato > sem maiúsculas > sem acentos). */
function firstTier<T>(tiers: (() => T[])[]): T[] {
  for (const tier of tiers) {
    const found = tier()
    if (found.length > 0) return found
  }
  return []
}

/** Terminais do documento que correspondem à referência (vazio = nenhum; mais de um = ambíguo). */
export function matchTerminals(doc: Pick<WorkspaceDoc, 'nodes'>, ref: string): TerminalNodeData[] {
  const r = cleanRef(ref)
  if (r === '') return []
  const terms = terminalNodes(doc)
  const lower = r.toLowerCase()
  const norm = normalizeName(r)
  return firstTier([
    () => terms.filter((t) => t.id === r),
    () => terms.filter((t) => t.name === r),
    () => terms.filter((t) => t.name.toLowerCase() === lower),
    () => terms.filter((t) => normalizeName(t.name) === norm)
  ])
}

/**
 * Resolve um terminal do workspace por id ou nome (sem diferenciar maiúsculas nem acentos).
 * Lança ApiError('not_found') com a lista dos terminais conectados a `from` (quando informado),
 * ou ApiError('conflict') se o nome for ambíguo.
 */
export function resolveTerminalRef(doc: GraphDoc, ref: string, opts: { from?: string } = {}): TerminalNodeData {
  const found = matchTerminals(doc, ref)
  if (found.length === 1) return found[0]!
  const r = cleanRef(ref)
  if (found.length > 1) {
    throw new ApiError(
      'conflict',
      `O nome "${r}" é ambíguo: corresponde aos terminais ${quoteList(found.map((t) => t.name))}. ` +
        `Use o id do terminal (veja \`${CLI_NAME} peers\`) ou peça ao usuário para renomear um deles.`
    )
  }
  const parts = [`Terminal "${r}" não encontrado neste workspace.`]
  if (r.includes('@')) parts.push('Conversar com terminais de outro workspace ("nome @ workspace") não é suportado.')
  if (opts.from) {
    const peers = connectedTerminals(doc, opts.from).map((t) => t.name)
    parts.push(
      peers.length > 0
        ? `Terminais conectados a ${displayName(doc, opts.from)}: ${quoteList(peers)}.`
        : `Nenhum terminal está conectado a ${displayName(doc, opts.from)} no canvas; peça ao usuário para conectar os terminais.`
    )
  }
  parts.push(`Use \`${CLI_NAME} peers\` para ver os nomes exatos.`)
  throw new ApiError('not_found', parts.join(' '))
}

const META_NOTES_PREFIX = `${WORKSPACE_META_DIR}/${NOTES_DIR}/`.toLowerCase()

/** Chave de comparação de notas: barras normalizadas, sem prefixo de pasta de notas e sem ".md". */
function noteKey(file: string): string {
  let f = file.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (f.toLowerCase().startsWith(META_NOTES_PREFIX)) f = f.slice(META_NOTES_PREFIX.length)
  return normalizeName(f).replace(/\.md$/, '')
}

function baseKey(file: string): string {
  const key = noteKey(file)
  const slash = key.lastIndexOf('/')
  return slash >= 0 ? key.slice(slash + 1) : key
}

/** Notas que correspondem à referência: id do nó, arquivo, arquivo sem ".md" ou só o nome do arquivo. */
export function matchNotes(doc: Pick<WorkspaceDoc, 'nodes'>, ref: string): NoteNodeData[] {
  const r = cleanRef(ref)
  if (r === '') return []
  const notes = noteNodes(doc)
  const key = noteKey(r)
  return firstTier([
    () => notes.filter((n) => n.id === r),
    () => notes.filter((n) => n.file === r),
    () => notes.filter((n) => noteKey(n.file) === key),
    () => (key.includes('/') ? [] : notes.filter((n) => baseKey(n.file) === key))
  ])
}

/**
 * Resolve uma nota do workspace por id do nó, arquivo ("spec.md") ou arquivo sem extensão ("spec"),
 * sem diferenciar maiúsculas. Lança ApiError('not_found') listando as notas conectadas a `from`,
 * ou ApiError('conflict') se a referência for ambígua.
 */
export function resolveNoteRef(doc: GraphDoc, ref: string, opts: { from?: string } = {}): NoteNodeData {
  const found = matchNotes(doc, ref)
  if (found.length === 1) return found[0]!
  const r = cleanRef(ref)
  if (found.length > 1) {
    throw new ApiError(
      'conflict',
      `A referência "${r}" é ambígua: corresponde às notas ${quoteList(found.map((n) => n.file))}. ` +
        'Use o caminho completo do arquivo da nota.'
    )
  }
  const parts = [`Nota "${r}" não encontrada neste workspace.`]
  if (opts.from) {
    const notes = connectedNotes(doc, opts.from).map((n) => n.file)
    parts.push(
      notes.length > 0
        ? `Notas conectadas a ${displayName(doc, opts.from)}: ${quoteList(notes)}.`
        : `Nenhuma nota está conectada a ${displayName(doc, opts.from)} no canvas; peça ao usuário para conectar a nota.`
    )
  }
  parts.push(`Use \`${CLI_NAME} note list\` para ver as notas disponíveis.`)
  throw new ApiError('not_found', parts.join(' '))
}

/** Nome com que um portal aparece para os agentes: o título, ou o endereço. */
export function portalLabel(p: PortalNodeData): string {
  return p.title?.trim() || p.url
}

/**
 * Portal conectado a `from` pela referência (id, título ou parte do endereço, sem acento e sem
 * maiúsculas). Sem referência, vale o único portal conectado. Erros explicam o que o agente pode fazer.
 */
export function resolvePortalRef(doc: GraphDoc, from: string, fromName: string, ref?: string): PortalNodeData {
  const list = connectedPortals(doc, from)
  const names = list.map((p) => `"${portalLabel(p)}"`).join(', ')
  if (list.length === 0) {
    throw new ApiError('not_found', `Nenhum portal conectado a "${fromName}". O usuário precisa ligar um portal a este terminal no canvas.`)
  }
  if (!ref) {
    if (list.length === 1) return list[0]!
    throw new ApiError('conflict', `Há ${list.length} portais conectados; diga qual com --portal: ${names}.`)
  }
  const q = normalizeName(ref)
  const exact = list.find((p) => p.id === ref || normalizeName(portalLabel(p)) === q || normalizeName(p.url) === q)
  if (exact) return exact
  const partial = list.filter((p) => normalizeName(portalLabel(p)).includes(q) || normalizeName(p.url).includes(q))
  if (partial.length === 1) return partial[0]!
  if (partial.length > 1) throw new ApiError('conflict', `"${ref}" corresponde a mais de um portal: ${partial.map((p) => `"${portalLabel(p)}"`).join(', ')}.`)
  throw new ApiError('not_found', `Nenhum portal conectado corresponde a "${ref}". Conectados: ${names}.`)
}
