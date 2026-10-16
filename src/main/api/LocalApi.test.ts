import * as http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiMethod } from '@shared/api'
import { API_MAX_BODY_BYTES } from '@shared/constants'
import { startLocalApi, type LocalApi, type LocalApiOptions } from './LocalApi'

const TOKEN = 'token-valido-0123456789'
const CALLER = 't-chamador'

interface Call {
  callerId: string
  method: ApiMethod
  body: unknown
  signal: AbortSignal
}

interface Res {
  status: number
  headers: http.IncomingHttpHeaders
  json: { ok: boolean; result?: unknown; error?: { code: string; message: string } } | null
  raw: string
}

interface ReqOpts {
  method?: string
  path?: string
  headers?: Record<string, string>
  body?: string | Buffer
  /** Não envia Authorization. */
  noAuth?: boolean
  /** Não envia Host. */
  noHost?: boolean
}

function send(port: number, opts: ReqOpts = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const body = opts.body ?? '{}'
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      ...(opts.noAuth ? {} : { Authorization: `Bearer ${TOKEN}` }),
      ...opts.headers
    }
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'POST',
        path: opts.path ?? '/v1/whoami',
        headers,
        agent: false,
        setHost: !opts.noHost
      },
      (res) => collect(res, resolve)
    )
    req.on('error', reject)
    req.end(body)
  })
}

function parseOrNull(raw: string): Res['json'] {
  try {
    return JSON.parse(raw) as Res['json']
  } catch {
    return null
  }
}

function collect(res: http.IncomingMessage, resolve: (r: Res) => void): void {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    resolve({ status: res.statusCode ?? 0, headers: res.headers, json: parseOrNull(raw), raw })
  })
}

function hasCors(headers: http.IncomingHttpHeaders): boolean {
  return Object.keys(headers).some((h) => h.toLowerCase().startsWith('access-control-'))
}

/**
 * Requisição "manual": `write` escreve (parte do) corpo sem encerrar. Resolve quando a resposta
 * termina; erros do socket depois que a resposta chegou (o servidor fechou a conexão) são ignorados.
 */
function partial(port: number, path: string, headers: Record<string, string>, write: (req: http.ClientRequest) => void): Promise<Res> {
  return new Promise((resolve, reject) => {
    let answered = false
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path,
        agent: false,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers }
      },
      (res) => {
        answered = true
        collect(res, (r) => {
          req.destroy()
          resolve(r)
        })
      }
    )
    req.on('error', (err) => {
      if (!answered) reject(err)
    })
    write(req)
  })
}

