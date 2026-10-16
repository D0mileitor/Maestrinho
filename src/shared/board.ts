import { z } from 'zod'
import { IdSchema, NoteFileSchema } from './schemas'
import { newId } from './ids'

/**
 * Quadro de chamados (kanban) do workspace, em .maestrinho/quadro.json. Você e os agentes (pelo
 * `orq board`) criam, movem e comentam cartões. Lógica pura: cada operação devolve um quadro novo.
 */

/** Histórico de cada cartão: só os últimos registros. */
export const BOARD_LOG_MAX = 60

const HexOrEmpty = z.string().regex(/^(#[0-9a-fA-F]{6})?$/)
const When = z.string().max(40)

export const BoardColumnSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(40),
  color: HexOrEmpty.default('')
})
export type BoardColumn = z.infer<typeof BoardColumnSchema>

export const BoardLogEntrySchema = z.object({
  at: When,
  /** Quem fez: "você" ou o nome do agente. */
  by: z.string().max(60),
  text: z.string().max(500)
})
export type BoardLogEntry = z.infer<typeof BoardLogEntrySchema>

export const BoardCardSchema = z.object({
  id: IdSchema,
  /** Número curto do cartão no quadro (#12): é como os agentes se referem a ele. */
  seq: z.number().int().min(1),
  title: z.string().trim().min(1).max(200),
  /** Número do chamado (ex.: 123456). */
  ticket: z.string().trim().max(40).default(''),
  column: IdSchema,
  /** Posição dentro da coluna (menor = mais acima). */
  order: z.number().finite().default(0),
  description: z.string().max(20_000).default(''),
  /** Nota ligada ao cartão (ex.: chamado-atual.md, historico/2026-10-07-123456.md). */
  note: NoteFileSchema.optional(),
  /** Nome do terminal responsável. */
  assignee: z.string().max(40).default(''),
  labels: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
  createdAt: When,
  updatedAt: When,
  createdBy: z.string().max(60).default('você'),
  log: z.array(BoardLogEntrySchema).max(BOARD_LOG_MAX).default([])
})
export type BoardCard = z.infer<typeof BoardCardSchema>

export const BoardFileSchema = z.object({
  version: z.literal(1),
  nextSeq: z.number().int().min(1).default(1),
  columns: z.array(BoardColumnSchema).min(1).max(12),
  cards: z.array(BoardCardSchema).max(2000).default([])
})
export type BoardFile = z.infer<typeof BoardFileSchema>

/** Colunas iniciais: o fluxo do chamado (arquitetura → dev → qa → sua validação → entrega → code review → doc). Editáveis. */
export function defaultBoard(): BoardFile {
  const cols: [string, string, string][] = [
    ['a-fazer', 'A fazer', '#8790a3'],
    ['arquitetura', 'Arquitetura', '#d4a849'],
    ['dev', 'Desenvolvimento', '#5fb98e'],
    ['qa', 'QA', '#c58ad6'],
    ['validacao', 'Sua validação', '#e0a33a'],
    ['entrega', 'Entrega', '#6f8fbf'],
    ['code-review', 'Code review', '#e5534b'],
    ['doc', 'Documentação', '#5fc0cc'],
    ['concluido', 'Concluído', '#46536d']
  ]
  return { version: 1, nextSeq: 1, columns: cols.map(([id, name, color]) => ({ id, name, color })), cards: [] }
}

/** Erro de uma operação do quadro, com mensagem em pt-BR que um agente entende. */
export class BoardError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'bad_request',
    message: string
  ) {
    super(message)
    this.name = 'BoardError'
  }
}

/** Sem acentos, minúsculas, espaços colapsados (para achar coluna/cartão pelo nome). */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim()
}

function columnsHint(board: BoardFile): string {
  return board.columns.map((c) => `"${c.name}" (${c.id})`).join(', ')
}

/** Acha a coluna pelo id, pelo nome (sem acentos/maiúsculas) ou pelo começo único do nome. */
export function resolveColumn(board: BoardFile, ref: string): BoardColumn {
  const r = ref.trim()
  const f = foldText(r)
  const found =
    board.columns.find((c) => c.id === r) ??
    board.columns.find((c) => foldText(c.id) === f || foldText(c.name) === f) ??
    (() => {
      const starts = board.columns.filter((c) => f !== '' && (foldText(c.name).startsWith(f) || foldText(c.id).startsWith(f)))
      return starts.length === 1 ? starts[0] : undefined
    })()
  if (!found) throw new BoardError('not_found', `Coluna "${r}" não existe no quadro. Colunas: ${columnsHint(board)}.`)
  return found
}

