import { z } from 'zod'

/**
 * Protocolo da API local usada pelo CLI `orq` (contrato entre src/cli e src/main/api).
 *
 * Transporte: HTTP/1.1 em 127.0.0.1:<ORQ_PORT>, `POST /v1/<método>` com corpo JSON (UTF-8).
 * Autenticação: `Authorization: Bearer <ORQ_TOKEN>` — token exclusivo do terminal que chama; a
 * identidade do chamador vem do token, nunca do corpo da requisição.
 * Resposta: 200 `{ "ok": true, "result": ... }` ou status de erro com
 * `{ "ok": false, "error": { "code": ApiErrorCode, "message": "texto em pt-BR para o agente" } }`.
 *
 * Regras do transporte (o servidor recusa o resto):
 *  - Host exatamente `127.0.0.1:<porta>` (ou `localhost:<porta>`); sem Origin nem Sec-Fetch-Site/Dest/User
 *    (o `sec-fetch-mode` que o fetch do Node envia é aceito; `node:http` não envia nenhum deles);
 *  - `Content-Type: application/json` (UTF-8) sempre, inclusive em métodos sem parâmetros (corpo `{}`);
 *  - corpo de até API_MAX_BODY_BYTES (constants.ts) — acima disso 413 e a conexão é fechada;
 *  - `send` pode segurar a resposta enquanto o destino termina de iniciar ou o usuário digita nele
 *    (até ~50 s); `wait` segura até `pollMs`. O cliente deve usar timeout HTTP >= 90 s.
 */

export const API_VERSION = 'v1'

export const ApiErrorCodeSchema = z.enum([
  'bad_request', // 400 payload inválido
  'unauthorized', // 401 token ausente/inválido
  'forbidden', // 403 sem conexão no canvas ou sem permissão (ex.: não é gerente)
  'not_found', // 404 peer/nota/papel/preset inexistente
  'timeout', // 408 tempo esgotado (ex.: --wait)
  'conflict', // 409 nome ambíguo/duplicado, nota travada
  'precondition', // 412 revisão da nota divergente (ifRevision)
  'too_large', // 413 corpo grande demais
  'rate_limited', // 429 excesso de mensagens numa conexão
  'unavailable', // 503 processo do destino não está rodando
  'internal' // 500
])
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  timeout: 408,
  conflict: 409,
  precondition: 412,
  too_large: 413,
  rate_limited: 429,
  unavailable: 503,
  internal: 500
}

export interface ApiErrorBody {
  ok: false
  error: { code: ApiErrorCode; message: string }
}
export interface ApiOkBody<T> {
  ok: true
  result: T
}

// ------------------------------------------------------------------ tipos de resultado

export interface PeerTerminal {
  id: string
  name: string
  role: string | null
  preset: string
  status: 'starting' | 'running' | 'exited' | 'error' | 'stopped'
  activity: 'idle' | 'busy'
  badge?: string
  waitingOn?: string
  manager?: boolean
}
export interface PeerNote {
  id: string
  file: string
}
export interface PeerPortal {
  id: string
  url: string
  title?: string
}

export interface WhoamiResult {
  id: string
  name: string
  role: { id: string; name: string; instructions: string } | null
  manager: boolean
  preset: { id: string; label: string }
  workspace: { dir: string; name: string }
  floor: { id: string; name: string; branch: string } | null
  cwd: string
  peers: { terminals: number; notes: number }
}

export interface PeersResult {
  terminals: PeerTerminal[]
  notes: PeerNote[]
  portals: PeerPortal[]
}

export interface SendResult {
  messageId: string
  to: string
  delivered: true
}

export interface WaitResult {
  done: boolean
  /** Motivo do término (quando done=true). */
  reason?: 'idle' | 'exited' | 'cancelled'
  /** Últimas linhas da tela do destino, sem ANSI (quando done=true). */
  output?: string
  to: string
}

export interface ReadResult {
  name: string
  text: string
  status: PeerTerminal['status']
  activity: PeerTerminal['activity']
}

