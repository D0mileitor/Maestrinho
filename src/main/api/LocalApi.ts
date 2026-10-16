import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { API_ERROR_STATUS, API_VERSION, ApiError, type ApiErrorBody, type ApiMethod, type ApiOkBody } from '@shared/api'
import { API_MAX_BODY_BYTES, APP_NAME, CLI_NAME, ENV } from '@shared/constants'
import { log } from '../util/log'
import { isApiMethod, parseApiRequest } from './validation'

/**
 * Servidor HTTP da API local usada pelo CLI dentro dos terminais.
 *
 * Endurecimento (auditado):
 *  - escuta apenas em 127.0.0.1, porta aleatória;
 *  - header Host precisa ser exatamente 127.0.0.1:<porta> ou localhost:<porta> (defesa contra DNS rebinding);
 *  - qualquer requisição com Origin (ou Sec-Fetch-Site/Dest/User, típicos de navegador) é recusada;
 *    nenhum cabeçalho CORS é enviado, então navegadores nunca conseguem ler as respostas;
 *  - autenticação por token exclusivo do terminal (`Authorization: Bearer <token>`): a identidade
 *    do chamador vem do token, nunca do corpo;
 *  - limite de tamanho do corpo, tempo máximo para cabeçalhos e corpo, apenas JSON UTF-8;
 *  - erros inesperados viram 500 com mensagem genérica; o log registra só metadados.
 */

export interface LocalApiOptions {
  /** Terminal (id do nó) dono do token, ou undefined se o token não vale. */
  resolveCaller(token: string): string | undefined
  /**
   * Executa um método já validado. `signal` é abortado quando o cliente desconecta ou o servidor para
   * (long-poll de `wait`, espera antes da entrega de `send`).
   */
  dispatch(callerId: string, method: ApiMethod, body: unknown, signal: AbortSignal): Promise<unknown>
  /** Porta desejada (0 = aleatória, o padrão). */
  port?: number
  /** Limite do corpo em bytes (padrão API_MAX_BODY_BYTES). */
  maxBodyBytes?: number
  /** Tempo máximo para receber o corpo completo (padrão 20 s). */
  bodyTimeoutMs?: number
  /** Tempo máximo para receber os cabeçalhos (padrão 10 s). */
  headersTimeoutMs?: number
  /**
   * Portas extras aceitas no header Host: as portas remotas dos túneis SSH (`ssh -R`), pelas quais o
   * `orq` de um servidor remoto chega aqui como `127.0.0.1:<porta remota>`.
   */
  extraHostPorts?: () => Iterable<number>
  /** Executa o CLI em nome do terminal (rota POST /v1/cli, usada pelo `orq` remoto que só tem curl). */
  runCli?: (callerId: string, token: string, argv: string[], stdin: string | undefined, signal: AbortSignal) => Promise<{ exitCode: number; output: string }>
  /** Máximo de requisições simultâneas de um mesmo terminal (padrão 32). */
  maxInflightPerCaller?: number
  /** Máximo de requisições autenticadas simultâneas no total (padrão 512). */
  maxInflightTotal?: number
  /**
   * Linhas de auditoria por terminal a cada minuto (padrão 60). O excedente não some: vira uma linha
   * de resumo com a contagem por método e status, para um agente em laço não apagar o histórico do log.
   */
  auditMaxPerCaller?: number
}