/**
 * Acha o cartão: "#12" ou "12" (número do cartão), número do chamado, id, ou parte do título (se for
 * única entre os cartões).
 */
export function resolveCard(board: BoardFile, ref: string): BoardCard {
  const r = ref.trim()
  const seq = /^#?(\d{1,6})$/.exec(r)
  if (seq) {
    const n = Number(seq[1])
    const bySeq = board.cards.find((c) => c.seq === n)
    if (bySeq && r.startsWith('#')) return bySeq
    const byTicket = board.cards.filter((c) => c.ticket === r)
    // "123456" é mais provável ser o número do chamado; "12" o número do cartão.
    if (byTicket.length === 1) return byTicket[0]!
    if (bySeq) return bySeq
  }
  const exact = board.cards.find((c) => c.id === r || (c.ticket !== '' && c.ticket === r.replace(/^#/, '')))
  if (exact) return exact
  const f = foldText(r)
  const byTitle = f.length >= 3 ? board.cards.filter((c) => foldText(c.title).includes(f)) : []
  if (byTitle.length === 1) return byTitle[0]!
  if (byTitle.length > 1) {
    const opts = byTitle.slice(0, 6).map((c) => `#${c.seq} "${c.title}"`).join(', ')
    throw new BoardError('conflict', `"${r}" corresponde a mais de um cartão: ${opts}. Use o número do cartão (ex.: #${byTitle[0]!.seq}).`)
  }
  throw new BoardError('not_found', `Cartão "${r}" não encontrado no quadro. Veja os cartões com \`orq board list\`.`)
}

function pushLog(card: BoardCard, entry: BoardLogEntry): BoardLogEntry[] {
  const log = [...card.log, { ...entry, text: entry.text.slice(0, 500) }]
  return log.length > BOARD_LOG_MAX ? log.slice(log.length - BOARD_LOG_MAX) : log
}

function nextOrder(board: BoardFile, column: string, exceptId?: string): number {
  const orders = board.cards.filter((c) => c.column === column && c.id !== exceptId).map((c) => c.order)
  return orders.length ? Math.max(...orders) + 1 : 0
}

export interface NewCardInput {
  title: string
  column?: string
  ticket?: string
  description?: string
  note?: string
  assignee?: string
  labels?: string[]
}

function checkNote(note: string | undefined): string | undefined {
  if (note === undefined || note.trim() === '') return undefined
  const parsed = NoteFileSchema.safeParse(note.trim())
  if (!parsed.success) throw new BoardError('bad_request', `Nota inválida "${note}": use o nome do arquivo .md (ex.: chamado-atual.md).`)
  return parsed.data
}

export function addCard(board: BoardFile, input: NewCardInput, by: string, now: string): { board: BoardFile; card: BoardCard } {
  const column = input.column?.trim() ? resolveColumn(board, input.column) : board.columns[0]!
  const ticket = (input.ticket ?? '').trim()
  // Um chamado já concluído (última coluna) pode voltar como cartão novo; em andamento, não duplica.
  const done = board.columns[board.columns.length - 1]!.id
  const dup = ticket ? board.cards.find((c) => c.ticket === ticket && c.column !== done) : undefined
  if (dup) {
    throw new BoardError('conflict', `Já existe o cartão #${dup.seq} para o chamado ${ticket} ("${dup.title}"). Mova ou atualize esse cartão.`)
  }
  const draft = {
    id: newId('c'),
    seq: board.nextSeq,
    title: input.title,
    ticket,
    column: column.id,
    order: nextOrder(board, column.id),
    description: input.description ?? '',
    note: checkNote(input.note),
    assignee: (input.assignee ?? '').trim(),
    labels: input.labels ?? [],
    createdAt: now,
    updatedAt: now,
    createdBy: by,
    log: [{ at: now, by, text: `criou em "${column.name}"` }]
  }
  const parsed = BoardCardSchema.safeParse(draft)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new BoardError('bad_request', `Cartão inválido (${issue?.path.join('.') || 'campo'}): ${issue?.message ?? 'formato inválido'}.`)
  }
  const card = parsed.data
  return { board: { ...board, nextSeq: board.nextSeq + 1, cards: [...board.cards, card] }, card }
}

function replaceCard(board: BoardFile, card: BoardCard): BoardFile {
  return { ...board, cards: board.cards.map((c) => (c.id === card.id ? card : c)) }
}

/** Move para a coluna (no fim, ou na posição `index` entre os cartões dela). */
export function moveCard(
  board: BoardFile,
  ref: string,
  columnRef: string,
  by: string,
  now: string,
  opts: { index?: number; comment?: string } = {}
): { board: BoardFile; card: BoardCard } {
  const card = resolveCard(board, ref)
  const column = resolveColumn(board, columnRef)
  const from = board.columns.find((c) => c.id === card.column)
  let order: number
  const others = board.cards.filter((c) => c.column === column.id && c.id !== card.id).sort((a, b) => a.order - b.order)
  if (opts.index === undefined || opts.index >= others.length) order = nextOrder(board, column.id, card.id)
  else if (opts.index <= 0) order = (others[0]?.order ?? 0) - 1
  else order = (others[opts.index - 1]!.order + others[opts.index]!.order) / 2
  let log = card.log
  if (card.column !== column.id) log = pushLog({ ...card, log }, { at: now, by, text: `moveu de "${from?.name ?? card.column}" para "${column.name}"` })
  const comment = opts.comment?.trim()
  if (comment) log = pushLog({ ...card, log }, { at: now, by, text: comment })
  const next: BoardCard = { ...card, column: column.id, order, updatedAt: card.column !== column.id || comment ? now : card.updatedAt, log }
  return { board: replaceCard(board, next), card: next }
}

export interface CardPatch {
  title?: string
  ticket?: string
  description?: string
  /** "" remove a nota. */
  note?: string
  assignee?: string
  labels?: string[]
}

export function updateCard(board: BoardFile, ref: string, patch: CardPatch, by: string, now: string): { board: BoardFile; card: BoardCard } {
  const card = resolveCard(board, ref)
  const changed: string[] = []
  const next: BoardCard = { ...card }
  if (patch.title !== undefined && patch.title.trim() !== card.title) {
    next.title = patch.title.trim()
    changed.push('título')
  }
  if (patch.ticket !== undefined && patch.ticket.trim() !== card.ticket) {
    next.ticket = patch.ticket.trim()
    changed.push('chamado')
  }
  if (patch.description !== undefined && patch.description !== card.description) {
    next.description = patch.description
    changed.push('descrição')
  }
  if (patch.note !== undefined && (checkNote(patch.note) ?? '') !== (card.note ?? '')) {
    const note = checkNote(patch.note)
    if (note) next.note = note
    else delete next.note
    changed.push(note ? `nota ${note}` : 'nota removida')
  }
  if (patch.assignee !== undefined && patch.assignee.trim() !== card.assignee) {
    next.assignee = patch.assignee.trim()
    changed.push(next.assignee ? `responsável ${next.assignee}` : 'sem responsável')
  }
  if (patch.labels !== undefined) {
    next.labels = patch.labels
    changed.push('etiquetas')
  }
  if (changed.length === 0) return { board, card }
  next.updatedAt = now
  next.log = pushLog(next, { at: now, by, text: `alterou ${changed.join(', ')}` })
  const parsed = BoardCardSchema.safeParse(next)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new BoardError('bad_request', `Alteração inválida (${issue?.path.join('.') || 'campo'}): ${issue?.message ?? 'formato inválido'}.`)
  }
  return { board: replaceCard(board, parsed.data), card: parsed.data }
}

export function commentCard(board: BoardFile, ref: string, text: string, by: string, now: string): { board: BoardFile; card: BoardCard } {
  const card = resolveCard(board, ref)
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) throw new BoardError('bad_request', 'O comentário está vazio.')
  const next: BoardCard = { ...card, updatedAt: now, log: pushLog(card, { at: now, by, text: clean }) }
  return { board: replaceCard(board, next), card: next }
}