export interface NoteListResult {
  notes: { id: string; file: string; size: number; mtimeMs: number }[]
}
/** Portal conectado lido por um agente (`orq portal read`). */
export interface PortalReadResult {
  id: string
  url: string
  title: string
  text: string
  /** O texto da página passou do limite e foi cortado. */
  truncated: boolean
}

/** Print de um portal salvo em arquivo (`orq portal print`). */
export interface PortalPrintResult {
  id: string
  url: string
  title: string
  /** Caminho absoluto do PNG. */
  file: string
  width: number
  height: number
}

export interface PortalOpenResult {
  id: string
  url: string
  title: string
}

export interface NoteReadResult {
  id: string
  file: string
  content: string
  /** 16 primeiros caracteres hex do SHA-256 do conteúdo (UTF-8). */
  revision: string
}
export interface NoteWriteResult {
  id: string
  file: string
  revision: string
}

export interface RecruitResult {
  id: string
  name: string
  preset: string
  role: string | null
  notes: string[]
}

/** Cartão do quadro de chamados, resumido (para `orq board`). */
export interface BoardCardSummary {
  seq: number
  title: string
  ticket: string
  column: string
  columnName: string
  assignee: string
  note: string | null
  updatedAt: string
}
export interface BoardListResult {
  columns: { id: string; name: string; count: number }[]
  cards: BoardCardSummary[]
  /** Cartões da última coluna (concluídos) que ficaram de fora (use all). */
  hiddenDone: number
}
export interface BoardShowResult extends BoardCardSummary {
  description: string
  createdBy: string
  createdAt: string
  log: { at: string; by: string; text: string }[]
}

export interface RoleListResult {
  roles: { id: string; name: string; instructions: string }[]
}

// ------------------------------------------------------------------ requisições

const PeerRef = z.string().min(1).max(80)
const NoteRef = z.string().min(1).max(200)
/** Portal pelo título, endereço ou id (opcional quando só há um portal conectado). */
const PortalRef = z.string().min(1).max(300)
const Text = z.string().max(200_000)
const CardRef = z.string().trim().min(1).max(200)
const ColumnRef = z.string().trim().min(1).max(40)
const HookWord = z.string().min(1).max(128).regex(/^[\w.:|-]+$/)

