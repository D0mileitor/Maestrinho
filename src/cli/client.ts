import * as http from 'node:http'
import { z } from 'zod'
import {
  API_ERROR_STATUS,
  API_VERSION,
  ApiErrorCodeSchema,
  ApiRequestSchemas,
  type ApiErrorCode,
  type ApiMethod,
  type ApiRequest
} from '@shared/api'
import { APP_NAME, ENV } from '@shared/constants'
import { ApiCallError, CliError, TOO_LARGE_NOTE_HINT, TOO_LARGE_TEXT_HINT, oneLine } from './errors'
import { fmtDuration } from './format'
import { interruptedError } from './io'
import { EnvelopeSchema } from './results'

/** Tempo máximo de uma requisição comum. */
export const REQUEST_TIMEOUT_MS = 30_000
/** Folga somada ao long-poll de `wait` (o servidor segura a requisição por até pollMs). */
export const WAIT_GRACE_MS = 15_000
/** Teto do corpo de resposta aceito (protege a memória contra respostas absurdas). */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

export type Env = Readonly<Record<string, string | undefined>>

export interface ApiSession {
  port: number
  /** Token do terminal. NUNCA exibir nem registrar. */
  token: string
}

/** Lê porta e token do ambiente do terminal (ORQ_PORT, ORQ_TOKEN ou ORQ_SESSION). */
export function sessionFromEnv(env: Env): ApiSession {
  const portRaw = env[ENV.port]?.trim() ?? ''
  const token = (env[ENV.token]?.trim() || env[ENV.session]?.trim()) ?? ''
  if (portRaw === '' || token === '') {
    const missing = [portRaw === '' ? ENV.port : null, token === '' ? `${ENV.token}/${ENV.session}` : null]
    throw new CliError(
      'not_in_terminal',
      `este comando só funciona dentro de um terminal do ${APP_NAME}.`,
      `variáveis ausentes: ${missing.filter((m) => m !== null).join(', ')}.`
    )
  }
  const port = /^\d{1,5}$/.test(portRaw) ? Number(portRaw) : NaN
  if (!(port >= 1 && port <= 65535)) {
    throw new CliError(
      'not_in_terminal',
      `a variável ${ENV.port} é inválida; ela é definida pelo ${APP_NAME} em cada terminal.`
    )
  }
  // Só caracteres visíveis de ASCII: qualquer outra coisa quebraria o header (e indica ambiente adulterado).
  if (!/^[\x21-\x7e]{8,512}$/.test(token)) {
    throw new CliError(
      'not_in_terminal',
      `o token do terminal (${ENV.token}) é inválido; reinicie este terminal no ${APP_NAME}.`
    )
  }
  return { port, token }
}

export interface CallOptions {
  /** Tempo máximo da requisição inteira (padrão REQUEST_TIMEOUT_MS). */
  timeoutMs?: number
  signal?: AbortSignal
}

interface RawResponse {
  status: number
  body: Buffer
}

/**
 * Status HTTP que têm significado inequívoco mesmo sem o envelope JSON (ex.: corpo recusado antes
 * de ser lido). 400/404/500 sem envelope ficam como "resposta inesperada": podem vir de outro
 * programa escutando a porta.
 */
const UNAMBIGUOUS: readonly ApiErrorCode[] = ['unauthorized', 'forbidden', 'too_large', 'rate_limited']
const STATUS_TO_CODE = new Map<number, ApiErrorCode>(UNAMBIGUOUS.map((code) => [API_ERROR_STATUS[code], code]))

/**
 * Rótulos dos campos do protocolo nas mensagens de validação local. Todos no singular: as
 * mensagens usam verbos/locuções que concordam com qualquer gênero ("excede", "em branco").
 */