export function removeCard(board: BoardFile, id: string): BoardFile {
  return { ...board, cards: board.cards.filter((c) => c.id !== id) }
}

/**
 * Troca as colunas (renomear, reordenar, criar, excluir). Cartões de uma coluna excluída vão para a
 * primeira coluna da lista nova (nada se perde).
 */
export function setColumns(board: BoardFile, columns: BoardColumn[]): BoardFile {
  const parsed = z.array(BoardColumnSchema).min(1).max(12).safeParse(columns)
  if (!parsed.success) throw new BoardError('bad_request', 'O quadro precisa ter de 1 a 12 colunas com nome.')
  const ids = new Set<string>()
  for (const c of parsed.data) {
    if (ids.has(c.id)) throw new BoardError('bad_request', `Coluna repetida: ${c.id}.`)
    ids.add(c.id)
  }
  const first = parsed.data[0]!.id
  const cards = board.cards.map((c) => (ids.has(c.column) ? c : { ...c, column: first, order: c.order + 10_000 }))
  return { ...board, columns: parsed.data, cards }
}

/** Cartões de uma coluna na ordem de exibição. */
export function cardsOf(board: BoardFile, column: string): BoardCard[] {
  return board.cards.filter((c) => c.column === column).sort((a, b) => a.order - b.order || a.seq - b.seq)
}

