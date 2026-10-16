import { z } from 'zod'
import type { ApiMethod, ApiResults } from '@shared/api'

/**
 * Schemas das respostas da API local (o CLI valida todo JSON recebido). Cada schema é checado em
 * tempo de compilação contra a interface correspondente em @shared/api (tipo de `ResultSchemas`
 * abaixo): se o protocolo mudar, o build do CLI quebra em vez de falhar em produção.
 */

type ResultSchemaMap = { [M in ApiMethod]: z.ZodType<ApiResults[M]> }

/** Envelope `{ ok, result }` / `{ ok: false, error }`. */
export const EnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown().optional() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string().max(64), message: z.string().max(20_000).optional() })
  })
])

const Status = z.enum(['starting', 'running', 'exited', 'error', 'stopped'])
const Activity = z.enum(['idle', 'busy'])
const Empty = z.object({})

const PeerTerminal = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().nullable(),
  preset: z.string(),
  status: Status,
  activity: Activity,
  badge: z.string().optional(),
  waitingOn: z.string().optional(),
  manager: z.boolean().optional()
})

const NoteWrite = z.object({ id: z.string(), file: z.string(), revision: z.string() })

const BoardCard = z.object({
  seq: z.number(),
  title: z.string(),
  ticket: z.string(),
  column: z.string(),
  columnName: z.string(),
  assignee: z.string(),
  note: z.string().nullable(),
  updatedAt: z.string()
})
const BoardCardResult = z.object({ card: BoardCard })

export const ResultSchemas: ResultSchemaMap = {
  whoami: z.object({
    id: z.string(),
    name: z.string(),
    role: z.object({ id: z.string(), name: z.string(), instructions: z.string() }).nullable(),
    manager: z.boolean(),
    preset: z.object({ id: z.string(), label: z.string() }),
    workspace: z.object({ dir: z.string(), name: z.string() }),
    floor: z.object({ id: z.string(), name: z.string(), branch: z.string() }).nullable(),
    cwd: z.string(),
    peers: z.object({ terminals: z.number(), notes: z.number() })
  }),
  peers: z.object({
    terminals: z.array(PeerTerminal),
    notes: z.array(z.object({ id: z.string(), file: z.string() })),
    portals: z.array(z.object({ id: z.string(), url: z.string(), title: z.string().optional() }))
  }),
  send: z.object({ messageId: z.string().min(1).max(64), to: z.string(), delivered: z.literal(true) }),
  wait: z.object({
    done: z.boolean(),
    reason: z.enum(['idle', 'exited', 'cancelled']).optional(),
    output: z.string().optional(),
    to: z.string()
  }),
  read: z.object({ name: z.string(), text: z.string(), status: Status, activity: Activity }),
  'note.list': z.object({
    notes: z.array(z.object({ id: z.string(), file: z.string(), size: z.number(), mtimeMs: z.number() }))
  }),
  'note.read': z.object({ id: z.string(), file: z.string(), content: z.string(), revision: z.string() }),
  'portal.read': z.object({ id: z.string(), url: z.string(), title: z.string(), text: z.string(), truncated: z.boolean() }),
  'portal.print': z.object({ id: z.string(), url: z.string(), title: z.string(), file: z.string(), width: z.number(), height: z.number() }),
  'portal.open': z.object({ id: z.string(), url: z.string(), title: z.string() }),
  'note.write': NoteWrite,
  'note.append': NoteWrite,
  notify: Empty,
  status: Empty,
  recruit: z.object({
    id: z.string(),
    name: z.string(),
    preset: z.string(),
    role: z.string().nullable(),
    notes: z.array(z.string())
  }),
  dismiss: Empty,
  'role.list': z.object({
    roles: z.array(z.object({ id: z.string(), name: z.string(), instructions: z.string() }))
  }),
  'role.set': Empty,
  'role.edit': z.object({ role: z.object({ id: z.string(), name: z.string() }) }),
  connect: z.object({ edgeId: z.string(), a: z.string(), b: z.string() }),
  hook: Empty,
  'board.list': z.object({
    columns: z.array(z.object({ id: z.string(), name: z.string(), count: z.number() })),
    cards: z.array(BoardCard),
    hiddenDone: z.number()
  }),
  'board.show': BoardCard.extend({
    description: z.string(),
    createdBy: z.string(),
    createdAt: z.string(),
    log: z.array(z.object({ at: z.string(), by: z.string(), text: z.string() }))
  }),
  'board.add': BoardCardResult,
  'board.move': BoardCardResult,
  'board.update': BoardCardResult,
  'board.comment': BoardCardResult
}

/** Valida o resultado de um método; devolve o primeiro problema (caminho do campo) se não bater. */
export function parseResult<M extends ApiMethod>(
  method: M,
  raw: unknown
): { ok: true; value: ApiResults[M] } | { ok: false; path: string } {
  const schema: z.ZodType<ApiResults[M]> = ResultSchemas[method]
  const parsed = schema.safeParse(raw ?? {})
  if (parsed.success) return { ok: true, value: parsed.data }
  const issue = parsed.error.issues[0]
  return { ok: false, path: issue && issue.path.length > 0 ? issue.path.map(String).join('.') : '(raiz)' }
}
