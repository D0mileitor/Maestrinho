/**
 * Utilitários SOMENTE para os testes do CLI (não são importados por orq.ts): servidor HTTP falso
 * da API local em 127.0.0.1 e uma implementação de CliIo em memória.
 */
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { ENV } from '@shared/constants'
import type { ApiErrorCode } from '@shared/api'
import { API_ERROR_STATUS } from '@shared/api'
import type { Env } from './client'
import { fileError, interruptedError, tooLargeInput, type CliIo } from './io'

export const TEST_TOKEN = 'tok_0123456789abcdef'

export interface FakeCall {
  method: string
  /** Corpo JSON recebido (já interpretado). */
  body: Record<string, unknown>
  headers: http.IncomingHttpHeaders
  httpMethod: string
  url: string
}

export interface FakeReply {
  status?: number
  json?: unknown
  /** Corpo cru (sobrepõe `json`). */
  raw?: string
  /** Não responde nunca (para testar tempo esgotado). */
  hang?: boolean
}

export type FakeHandler = (call: FakeCall) => FakeReply | Promise<FakeReply>

export function ok(result: unknown): FakeReply {
  return { status: 200, json: { ok: true, result } }
}

export function fail(code: ApiErrorCode, message: string): FakeReply {
  return { status: API_ERROR_STATUS[code], json: { ok: false, error: { code, message } } }
}

export interface FakeApi {
  port: number
  calls: FakeCall[]
  env: Env
  /** Chamadas de um método. */
  of(method: string): FakeCall[]
  close(): Promise<void>
}

export async function startFakeApi(handler: FakeHandler): Promise<FakeApi> {
  const calls: FakeCall[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      let body: Record<string, unknown>
      try {
        body = JSON.parse(text) as Record<string, unknown>
      } catch {
        body = { __invalid: text }
      }
      const url = req.url ?? ''
      const call: FakeCall = {
        method: url.replace(/^\/v1\//, ''),
        body,
        headers: req.headers,
        httpMethod: req.method ?? '',
        url
      }
      calls.push(call)
      void Promise.resolve(handler(call)).then((reply) => {
        if (reply.hang) return
        if (res.destroyed) return
        const payload = reply.raw ?? JSON.stringify(reply.json ?? {})
        res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(payload)
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    calls,
    env: { [ENV.port]: String(port), [ENV.token]: TEST_TOKEN },
    of: (method) => calls.filter((c) => c.method === method),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

/** Porta em que (quase certamente) ninguém escuta: abre e fecha um servidor. */
export async function closedPort(): Promise<number> {
  const server = http.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

export interface MemoryIoOptions {
  stdin?: string | Buffer
  stdinIsTTY?: boolean
  stdoutIsTTY?: boolean
  files?: Record<string, string | Buffer>
  signal?: AbortSignal
  now?: () => number
  /** Substitui a espera entre polls (padrão: espera real curta). */
  sleep?: CliIo['sleep']
}

export type MemoryIo = CliIo & { readonly stdout: string; readonly stderr: string; stdinReads: number }

export function memoryIo(opts: MemoryIoOptions = {}): MemoryIo {
  let stdout = ''
  let stderr = ''
  const io: MemoryIo = {
    get stdout() {
      return stdout
    },
    get stderr() {
      return stderr
    },
    stdinReads: 0,
    out: (t) => {
      stdout += t
    },
    err: (t) => {
      stderr += t
    },
    readStdin: async (maxBytes) => {
      io.stdinReads++
      if (opts.signal?.aborted) throw interruptedError()
      const buf = typeof opts.stdin === 'string' ? Buffer.from(opts.stdin, 'utf8') : (opts.stdin ?? Buffer.alloc(0))
      if (buf.length > maxBytes) throw tooLargeInput('o texto do stdin', maxBytes)
      return buf
    },
    readFile: async (file, maxBytes) => {
      const content = opts.files?.[file]
      if (content === undefined) throw fileError(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }), file)
      const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
      if (buf.length > maxBytes) throw tooLargeInput(`o arquivo "${file}"`, maxBytes)
      return buf
    },
    stdinIsTTY: opts.stdinIsTTY ?? false,
    stdoutIsTTY: opts.stdoutIsTTY ?? false,
    now: opts.now ?? (() => Date.now()),
    sleep:
      opts.sleep ??
      ((ms, signal) =>
        new Promise<void>((resolve, reject) => {
          if (signal?.aborted) return reject(interruptedError())
          const t = setTimeout(resolve, Math.min(ms, 20))
          signal?.addEventListener('abort', () => {
            clearTimeout(t)
            reject(interruptedError())
          })
        })),
    signal: opts.signal,
    version: () => '9.9.9'
  }
  return io
}