const FIELD_LABELS: Record<string, string> = {
  'send.text': 'a mensagem',
  'notify.text': 'o texto da notificação',
  'status.text': 'o texto do status',
  'note.write.content': 'o conteúdo da nota',
  'note.append.content': 'o texto a anexar',
  'role.edit.instructions': 'o texto das instruções',
  to: 'o nome do destino',
  peer: 'o nome do peer',
  note: 'o nome da nota',
  notes: '--note',
  lines: '--lines',
  ifRevision: '--if-revision',
  title: '--title',
  name: 'o nome',
  agent: '--agent',
  role: 'o papel',
  floor: '--floor',
  a: 'o primeiro nó',
  b: 'o segundo nó'
}

let ptBRErrors: z.core.$ZodErrorMap | undefined

/** Mensagens padrão do zod em pt-BR (montadas só quando alguma validação falha). */
function localeErrors(): z.core.$ZodErrorMap {
  return (ptBRErrors ??= z.locales.ptBR().localeError)
}

function fieldLabel(method: ApiMethod, field: string): string {
  return FIELD_LABELS[`${method}.${field}`] ?? FIELD_LABELS[field] ?? `o campo "${field}"`
}

function fmtInt(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function valueAt(body: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = body
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<PropertyKey, unknown>)[key]
  }
  return cur
}

/** Traduz o primeiro problema de validação local num erro claro (limites de tamanho → código 7). */
export function requestIssueError(method: ApiMethod, issue: z.core.$ZodIssue, body: unknown): CliError {
  const field = issue.path.map(String).join('.')
  const label = fieldLabel(method, field)
  if (issue.code === 'too_big' && issue.origin === 'string') {
    const value = valueAt(body, issue.path)
    const size = typeof value === 'string' ? `${fmtInt(value.length)} caracteres` : 'tamanho'
    const hint = method.startsWith('note.') ? TOO_LARGE_NOTE_HINT : method === 'send' ? TOO_LARGE_TEXT_HINT : undefined
    return new CliError('too_large', `${label} excede o limite: ${size} (máximo ${fmtInt(Number(issue.maximum))}).`, hint)
  }
  if (issue.code === 'too_big' && issue.origin === 'array') {
    return new CliError('usage', `${label}: no máximo ${fmtInt(Number(issue.maximum))} itens.`)
  }
  if (issue.code === 'too_small' && issue.origin === 'string') {
    return new CliError('usage', `${label} não pode ficar em branco.`)
  }
  if (issue.code === 'too_big' && issue.origin === 'number') {
    return new CliError('usage', `${label} deve ser no máximo ${fmtInt(Number(issue.maximum))}.`)
  }
  if (issue.code === 'too_small' && issue.origin === 'number') {
    return new CliError('usage', `${label} deve ser no mínimo ${fmtInt(Number(issue.minimum))}.`)
  }
  return new CliError('usage', `valor inválido para ${label}: ${issue.message}.`)
}

/**
 * Cliente da API local: `POST http://127.0.0.1:<porta>/v1/<método>` com `Authorization: Bearer`.
 * Uma conexão por requisição (sem keep-alive): evita corrida com o servidor fechando sockets
 * ociosos e deixa o processo terminar assim que a resposta chega.
 */
export class ApiClient {
  constructor(
    private readonly session: ApiSession,
    private readonly host = '127.0.0.1'
  ) {}

  get port(): number {
    return this.session.port
  }

  /**
   * Chama um método. Valida o corpo com o schema do protocolo antes de enviar e o envelope da
   * resposta; devolve o `result` cru (o chamador valida o formato com ResultSchemas).
   */
  async call<M extends ApiMethod>(method: M, body: ApiRequest<M>, opts: CallOptions = {}): Promise<unknown> {
    const schema: z.ZodType = ApiRequestSchemas[method]
    const checked = schema.safeParse(body, { error: (issue) => localeErrors()(issue) })
    if (!checked.success) {
      const issue = checked.error.issues[0]
      throw issue ? requestIssueError(method, issue, body) : new CliError('usage', `parâmetros inválidos para "${method}".`)
    }
    const res = await this.post(`/${API_VERSION}/${method}`, JSON.stringify(body), opts)
    return this.unwrap(res)
  }