describe('LocalApi (servidor HTTP)', () => {
  let api: LocalApi
  let port: number
  let calls: Call[]
  let behavior: (call: Call) => Promise<unknown>

  async function boot(extra: Partial<LocalApiOptions> = {}): Promise<void> {
    calls = []
    const started = await startLocalApi({
      resolveCaller: (t) => (t === TOKEN ? CALLER : undefined),
      dispatch: (callerId, method, body, signal) => {
        const call = { callerId, method, body, signal }
        calls.push(call)
        return behavior(call)
      },
      ...extra
    })
    api = started.api
    port = started.port
  }

  beforeEach(async () => {
    behavior = async (call) => ({ eco: call.method })
    await boot()
  })

  afterEach(async () => {
    await api.stop()
  })

  it('escuta apenas em 127.0.0.1 numa porta aleatória', () => {
    expect(port).toBeGreaterThan(0)
    expect(api.port).toBe(port)
  })

  it('200: {ok:true,result} com JSON UTF-8 e sem cabeçalhos CORS', async () => {
    const r = await send(port, { path: '/v1/send', body: JSON.stringify({ to: 'revisor', text: 'olá, ação!' }) })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(r.headers['cache-control']).toBe('no-store')
    expect(hasCors(r.headers)).toBe(false)
    expect(r.json).toEqual({ ok: true, result: { eco: 'send' } })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.callerId).toBe(CALLER)
    expect(calls[0]!.method).toBe('send')
    expect(calls[0]!.body).toEqual({ to: 'revisor', text: 'olá, ação!' })
  })

  it('aplica defaults do schema antes do dispatch e aceita corpo vazio como {}', async () => {
    await send(port, { path: '/v1/read', body: JSON.stringify({ peer: 'x' }) })
    expect(calls[0]!.body).toEqual({ peer: 'x', lines: 50 })
    const r = await send(port, { path: '/v1/whoami', body: '' })
    expect(r.status).toBe(200)
    expect(calls[1]!.body).toEqual({})
  })

  it('resultado indefinido vira {}', async () => {
    behavior = async () => undefined
    const r = await send(port, { path: '/v1/status', body: JSON.stringify({ text: 'ok' }) })
    expect(r.json).toEqual({ ok: true, result: {} })
  })

  it('401 sem token e com token inválido (sem chamar o dispatch)', async () => {
    const none = await send(port, { noAuth: true })
    expect(none.status).toBe(401)
    expect(none.json?.error?.code).toBe('unauthorized')
    const bad = await send(port, { noAuth: true, headers: { Authorization: 'Bearer outro-token' } })
    expect(bad.status).toBe(401)
    expect(bad.json?.ok).toBe(false)
    const basic = await send(port, { noAuth: true, headers: { Authorization: `Basic ${TOKEN}` } })
    expect(basic.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('403 para requisições de navegador (Origin ou Sec-Fetch-Site/Dest), mesmo com token válido', async () => {
    const withOrigin = await send(port, { headers: { Origin: 'http://evil.example' } })
    expect(withOrigin.status).toBe(403)
    expect(withOrigin.json?.error?.code).toBe('forbidden')
    expect(hasCors(withOrigin.headers)).toBe(false)
    const nullOrigin = await send(port, { headers: { Origin: 'null' } })
    expect(nullOrigin.status).toBe(403)
    const fetchSite = await send(port, { headers: { 'Sec-Fetch-Site': 'same-origin' } })
    expect(fetchSite.status).toBe(403)
    const fetchDest = await send(port, { headers: { 'Sec-Fetch-Dest': 'empty' } })
    expect(fetchDest.status).toBe(403)
    const preflight = await send(port, { method: 'OPTIONS', headers: { Origin: 'http://evil.example' } })
    expect(preflight.status).toBe(403)
    expect(hasCors(preflight.headers)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('aceita clientes Node: fetch (undici envia sec-fetch-mode) e http.request', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/peers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: '{}'
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: { eco: 'peers' } })
    const mode = await send(port, { headers: { 'Sec-Fetch-Mode': 'cors' } })
    expect(mode.status).toBe(200)
  })

  it('403 com Host diferente de 127.0.0.1:<porta>/localhost:<porta> (DNS rebinding)', async () => {
    for (const host of [`evil.example:${port}`, `127.0.0.1:${port + 1}`, '127.0.0.1', `[::1]:${port}`, `127.0.0.2:${port}`]) {
      const r = await send(port, { headers: { Host: host } })
      expect(r.status, host).toBe(403)
      expect(r.json?.error?.code).toBe('forbidden')
    }
    // Sem Host: o próprio Node recusa (400, requireHostHeader) ou o servidor recusa (403).
    const missing = await send(port, { noHost: true })
    expect([400, 403]).toContain(missing.status)
    const local = await send(port, { headers: { Host: `localhost:${port}` } })
    expect(local.status).toBe(200)
    const upper = await send(port, { headers: { Host: `LOCALHOST:${port}` } })
    expect(upper.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it('404 para método desconhecido, rota fora de /v1, verbo diferente de POST e query string', async () => {
    for (const path of ['/v1/naoexiste', '/foo', '/v1/', '/v1/constructor', '/v1/__proto__', '/v2/whoami', '/v1/whoami?x=1', '/v1/note.list/x']) {
      const r = await send(port, { path })
      expect(r.status, path).toBe(404)
      expect(r.json?.error?.code).toBe('not_found')
    }
    const get = await send(port, { method: 'GET', path: '/v1/whoami', body: '' })
    expect(get.status).toBe(404)
    const ok = await send(port, { path: '/v1/note.list' })
    expect(ok.status).toBe(200)
    expect(calls.map((c) => c.method)).toEqual(['note.list'])
  })

  it('400 para JSON inválido, UTF-8 inválido e Content-Type errado', async () => {
    const badJson = await send(port, { body: '{"x":' })
    expect(badJson.status).toBe(400)
    expect(badJson.json?.error?.code).toBe('bad_request')
    expect(badJson.json?.error?.message).toContain('JSON')
    const badUtf8 = await send(port, { body: Buffer.from([0x7b, 0xff, 0xfe, 0x7d]) })
    expect(badUtf8.status).toBe(400)
    expect(badUtf8.json?.error?.message).toContain('UTF-8')
    const text = await send(port, { headers: { 'Content-Type': 'text/plain' } })
    expect(text.status).toBe(400)
    expect(text.json?.error?.message).toContain('application/json')
    const latin1 = await send(port, { headers: { 'Content-Type': 'application/json; charset=iso-8859-1' } })
    expect(latin1.status).toBe(400)
    const utf8 = await send(port, { headers: { 'Content-Type': 'Application/JSON; charset=UTF-8' } })
    expect(utf8.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('400 com a primeira falha do schema em pt-BR, indicando o campo', async () => {
    const missing = await send(port, { path: '/v1/send', body: JSON.stringify({ text: 'oi' }) })
    expect(missing.status).toBe(400)
    expect(missing.json?.error?.message).toContain('"to"')
    expect(missing.json?.error?.message).toContain('não foi informado')
    const empty = await send(port, { path: '/v1/send', body: JSON.stringify({ to: 'x', text: '' }) })
    expect(empty.json?.error?.message).toContain('mensagem vazia')
    const extra = await send(port, { path: '/v1/send', body: JSON.stringify({ to: 'x', text: 'a', de: 'outro' }) })
    expect(extra.status).toBe(400)
    expect(extra.json?.error?.message).toContain('"de"')
    expect(extra.json?.error?.message).toContain('campos aceitos: to, text, wait')
    const wrongType = await send(port, { path: '/v1/read', body: JSON.stringify({ peer: 'x', lines: 'dez' }) })
    expect(wrongType.json?.error?.message).toContain('campo "lines"')
    const notObject = await send(port, { path: '/v1/whoami', body: '[1,2]' })
    expect(notObject.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('413 quando o Content-Length declarado passa do limite (sem esperar o corpo)', async () => {
    const r = await partial(port, '/v1/send', { 'Content-Length': String(API_MAX_BODY_BYTES + 1) }, (req) => {
      req.write('{"to":"x"') // só um pedaço: o servidor responde sem ler o resto
    })
    expect(r.status).toBe(413)
    expect(r.json?.error?.code).toBe('too_large')
    expect(r.headers['connection']).toBe('close')
    expect(calls).toHaveLength(0)
  })

  it('413 quando o corpo enviado em partes (chunked) passa do limite', async () => {
    await api.stop()
    await boot({ maxBodyBytes: 1024 })
    const r = await partial(port, '/v1/send', { 'Transfer-Encoding': 'chunked' }, (req) => {
      req.write('x'.repeat(1025))
    })
    expect(r.status).toBe(413)
    expect(r.json?.error?.code).toBe('too_large')
    expect(r.headers['connection']).toBe('close')
    expect(calls).toHaveLength(0)
  })

  it('aceita corpo exatamente no limite', async () => {
    await api.stop()
    await boot({ maxBodyBytes: 1024 })
    const prefix = '{"to":"x","text":"'
    const suffix = '"}'
    const body = prefix + 'a'.repeat(1024 - prefix.length - suffix.length) + suffix
    expect(Buffer.byteLength(body)).toBe(1024)
    const r = await send(port, { path: '/v1/send', body })
    expect(r.status).toBe(200)
  })

  it('408 quando o corpo não chega a tempo', async () => {
    await api.stop()
    await boot({ bodyTimeoutMs: 150 })
    const r = await partial(port, '/v1/whoami', { 'Content-Length': '100' }, (req) => {
      req.write('{')
    })
    expect(r.status).toBe(408)
    expect(r.json?.error?.code).toBe('timeout')
    expect(calls).toHaveLength(0)
  })

  it('converte ApiError no status do contrato', async () => {
    const cases: [ConstructorParameters<typeof ApiError>[0], number][] = [
      ['forbidden', 403],
      ['not_found', 404],
      ['conflict', 409],
      ['precondition', 412],
      ['rate_limited', 429],
      ['unavailable', 503]
    ]
    for (const [code, status] of cases) {
      behavior = async () => {
        throw new ApiError(code, `mensagem de ${code}`)
      }
      const r = await send(port)
      expect(r.status, code).toBe(status)
      expect(r.json).toEqual({ ok: false, error: { code, message: `mensagem de ${code}` } })
    }
  })

  it('erro inesperado vira 500 com mensagem genérica (sem vazar detalhes)', async () => {
    behavior = async () => {
      throw new Error('segredo: conteúdo do terminal')
    }
    const r = await send(port)
    expect(r.status).toBe(500)
    expect(r.json?.error?.code).toBe('internal')
    expect(r.raw).not.toContain('segredo')
  })

  it('aborta o sinal do dispatch quando o cliente desconecta (long-poll)', async () => {
    let aborted!: () => void
    const abortedP = new Promise<void>((r) => (aborted = r))
    let started!: () => void
    const startedP = new Promise<void>((r) => (started = r))
    behavior = (call) =>
      new Promise((resolve) => {
        started()
        call.signal.addEventListener('abort', () => {
          aborted()
          resolve({ done: false })
        })
      })
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/v1/wait',
      agent: false,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }
    })
    req.on('error', () => undefined)
    req.end(JSON.stringify({ messageId: 'm-1', pollMs: 20_000 }))
    await startedP
    expect(calls[0]!.signal.aborted).toBe(false)
    req.destroy()
    await abortedP
    expect(calls[0]!.signal.aborted).toBe(true)
  })

  it('limita requisições simultâneas por terminal (429) e libera a vaga ao terminar', async () => {
    await api.stop()
    await boot({ maxInflightPerCaller: 2 })
    const releases: (() => void)[] = []
    behavior = (call) =>
      call.method === 'wait'
        ? new Promise((resolve) => releases.push(() => resolve({ done: false })))
        : Promise.resolve({ eco: call.method })
    const body = JSON.stringify({ messageId: 'm-1' })
    const first = send(port, { path: '/v1/wait', body })
    const second = send(port, { path: '/v1/wait', body })
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    const third = await send(port, { path: '/v1/whoami' })
    expect(third.status).toBe(429)
    expect(third.json?.error?.code).toBe('rate_limited')
    for (const r of releases) r()
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
    const after = await send(port, { path: '/v1/whoami' })
    expect(after.status).toBe(200)
  })

  it('stop() encerra long-polls em andamento e libera a porta', async () => {
    let started!: () => void
    const startedP = new Promise<void>((r) => (started = r))
    behavior = (call) =>
      new Promise((resolve) => {
        started()
        call.signal.addEventListener('abort', () => resolve({ done: false }))
      })
    const pending = send(port, { path: '/v1/wait', body: JSON.stringify({ messageId: 'm-1' }) }).catch((err: Error) => err)
    await startedP
    await api.stop()
    expect(calls[0]!.signal.aborted).toBe(true)
    expect(api.port).toBe(0)
    await pending
    // Reinicia para o afterEach (stop é idempotente).
    await boot()
  })
})