const HOST = '127.0.0.1'
const DEFAULT_BODY_TIMEOUT_MS = 20_000
const DEFAULT_HEADERS_TIMEOUT_MS = 10_000
/** Cobre o recebimento da requisição; o tempo do handler (long-poll de 25 s) não conta aqui. */
const REQUEST_TIMEOUT_MS = 60_000
const KEEP_ALIVE_TIMEOUT_MS = 5_000
/** Inatividade máxima do socket (rede de segurança acima do long-poll e da espera de entrega). */
const SOCKET_IDLE_TIMEOUT_MS = 120_000
const MAX_TOKEN_LENGTH = 512
const ROUTE_PREFIX = `/${API_VERSION}/`
/** No máximo REJECT_LOG_MAX linhas de log por janela para requisições recusadas antes da autenticação. */
const REJECT_LOG_WINDOW_MS = 60_000
const REJECT_LOG_MAX = 20
/** Requisições simultâneas (long-polls, entregas em espera) por terminal e no total. */
const DEFAULT_MAX_INFLIGHT_PER_CALLER = 32
const DEFAULT_MAX_INFLIGHT_TOTAL = 512
/** Janela e limite do log de auditoria por terminal (o excedente vira resumo). */
const AUDIT_WINDOW_MS = 60_000
const DEFAULT_AUDIT_MAX_PER_CALLER = 60
/**
 * Frequência com que o Node confere os prazos de cabeçalho/requisição. O padrão (30 s) deixaria um
 * cliente lento segurar a conexão por até headersTimeout + 30 s.
 */
const CONNECTIONS_CHECK_MS = 2_000

interface AuditWindow {
  start: number
  logged: number
  /** Chamadas não registradas nesta janela, por "método status". */
  omitted: Map<string, number>
}

/**
 * Cabeçalhos que só navegadores enviam. "sec-fetch-mode" fica de fora de propósito: o fetch do
 * próprio Node (undici) o envia ("cors"); navegadores sempre mandam também Origin (em POST) e
 * sec-fetch-site, que bastam para identificá-los.
 */
const BROWSER_HEADERS = ['origin', 'sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user'] as const

const GENERIC_INTERNAL_MESSAGE = `Erro interno do ${APP_NAME} ao processar o comando. Tente novamente; se persistir, avise o usuário.`

/** Erro de protocolo HTTP detectado antes do dispatch (status explícito, código do contrato). */
class HttpRejection extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorBody['error']['code'],
    message: string,
    /** Fecha a conexão após responder (corpo não lido / grande demais). */
    readonly close = false
  ) {
    super(message)
    this.name = 'HttpRejection'
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header)
  const token = m?.[1]
  if (!token || token.length > MAX_TOKEN_LENGTH) return null
  return token
}