/** Lê o arquivo do quadro com tolerância: inválido ou ausente vira o quadro padrão. */
export function parseBoard(raw: unknown): BoardFile {
  const parsed = BoardFileSchema.safeParse(raw)
  if (!parsed.success) return defaultBoard()
  const board = parsed.data
  // Cartões em colunas que não existem mais vão para a primeira (arquivo editado à mão).
  const ids = new Set(board.columns.map((c) => c.id))
  const first = board.columns[0]!.id
  const maxSeq = board.cards.reduce((m, c) => Math.max(m, c.seq), 0)
  return {
    ...board,
    nextSeq: Math.max(board.nextSeq, maxSeq + 1),
    cards: board.cards.map((c) => (ids.has(c.column) ? c : { ...c, column: first }))
  }
}

// ------------------------------------------------------------------ ações da interface (IPC)

const Short = (max: number): z.ZodString => z.string().max(max)

export const CardPatchSchema = z
  .object({
    title: Short(200).optional(),
    ticket: Short(40).optional(),
    description: Short(20_000).optional(),
    note: Short(200).optional(),
    assignee: Short(40).optional(),
    labels: z.array(z.string().trim().min(1).max(24)).max(8).optional()
  })
  .strict()

export const BoardActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add'),
    title: z.string().trim().min(1).max(200),
    column: Short(40).optional(),
    ticket: Short(40).optional(),
    description: Short(20_000).optional(),
    note: Short(200).optional(),
    assignee: Short(40).optional()
  }),
  z.object({ type: z.literal('move'), id: IdSchema, column: IdSchema, index: z.number().int().min(0).max(5000).optional() }),
  z.object({ type: z.literal('update'), id: IdSchema, patch: CardPatchSchema }),
  z.object({ type: z.literal('comment'), id: IdSchema, text: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal('remove'), id: IdSchema }),
  z.object({ type: z.literal('columns'), columns: z.array(BoardColumnSchema).min(1).max(12) })
])
export type BoardAction = z.infer<typeof BoardActionSchema>

/** Aplica uma ação da interface (o autor é sempre "você"). */
export function applyBoardAction(board: BoardFile, action: BoardAction, now: string): BoardFile {
  const by = 'você'
  switch (action.type) {
    case 'add': {
      const { type: _t, ...input } = action
      void _t
      return addCard(board, input, by, now).board
    }
    case 'move':
      return moveCard(board, action.id, action.column, by, now, { index: action.index }).board
    case 'update':
      return updateCard(board, action.id, action.patch, by, now).board
    case 'comment':
      return commentCard(board, action.id, action.text, by, now).board
    case 'remove':
      return removeCard(board, action.id)
    case 'columns':
      return setColumns(board, action.columns)
  }
}

/**
 * Texto entregue ao agente quando você passa um cartão para ele (digitado no terminal, como se fosse
 * você). Diz o que é, onde estão os detalhes e como mover o cartão depois.
 */
export function assignmentMessage(board: BoardFile, card: BoardCard, cli: string): string {
  const col = board.columns.find((c) => c.id === card.column)
  const where = [card.ticket ? `chamado ${card.ticket}` : '', `coluna "${col?.name ?? card.column}"`].filter(Boolean).join(', ')
  const ref = card.ticket || `#${card.seq}`
  const lines = [`[Quadro de chamados] Passei para você o cartão #${card.seq} "${card.title}" (${where}).`]
  const desc = card.description.trim()
  if (desc) lines.push(desc)
  if (card.note) lines.push(`Detalhes na nota ${card.note} (arquivo .maestrinho/notes/${card.note}).`)
  lines.push(
    `Quando o chamado avançar, mova o cartão: ${cli} board move ${ref} <coluna> (colunas: ${board.columns.map((c) => c.id).join(', ')}).`
  )
  return lines.join('\n')
}