  private unwrap(res: RawResponse): unknown {
    let json: unknown
    try {
      json = JSON.parse(res.body.toString('utf8'))
    } catch {
      json = undefined
    }
    const env = EnvelopeSchema.safeParse(json)
    if (!env.success) {
      const code = res.status >= 400 ? STATUS_TO_CODE.get(res.status) : undefined
      if (code) throw new ApiCallError(code, `o ${APP_NAME} recusou o pedido (HTTP ${res.status}).`)
      throw new CliError(
        'bad_response',
        `resposta inesperada na porta ${this.session.port} (HTTP ${res.status}); é mesmo o ${APP_NAME}?`
      )
    }
    if (env.data.ok) return env.data.result ?? {}
    const known = ApiErrorCodeSchema.safeParse(env.data.error.code)
    const code: ApiErrorCode = known.success ? known.data : 'internal'
    const message =
      oneLine(env.data.error.message ?? '') || `o ${APP_NAME} recusou o pedido (${oneLine(env.data.error.code)}).`
    throw new ApiCallError(code, message)
  }

  private post(path: string, payload: string, opts: CallOptions): Promise<RawResponse> {
    const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS
    const { signal } = opts
    const data = Buffer.from(payload, 'utf8')
    const port = this.session.port
    return new Promise<RawResponse>((resolve, reject) => {
      if (signal?.aborted) {
        reject(interruptedError())
        return
      }
      let settled = false
      // Motivo de um cancelamento nosso (tempo, tamanho, Ctrl+C): prevalece sobre o erro genérico
      // de socket que o Node emite em seguida, qualquer que seja a ordem dos eventos.
      let killedBy: CliError | null = null
      const kill = (reason: CliError): void => {
        killedBy ??= reason
        req.destroy(reason)
      }
      const settle = (err: unknown, value?: RawResponse): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (killedBy) reject(killedBy)
        else if (err || !value) reject(networkError(err, port))
        else resolve(value)
      }
      const req = http.request(
        {
          host: this.host,
          port,
          path,
          method: 'POST',
          agent: false,
          headers: {
            Authorization: `Bearer ${this.session.token}`,
            'Content-Type': 'application/json',
            'Content-Length': String(data.length),
            Accept: 'application/json',
            Connection: 'close'
          }
        },
        (res) => {
          const chunks: Buffer[] = []
          let size = 0
          res.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > MAX_RESPONSE_BYTES) {
              kill(new CliError('bad_response', `resposta do ${APP_NAME} grande demais.`))
              return
            }
            chunks.push(chunk)
          })
          res.on('end', () => settle(null, { status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
          res.on('error', (err) => settle(err))
          res.on('close', () => {
            settle(new CliError('connection', `a conexão com o ${APP_NAME} caiu antes do fim da resposta.`))
          })
        }
      )
      const timer = setTimeout(() => {
        kill(new CliError('connection', `o ${APP_NAME} não respondeu em ${fmtDuration(timeoutMs)} (porta ${port}).`))
      }, timeoutMs)
      const onAbort = (): void => {
        kill(interruptedError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      req.on('error', (err) => settle(err))
      req.end(data)
    })
  }
}

/** Erros de rede → mensagens para o agente (nunca inclui o token). */
function networkError(err: unknown, port: number): CliError {
  if (err instanceof CliError) return err
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ECONNREFUSED') {
    return new CliError('connection', `Não consegui falar com o ${APP_NAME} (porta ${port}). O app está aberto?`)
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return new CliError('connection', `a conexão com o ${APP_NAME} caiu (porta ${port}). O app foi fechado?`)
  }
  const detail = code ?? (err instanceof Error ? err.message : String(err))
  return new CliError('connection', `falha de conexão com o ${APP_NAME} (porta ${port}): ${detail}.`)
}