function isJsonContentType(header: string | undefined): boolean {
  if (!header) return false
  const [type, ...params] = header.split(';').map((p) => p.trim().toLowerCase())
  if (type !== 'application/json') return false
  for (const p of params) {
    const [k, v] = p.split('=').map((s) => s.trim().replace(/^"|"$/g, ''))
    if (k === 'charset' && v !== 'utf-8' && v !== 'utf8') return false
  }
  return true
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

export class LocalApi {
  private server: http.Server | null = null
  private _port = 0
  private readonly inflight = new Set<AbortController>()
  private readonly maxBodyBytes: number
  private readonly bodyTimeoutMs: number
  private readonly headersTimeoutMs: number
  private rejectWindowStart = 0
  private rejectLogged = 0
  private rejectSuppressed = 0
  private readonly maxInflightPerCaller: number
  private readonly maxInflightTotal: number
  /** Requisições autenticadas em andamento, por terminal. */
  private readonly busyByCaller = new Map<string, number>()
  private busyTotal = 0
  private readonly auditMaxPerCaller: number
  private readonly auditWindows = new Map<string, AuditWindow>()
  /** Início em andamento (chamadas concorrentes de start() compartilham o mesmo servidor). */
  private starting: Promise<number> | null = null

  constructor(private readonly opts: LocalApiOptions) {
    this.maxBodyBytes = Math.max(1, opts.maxBodyBytes ?? API_MAX_BODY_BYTES)
    this.bodyTimeoutMs = Math.max(1, opts.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS)
    this.headersTimeoutMs = Math.max(1, opts.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS)
    this.maxInflightPerCaller = Math.max(1, opts.maxInflightPerCaller ?? DEFAULT_MAX_INFLIGHT_PER_CALLER)
    this.maxInflightTotal = Math.max(1, opts.maxInflightTotal ?? DEFAULT_MAX_INFLIGHT_TOTAL)
    this.auditMaxPerCaller = Math.max(1, opts.auditMaxPerCaller ?? DEFAULT_AUDIT_MAX_PER_CALLER)
  }

  /** Reserva uma vaga de requisição simultânea para o terminal (devolve a função que a libera). */
  private acquire(callerId: string): () => void {
    const mine = this.busyByCaller.get(callerId) ?? 0
    if (mine >= this.maxInflightPerCaller) {
      throw new HttpRejection(
        429,
        'rate_limited',
        `Requisições simultâneas demais deste terminal (limite ${this.maxInflightPerCaller}). ` +
          `Espere os comandos ${CLI_NAME} em andamento terminarem antes de iniciar outros.`,
        true
      )
    }
    if (this.busyTotal >= this.maxInflightTotal) {
      throw new HttpRejection(
        503,
        'unavailable',
        `A API local do ${APP_NAME} está sobrecarregada. Tente de novo em instantes.`,
        true
      )
    }
    this.busyByCaller.set(callerId, mine + 1)
    this.busyTotal += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.busyTotal -= 1
      const left = (this.busyByCaller.get(callerId) ?? 1) - 1
      if (left <= 0) this.busyByCaller.delete(callerId)
      else this.busyByCaller.set(callerId, left)
    }
  }

  /** Porta em que o servidor está escutando (0 se parado). */
  get port(): number {
    return this._port
  }

  /** Inicia o servidor em 127.0.0.1 e devolve a porta (idempotente, inclusive com chamadas concorrentes). */
  start(): Promise<number> {
    if (this.server) return Promise.resolve(this._port)
    this.starting ??= this.listen().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async listen(): Promise<number> {
    const server = http.createServer(
      {
        headersTimeout: this.headersTimeoutMs,
        requestTimeout: Math.max(REQUEST_TIMEOUT_MS, this.headersTimeoutMs),
        keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
        connectionsCheckingInterval: CONNECTIONS_CHECK_MS,
        maxHeaderSize: 16 * 1024
      },
      (req, res) => void this.handle(req, res)
    )
    server.maxHeadersCount = 64
    server.setTimeout(SOCKET_IDLE_TIMEOUT_MS)
    // HTTP malformado/tempo de cabeçalhos esgotado: o tratamento padrão do Node (400/408/431 sem corpo) basta.
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => reject(err)
      server.once('error', onError)
      server.listen({ host: HOST, port: this.opts.port ?? 0, exclusive: true }, () => {
        server.off('error', onError)
        resolve()
      })
    })
    server.on('error', (err) => log.error('API local: erro no servidor', err))
    this.server = server
    this._port = (server.address() as AddressInfo).port
    log.info('API local escutando', { host: HOST, port: this._port })
    return this._port
  }

  /** Para o servidor: aborta chamadas em andamento (long-polls) e fecha todas as conexões. */
  async stop(): Promise<void> {
    // Um start() em andamento termina antes (senão o servidor ficaria escutando depois do stop).
    if (this.starting) await this.starting.catch(() => undefined)
    const server = this.server
    if (!server) return
    this.server = null
    this.flushAuditWindows(Date.now(), true)
    for (const c of this.inflight) c.abort()
    this.inflight.clear()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
    this._port = 0
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const started = Date.now()
    const controller = new AbortController()
    this.inflight.add(controller)
    // Escrever num socket que o cliente já fechou não pode derrubar o processo principal.
    res.on('error', () => undefined)
    // Cliente desconectou antes da resposta (ex.: Ctrl+C no CLI): cancela long-poll/entrega pendente.
    res.on('close', () => {
      this.inflight.delete(controller)
      if (!res.writableEnded) controller.abort()
    })

    let method: ApiMethod | null = null
    let callerId: string | null = null
    let status = 200
    let bytes = 0
    let release: (() => void) | null = null
    try {
      this.checkOrigin(req)
      callerId = this.authenticate(req)
      if (req.url === `${ROUTE_PREFIX}cli` && this.opts.runCli) {
        release = this.acquire(callerId)
        bytes = await this.handleCli(req, res, callerId, controller.signal)
        return
      }
      method = this.route(req)
      release = this.acquire(callerId)
      if (!isJsonContentType(req.headers['content-type'])) {
        throw new HttpRejection(400, 'bad_request', 'Content-Type deve ser application/json (UTF-8).', true)
      }
      const raw = await this.readBody(req)
      bytes = raw.length
      const body = this.parseJson(raw)
      const parsed = parseApiRequest(method, body)
      const result = await this.opts.dispatch(callerId, method, parsed, controller.signal)
      const ok: ApiOkBody<unknown> = { ok: true, result: result ?? {} }
      this.respond(res, 200, ok)
    } catch (err) {
      const { status: st, body, close } = this.errorResponse(err, method)
      status = st
      this.respond(res, st, body, close)
    } finally {
      release?.()
      // Hooks do Claude Code chegam a cada ferramenta: os bem-sucedidos não entram na auditoria.
      if (!(method === 'hook' && status === 200)) this.audit({ caller: callerId, method, status, bytes, ms: Date.now() - started })
    }
  }

  /** Registro de auditoria (só metadados). Recusas antes da autenticação têm log limitado por minuto. */
  private audit(meta: { caller: string | null; method: ApiMethod | null; status: number; bytes: number; ms: number }): void {
    if (meta.caller === null) {
      const now = Date.now()
      if (now - this.rejectWindowStart >= REJECT_LOG_WINDOW_MS) {
        if (this.rejectSuppressed > 0) {
          log.warn('API local: recusas omitidas do log', { count: this.rejectSuppressed })
        }
        this.rejectWindowStart = now
        this.rejectLogged = 0
        this.rejectSuppressed = 0
      }
      if (this.rejectLogged >= REJECT_LOG_MAX) {
        this.rejectSuppressed += 1
        return
      }
      this.rejectLogged += 1
      log.warn('API local: requisição recusada', meta)
      return
    }
    const now = Date.now()
    this.flushAuditWindows(now)
    let win = this.auditWindows.get(meta.caller)
    if (!win) {
      win = { start: now, logged: 0, omitted: new Map() }
      this.auditWindows.set(meta.caller, win)
    }
    // Falhas internas sempre entram; o resto respeita o limite por terminal (o excedente vira contagem).
    if (meta.status < 500 && win.logged >= this.auditMaxPerCaller) {
      const key = `${meta.method ?? '?'} ${meta.status}`
      win.omitted.set(key, (win.omitted.get(key) ?? 0) + 1)
      return
    }
    win.logged += 1
    if (meta.status >= 500) log.warn('API local: chamada falhou', meta)
    else if (meta.method === 'wait' && meta.status === 200) log.debug('API local', meta)
    else log.info('API local', meta)
  }

  /** Fecha as janelas de auditoria vencidas (ou todas, com `all`), registrando o resumo do que foi omitido. */
  private flushAuditWindows(now: number, all = false): void {
    for (const [caller, win] of this.auditWindows) {
      if (!all && now - win.start < AUDIT_WINDOW_MS) continue
      this.auditWindows.delete(caller)
      if (win.omitted.size === 0) continue
      let count = 0
      for (const n of win.omitted.values()) count += n
      log.warn('API local: chamadas omitidas do log (limite por terminal)', {
        caller,
        count,
        windowMs: now - win.start,
        byMethod: Object.fromEntries(win.omitted)
      })
    }
  }

  /** Navegadores e Host inesperado (DNS rebinding) são recusados antes de qualquer outra coisa. */
  private checkOrigin(req: http.IncomingMessage): void {
    for (const h of BROWSER_HEADERS) {
      if (req.headers[h] !== undefined) {
        throw new HttpRejection(403, 'forbidden', 'Requisições de navegador não são aceitas pela API local.', true)
      }
    }
    const host = (req.headers.host ?? '').trim().toLowerCase()
    const m = /^(127\.0\.0\.1|localhost):(\d{1,5})$/.exec(host)
    const port = m ? Number(m[2]) : -1
    const allowed = port === this._port || (port > 0 && [...(this.opts.extraHostPorts?.() ?? [])].includes(port))
    if (!allowed) {
      throw new HttpRejection(403, 'forbidden', 'Header Host inválido para a API local.', true)
    }
  }

  private authenticate(req: http.IncomingMessage): string {
    const header = req.headers.authorization
    const token = bearerToken(header)
    if (!token) {
      throw new HttpRejection(
        401,
        'unauthorized',
        `Token ausente: o ${CLI_NAME} precisa das variáveis ${ENV.port} e ${ENV.token}, que só existem dentro dos ` +
          `terminais do ${APP_NAME}.`,
        true
      )
    }
    const callerId = this.opts.resolveCaller(token)
    if (!callerId) {
      throw new HttpRejection(
        401,
        'unauthorized',
        `Token inválido ou expirado: este terminal não está mais registrado no ${APP_NAME} ` +
          '(o terminal foi fechado ou o app foi reiniciado). Use um terminal aberto no canvas.',
        true
      )
    }
    return callerId
  }

  private route(req: http.IncomingMessage): ApiMethod {
    const url = req.url ?? ''
    const name = url.startsWith(ROUTE_PREFIX) ? url.slice(ROUTE_PREFIX.length) : ''
    if (req.method !== 'POST' || !/^[a-z]+(\.[a-z]+)?$/.test(name) || !isApiMethod(name)) {
      throw new HttpRejection(
        404,
        'not_found',
        `Rota inexistente. Use POST ${ROUTE_PREFIX}<método> (versão do ${CLI_NAME} incompatível com o app?).`,
        true
      )
    }
    return name
  }

  /** Lê o corpo respeitando limite de tamanho e prazo; 413 interrompe a leitura e fecha a conexão. */
  /**
   * POST /v1/cli (form-urlencoded: `a=<arg>` repetido, `stdin=<texto>` opcional): roda o CLI em nome do
   * terminal autenticado e devolve a saída em texto, com o código de saída no header X-Orq-Exit.
   * Usado pelo `orq` remoto (script POSIX com curl), que não monta nem interpreta JSON.
   */
  private async handleCli(req: http.IncomingMessage, res: http.ServerResponse, callerId: string, signal: AbortSignal): Promise<number> {
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    if (type !== 'application/x-www-form-urlencoded') {
      throw new HttpRejection(400, 'bad_request', 'Content-Type deve ser application/x-www-form-urlencoded.', true)
    }
    const raw = await this.readBody(req)
    const form = new URLSearchParams(raw.toString('utf8'))
    const argv = form.getAll('a')
    if (argv.length > 200) throw new HttpRejection(400, 'bad_request', 'Argumentos demais.', true)
    const stdin = form.has('stdin') ? (form.get('stdin') ?? '') : undefined
    const token = bearerToken(req.headers.authorization) ?? ''
    // A execução pode durar o tempo de um `--wait` (o próprio CLI aplica --timeout).
    req.socket.setTimeout(0)
    const result = await this.opts.runCli!(callerId, token, argv, stdin, signal)
    if (!res.headersSent && !res.writableEnded && !res.destroyed) {
      const body = Buffer.from(result.output, 'utf8')
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Orq-Exit': String(result.exitCode)
      })
      res.end(body)
    }
    return raw.length
  }

  private readBody(req: http.IncomingMessage): Promise<Buffer> {
    const max = this.maxBodyBytes
    const declared = req.headers['content-length']
    if (declared !== undefined) {
      const n = Number(declared)
      if (!Number.isSafeInteger(n) || n < 0) {
        return Promise.reject(new HttpRejection(400, 'bad_request', 'Content-Length inválido.', true))
      }
      if (n > max) return Promise.reject(this.tooLarge())
    }
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      let settled = false
      const finish = (err: Error | null, value?: Buffer): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        req.off('data', onData)
        req.off('end', onEnd)
        req.off('error', onError)
        req.off('aborted', onAborted)
        if (err) {
          // Para de ler: a resposta de erro sai com "Connection: close" e o socket é encerrado.
          req.pause()
          reject(err)
        } else {
          resolve(value!)
        }
      }
      const onData = (chunk: Buffer): void => {
        size += chunk.length
        if (size > max) finish(this.tooLarge())
        else chunks.push(chunk)
      }
      const onEnd = (): void => finish(null, Buffer.concat(chunks, size))
      const onError = (): void => finish(new HttpRejection(400, 'bad_request', 'Falha ao ler o corpo da requisição.', true))
      const onAborted = (): void => finish(new HttpRejection(400, 'bad_request', 'Requisição interrompida pelo cliente.', true))
      const timer = setTimeout(
        () => finish(new HttpRejection(408, 'timeout', 'Tempo esgotado ao receber o corpo da requisição.', true)),
        this.bodyTimeoutMs
      )
      req.on('data', onData)
      req.on('end', onEnd)
      req.on('error', onError)
      req.on('aborted', onAborted)
    })
  }

  private tooLarge(): HttpRejection {
    const mb = (this.maxBodyBytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')
    return new HttpRejection(
      413,
      'too_large',
      `Corpo da requisição grande demais (limite de ${mb} MB). Divida o conteúdo em partes menores ` +
        `(ex.: várias chamadas de \`${CLI_NAME} note append\`).`,
      true
    )
  }

  private parseJson(raw: Buffer): unknown {
    if (raw.length === 0) return {}
    let text: string
    try {
      text = utf8.decode(raw)
    } catch {
      throw new HttpRejection(400, 'bad_request', 'O corpo da requisição não é UTF-8 válido.')
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new HttpRejection(400, 'bad_request', 'O corpo da requisição não é um JSON válido.')
    }
  }

  private errorResponse(
    err: unknown,
    method: ApiMethod | null
  ): { status: number; body: ApiErrorBody; close: boolean } {
    if (err instanceof HttpRejection) {
      return { status: err.status, body: { ok: false, error: { code: err.code, message: err.message } }, close: err.close }
    }
    if (err instanceof ApiError) {
      return {
        status: API_ERROR_STATUS[err.code] ?? 500,
        body: { ok: false, error: { code: err.code, message: err.message } },
        close: false
      }
    }
    // Só metadados: a mensagem de um erro inesperado pode conter dados do usuário.
    log.error('API local: erro inesperado no handler', {
      method,
      error: err instanceof Error ? err.name : typeof err,
      errno: (err as NodeJS.ErrnoException | null)?.code
    })
    return { status: 500, body: { ok: false, error: { code: 'internal', message: GENERIC_INTERNAL_MESSAGE } }, close: false }
  }

  private respond(res: http.ServerResponse, status: number, body: unknown, close = false): void {
    if (res.headersSent || res.writableEnded || res.destroyed) return
    const json = JSON.stringify(body)
    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
    if (close) headers['Connection'] = 'close'
    res.writeHead(status, headers)
    res.end(json)
  }
}

/** Atalho para testes/ferramentas: inicia uma API e devolve a URL base e como encerrá-la. */
export async function startLocalApi(
  opts: LocalApiOptions
): Promise<{ api: LocalApi; port: number; baseUrl: string; stop: () => Promise<void> }> {
  const api = new LocalApi(opts)
  const port = await api.start()
  return { api, port, baseUrl: `http://${HOST}:${port}${ROUTE_PREFIX}`, stop: () => api.stop() }
}
