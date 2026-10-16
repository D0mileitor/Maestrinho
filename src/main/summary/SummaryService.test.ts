import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ConfigStore } from '../store/ConfigStore'
import type { PtyManager } from '../pty/PtyManager'
import { SummaryService, isLocalEndpoint } from './SummaryService'

describe('isLocalEndpoint', () => {
  it('reconhece endereços locais', () => {
    expect(isLocalEndpoint('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLocalEndpoint('http://localhost:1234/v1')).toBe(true)
    expect(isLocalEndpoint('https://api.exemplo.com/v1')).toBe(false)
    expect(isLocalEndpoint('lixo')).toBe(false)
  })
})

describe('SummaryService', () => {
  let server: http.Server
  let port = 0
  let lastBody: Record<string, unknown> | null = null
  let lastAuth: string | undefined
  let respond: (res: http.ServerResponse) => void

  beforeEach(async () => {
    lastBody = null
    respond = (res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: '<think>pensando</think>O agente rodou os testes e todos passaram.' } }] }))
    }
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        lastAuth = req.headers.authorization
        lastBody = req.url === '/v1/chat/completions' ? (JSON.parse(body) as Record<string, unknown>) : null
        if (req.url !== '/v1/chat/completions') {
          res.statusCode = 404
          res.end()
          return
        }
        respond(res)
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  function make(settings: Record<string, unknown>, screen = 'npm test\n✓ 12 testes passaram'): SummaryService {
    const config = {
      settings: {
        summaryEnabled: true,
        summaryEndpoint: `http://127.0.0.1:${port}/v1`,
        summaryModel: 'modelo-local',
        summaryApiKey: '',
        ...settings
      }
    } as unknown as ConfigStore
    const ptys = { readText: () => screen } as unknown as PtyManager
    return new SummaryService({ config, ptys })
  }

  it('envia a tela ao endpoint e devolve o resumo sem blocos <think>', async () => {
    const svc = make({ summaryApiKey: 'segredo' })
    const out = await svc.summarize('t1', 'construtor')
    expect(out).toBe('O agente rodou os testes e todos passaram.')
    expect(lastBody?.['model']).toBe('modelo-local')
    const messages = lastBody?.['messages'] as { role: string; content: string }[]
    expect(messages[1]!.content).toContain('12 testes passaram')
    expect(lastAuth).toBe('Bearer segredo')
  })

  it('desligado ou sem modelo: não chama a rede', async () => {
    await expect(make({ summaryEnabled: false }).summarize('t1', 'x')).rejects.toThrow(/desligado/)
    await expect(make({ summaryModel: '' }).summarize('t1', 'x')).rejects.toThrow(/desligado/)
    expect(lastBody).toBeNull()
  })

  it('erro HTTP vira mensagem clara', async () => {
    respond = (res) => {
      res.statusCode = 500
      res.end('{}')
    }
    await expect(make({}).summarize('t1', 'x')).rejects.toThrow(/500/)
  })

  it('tela vazia não gera chamada', async () => {
    await expect(make({}, '   ').summarize('t1', 'x')).rejects.toThrow(/sem saída|não tem saída/)
    expect(lastBody).toBeNull()
  })

  it('rejeita protocolos que não são http(s)', async () => {
    await expect(make({ summaryEndpoint: 'file:///etc/passwd' }).summarize('t1', 'x')).rejects.toThrow(/http/)
  })
})