export const ApiRequestSchemas = {
  whoami: z.object({}).strict(),
  peers: z.object({}).strict(),
  send: z
    .object({
      to: PeerRef,
      text: Text.min(1, 'mensagem vazia'),
      /** Se true, o servidor já registra a espera (use `wait` com o messageId retornado). */
      wait: z.boolean().optional()
    })
    .strict(),
  wait: z
    .object({
      messageId: z.string().min(1).max(64),
      /** Long-poll: máximo que o servidor segura a requisição (ms). */
      pollMs: z.number().int().min(0).max(25_000).default(20_000),
      lines: z.number().int().min(1).max(2000).default(40),
      /** true = o cliente desistiu (timeout total); limpa o estado "aguardando". */
      cancel: z.boolean().optional()
    })
    .strict(),
  read: z
    .object({
      peer: PeerRef,
      lines: z.number().int().min(1).max(2000).default(50)
    })
    .strict(),
  'note.list': z.object({}).strict(),
  'portal.read': z.object({ portal: PortalRef.optional() }).strict(),
  'portal.print': z.object({ portal: PortalRef.optional() }).strict(),
  'portal.open': z
    .object({
      portal: PortalRef.optional(),
      url: z
        .string()
        .max(2048)
        .regex(/^https?:\/\/\S+$/i, 'o endereço precisa começar com http:// ou https://')
    })
    .strict(),
  'note.read': z.object({ note: NoteRef }).strict(),
  'note.write': z.object({ note: NoteRef, content: Text, ifRevision: z.string().max(64).optional() }).strict(),
  'note.append': z.object({ note: NoteRef, content: Text }).strict(),
  notify: z.object({ text: z.string().min(1).max(2000), title: z.string().max(200).optional() }).strict(),
  status: z.object({ text: z.string().max(200) }).strict(),
  recruit: z
    .object({
      name: z.string().min(1).max(40),
      agent: z.string().max(80).optional(),
      role: z.string().max(80).optional(),
      notes: z.array(NoteRef).max(20).default([]),
      floor: z.string().max(80).optional()
    })
    .strict(),
  dismiss: z.object({ name: PeerRef }).strict(),
  'role.list': z.object({}).strict(),
  'role.set': z.object({ name: PeerRef, role: z.string().min(1).max(80) }).strict(),
  'role.edit': z
    .object({
      role: z.string().min(1).max(80),
      instructions: z.string().max(32_000),
      /** Cria o papel se não existir. */
      create: z.boolean().optional()
    })
    .strict(),
  connect: z.object({ a: z.string().min(1).max(200), b: z.string().min(1).max(200) }).strict(),
  'board.list': z.object({ column: ColumnRef.optional(), mine: z.boolean().optional(), all: z.boolean().optional() }).strict(),
  'board.show': z.object({ card: CardRef }).strict(),
  'board.add': z
    .object({
      title: z.string().trim().min(1).max(200),
      column: ColumnRef.optional(),
      ticket: z.string().trim().max(40).optional(),
      note: z.string().trim().max(200).optional(),
      description: z.string().max(20_000).optional(),
      assignee: z.string().trim().max(40).optional()
    })
    .strict(),
  'board.move': z.object({ card: CardRef, column: ColumnRef, comment: z.string().max(500).optional() }).strict(),
  'board.update': z
    .object({
      card: CardRef,
      title: z.string().trim().min(1).max(200).optional(),
      ticket: z.string().trim().max(40).optional(),
      note: z.string().trim().max(200).optional(),
      description: z.string().max(20_000).optional(),
      assignee: z.string().trim().max(40).optional()
    })
    .strict(),
  'board.comment': z.object({ card: CardRef, text: z.string().trim().min(1).max(500) }).strict(),
  /** Uso interno (hooks do Claude Code): o agente avisa o próprio estado. Só metadados, nunca conteúdo. */
  hook: z
    .object({
      event: HookWord,
      kind: HookWord.optional(),
      tool: HookWord.optional(),
      /** Quando o hook disparou (ms desde a época), para descartar avisos assíncronos fora de ordem. */
      at: z.number().int().nonnegative()
    })
    .strict()
} as const

export type ApiMethod = keyof typeof ApiRequestSchemas
export type ApiRequest<M extends ApiMethod> = z.input<(typeof ApiRequestSchemas)[M]>
export type ApiParsedRequest<M extends ApiMethod> = z.output<(typeof ApiRequestSchemas)[M]>

export interface ApiResults {
  whoami: WhoamiResult
  peers: PeersResult
  send: SendResult
  wait: WaitResult
  read: ReadResult
  'note.list': NoteListResult
  'note.read': NoteReadResult
  'portal.read': PortalReadResult
  'portal.print': PortalPrintResult
  'portal.open': PortalOpenResult
  'note.write': NoteWriteResult
  'note.append': NoteWriteResult
  notify: Record<string, never>
  status: Record<string, never>
  recruit: RecruitResult
  dismiss: Record<string, never>
  'role.list': RoleListResult
  'role.set': Record<string, never>
  /** `restarted`: nomes dos recrutas do gerente que usam o papel e foram reiniciados para recebê-lo. */
  'role.edit': { role: { id: string; name: string }; restarted?: string[] }
  /** `existed`: true quando a conexão já existia (nada foi criado; `edgeId` é a conexão existente). */
  connect: { edgeId: string; a: string; b: string; existed?: boolean }
  hook: Record<string, never>
  'board.list': BoardListResult
  'board.show': BoardShowResult
  'board.add': { card: BoardCardSummary }
  'board.move': { card: BoardCardSummary }
  'board.update': { card: BoardCardSummary }
  'board.comment': { card: BoardCardSummary }
}

/** Métodos que exigem terminal com a flag de gerente. */
export const MANAGER_METHODS: readonly ApiMethod[] = ['recruit', 'dismiss', 'role.set', 'role.edit', 'connect']

export const API_METHODS = Object.keys(ApiRequestSchemas) as ApiMethod[]

/** Erro de API com código (lançado pelos handlers e convertido em resposta pelo servidor). */
export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
