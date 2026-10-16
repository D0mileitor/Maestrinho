import { afterEach, describe, expect, it } from 'vitest'
import { ApiClient, sessionFromEnv } from './client'
import { ApiCallError, CliError } from './errors'
import { TEST_TOKEN, closedPort, fail, ok, startFakeApi, type FakeApi } from './testkit'

let api: FakeApi | undefined
afterEach(async () => {
  await api?.close()
  api = undefined
})

function clientFor(port: number): ApiClient {
  return new ApiClient({ port, token: TEST_TOKEN })
}

describe('sessionFromEnv', () => {
  it('fora de um terminal do app → código 2 com a mensagem padrão', () => {
    try {
      sessionFromEnv({})
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      const e = err as CliError
      expect(e.code).toBe('not_in_terminal')
      expect(e.exitCode).toBe(2)
      expect(e.message).toBe('este comando só funciona dentro de um terminal do Maestrinho.')
      expect(e.hint).toContain('ORQ_PORT')
    }
  })

  it('usa ORQ_SESSION quando ORQ_TOKEN foi removido do ambiente', () => {
    expect(sessionFromEnv({ ORQ_PORT: '4567', ORQ_SESSION: TEST_TOKEN })).toEqual({ port: 4567, token: TEST_TOKEN })
    expect(sessionFromEnv({ ORQ_PORT: '4567', ORQ_TOKEN: '', ORQ_SESSION: TEST_TOKEN }).token).toBe(TEST_TOKEN)
  })

  it('rejeita porta ou token inválidos sem exibir o token', () => {
    expect(() => sessionFromEnv({ ORQ_PORT: 'abc', ORQ_TOKEN: TEST_TOKEN })).toThrow(/ORQ_PORT/)
    expect(() => sessionFromEnv({ ORQ_PORT: '70000', ORQ_TOKEN: TEST_TOKEN })).toThrow(/ORQ_PORT/)
    try {
      sessionFromEnv({ ORQ_PORT: '4567', ORQ_TOKEN: 'segredo com espaço' })
      expect.unreachable()
    } catch (err) {
      expect((err as CliError).message).not.toContain('segredo')
      expect((err as CliError).exitCode).toBe(2)
    }
  })
})

describe('ApiClient', () => {
  it('faz POST /v1/<método> com Bearer, Host 127.0.0.1:<porta> e JSON', async () => {
    api = await startFakeApi(() => ok({ terminals: [], notes: [], portals: [] }))
    const result = await clientFor(api.port).call('send', { to: 'revisor', text: 'olá, ação ✓' })
    expect(result).toEqual({ terminals: [], notes: [], portals: [] })
    const call = api.calls[0]!
    expect(call.httpMethod).toBe('POST')
    expect(call.url).toBe('/v1/send')
    expect(call.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`)
    expect(call.headers.host).toBe(`127.0.0.1:${api.port}`)
    expect(call.headers['content-type']).toBe('application/json')
    expect(call.headers.origin).toBeUndefined()
    expect(call.body).toEqual({ to: 'revisor', text: 'olá, ação ✓' })
  })

  it('erro da API vira ApiCallError com o código de saída certo', async () => {
    const cases = [
      ['forbidden', 3],
      ['unauthorized', 3],
      ['not_found', 4],
      ['timeout', 5],
      ['unavailable', 6],
      ['precondition', 7],
      ['rate_limited', 7],
      ['conflict', 7],
      ['bad_request', 2],
      ['internal', 1]
    ] as const
    api = await startFakeApi((call) => fail(call.body['to'] as (typeof cases)[number][0], 'mensagem do servidor'))
    for (const [code, exit] of cases) {
      const err = await clientFor(api.port)
        .call('send', { to: code, text: 'x' })
        .catch((e: unknown) => e)
      expect(err, code).toBeInstanceOf(ApiCallError)
      expect((err as ApiCallError).code).toBe(code)
      expect((err as ApiCallError).exitCode).toBe(exit)
      expect((err as ApiCallError).message).toBe('mensagem do servidor')
    }
  })

  it('código desconhecido vira internal (1) e mensagem perde escapes', async () => {
    const error = { code: 'teapot', message: 'a\x1b[31mb\nc' }
    api = await startFakeApi(() => ({ status: 418, json: { ok: false, error } }))
    const err = (await clientFor(api.port).call('peers', {}).catch((e: unknown) => e)) as CliError
    expect(err.code).toBe('internal')
    expect(err.message).toBe('ab c')
  })

  it('resposta que não é do protocolo → bad_response (1), salvo status inequívoco', async () => {
    api = await startFakeApi((call) =>
      call.method === 'peers' ? { status: 404, raw: '<html>não</html>' } : { status: 413, raw: 'grande demais' }
    )
    const notOurs = (await clientFor(api.port).call('peers', {}).catch((e: unknown) => e)) as CliError
    expect(notOurs.code).toBe('bad_response')
    expect(notOurs.exitCode).toBe(1)
    expect(notOurs.message).toContain(`porta ${api.port}`)
    const tooLarge = (await clientFor(api.port).call('whoami', {}).catch((e: unknown) => e)) as CliError
    expect(tooLarge.code).toBe('too_large')
    expect(tooLarge.exitCode).toBe(7)
  })

  it('ok sem result vira objeto vazio', async () => {
    api = await startFakeApi(() => ({ status: 200, json: { ok: true } }))
    expect(await clientFor(api.port).call('status', { text: '' })).toEqual({})
  })

  it('conexão recusada → mensagem clara com a porta (código 1)', async () => {
    const port = await closedPort()
    const err = (await clientFor(port).call('whoami', {}).catch((e: unknown) => e)) as CliError
    expect(err.code).toBe('connection')
    expect(err.exitCode).toBe(1)
    expect(err.message).toBe(`Não consegui falar com o Maestrinho (porta ${port}). O app está aberto?`)
  })

  it('tempo máximo da requisição', async () => {
    api = await startFakeApi(() => ({ hang: true }))
    const started = Date.now()
    const err = (await clientFor(api.port)
      .call('whoami', {}, { timeoutMs: 300 })
      .catch((e: unknown) => e)) as CliError
    expect(err.code).toBe('connection')
    expect(err.message).toContain('não respondeu em 0,3 s')
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('cancelamento (Ctrl+C) interrompe a requisição', async () => {
    api = await startFakeApi(() => ({ hang: true }))
    const ac = new AbortController()
    const p = clientFor(api.port).call('whoami', {}, { signal: ac.signal })
    setTimeout(() => ac.abort(), 50)
    await expect(p).rejects.toMatchObject({ code: 'interrupted', exitCode: 130 })
  })

  it('valida o corpo localmente antes de enviar (limite do protocolo → código 7)', async () => {
    api = await startFakeApi(() => ok({}))
    const err = (await clientFor(api.port)
      .call('send', { to: 'revisor', text: 'x'.repeat(200_001) })
      .catch((e: unknown) => e)) as CliError
    expect(err.code).toBe('too_large')
    expect(err.exitCode).toBe(7)
    expect(err.message).toBe('a mensagem excede o limite: 200.001 caracteres (máximo 200.000).')
    expect(err.hint).toContain('nota')
    const lines = (await clientFor(api.port)
      .call('read', { peer: 'x', lines: 0 })
      .catch((e: unknown) => e)) as CliError
    expect(lines.exitCode).toBe(2)
    expect(lines.message).toBe('--lines deve ser no mínimo 1.')
    expect(api.calls).toHaveLength(0)
  })
})
