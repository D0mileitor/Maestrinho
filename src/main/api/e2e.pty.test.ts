import * as os from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody, ApiOkBody, SendResult, WaitResult } from '@shared/api'
import type { WorkspaceOp } from '@shared/ipc'
import { AgentPresetSchema, type CanvasNode, type TerminalNodeData, type WorkspaceDoc } from '@shared/schemas'
import { applyWorkspaceOps } from '@shared/workspaceOps'
import { PtyManager } from '../pty/PtyManager'
import { createApiHandlers, type ApiHandlers } from './handlers'
import { LocalApi } from './LocalApi'
import type { ApiDeps } from './types'

/**
 * Ponta a ponta com um PTY real: cliente HTTP -> LocalApi -> handlers -> MessageService ->
 * PtyManager (shell de verdade) -> detector de ociosidade -> `wait` devolve a saída.
 */

const isWin = process.platform === 'win32'
// cmd.exe com prompt ">" (rápido de iniciar); no Linux, sh com PS1 "$ ".
const SHELL = isWin ? { command: 'cmd.exe', args: ['/Q', '/K', 'prompt $G'] } : { command: '/bin/sh', args: ['-i'] }
const COMMAND = isWin ? 'set /a 6*7' : 'echo $((6*7))'
const TOKEN = 'token-e2e-0123456789'

const SHELL_PRESET = AgentPresetSchema.parse({
  id: 'shell',
  label: 'Shell',
  command: SHELL.command,
  args: SHELL.args,
  inputMode: 'raw',
  submitDelayMs: 50,
  idleMs: 800,
  idlePatterns: ['>\\s?$', '[$#]\\s?$'],
  messageTemplate: '{text}',
  isShell: true
})

function terminal(id: string, name: string): TerminalNodeData {
  return { id, kind: 'terminal', name, presetId: 'shell', cwd: '', autoStart: true, position: { x: 0, y: 0 }, size: { w: 600, h: 420 } }
}

async function post<T>(port: number, method: string, body: unknown): Promise<ApiOkBody<T> | ApiErrorBody> {
  const res = await fetch(`http://127.0.0.1:${port}/v1/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body)
  })
  return (await res.json()) as ApiOkBody<T> | ApiErrorBody
}

async function until(cond: () => boolean, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > end) throw new Error('tempo esgotado esperando condição')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('ponta a ponta: send --wait com PTY real', () => {
  const ptys = new PtyManager()
  let api: LocalApi
  let handlers: ApiHandlers
  let port = 0

  beforeAll(async () => {
    const nodes: CanvasNode[] = [terminal('t-orig', 'origem'), terminal('t-alvo', 'alvo')]
    let doc: WorkspaceDoc = {
      version: 1,
      id: 'ws-e2e',
      name: 'e2e',
      nodes,
      edges: [{ id: 'e-1', source: 't-orig', target: 't-alvo' }],
      viewport: { x: 0, y: 0, zoom: 1 },
      floors: []
    }
    const ws = {
      dir: os.tmpdir(),
      get doc() {
        return doc
      },
      apply(ops: WorkspaceOp[]) {
        doc = applyWorkspaceOps(doc, ops)
      }
    }
    const deps = {
      workspaces: {
        nodeById: (id: string) => {
          const node = doc.nodes.find((n) => n.id === id)
          return node ? { ws, node } : undefined
        }
      },
      terminals: { presetFor: () => SHELL_PRESET, resolveCwd: () => os.tmpdir() },
      ptys,
      config: { presets: [SHELL_PRESET], roles: [], preset: () => SHELL_PRESET, role: () => undefined, findRole: () => undefined },
      notes: {},
      applyMainOps: (target: typeof ws, ops: WorkspaceOp[]) => target.apply(ops),
      notify: () => undefined,
      emitEdgeActivity: () => undefined
    } as unknown as ApiDeps
    handlers = createApiHandlers(deps, { messages: { pollIntervalMs: 50 } })
    api = new LocalApi({
      resolveCaller: (t) => (t === TOKEN ? 't-orig' : undefined),
      dispatch: (id, m, b, signal) => handlers.dispatch(id, m, b, signal)
    })
    port = await api.start()

    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    if (!isWin) env['PS1'] = '$ '
    ptys.create({
      id: 't-alvo',
      command: SHELL.command,
      args: SHELL.args,
      cwd: os.tmpdir(),
      env,
      cols: 100,
      rows: 30,
      idleMs: SHELL_PRESET.idleMs,
      idlePatterns: SHELL_PRESET.idlePatterns
    })
  })

  afterAll(async () => {
    handlers?.dispose()
    await api?.stop()
    ptys.disposeAll()
  })

  it('entrega o comando ao shell conectado e devolve a saída quando ele fica ocioso', async () => {
    expect(ptys.info('t-alvo')?.status).toBe('running')

    const sent = await post<SendResult>(port, 'send', { to: 'alvo', text: COMMAND, wait: true })
    expect(sent.ok).toBe(true)
    const { messageId } = (sent as ApiOkBody<SendResult>).result
    // A espera pelo "ready" (primeira ociosidade do shell) acontece dentro do send.
    expect(ptys.info('t-alvo')?.ready).toBe(true)

    let result: WaitResult | null = null
    const deadline = Date.now() + 25_000
    while (!result?.done && Date.now() < deadline) {
      const r = await post<WaitResult>(port, 'wait', { messageId, pollMs: 5000, lines: 30 })
      expect(r.ok).toBe(true)
      result = (r as ApiOkBody<WaitResult>).result
    }
    expect(result?.done).toBe(true)
    expect(result?.reason).toBe('idle')
    // "42" sozinho numa linha = o shell executou (a linha digitada contém "6*7", não "42").
    const lines = (result?.output ?? '').split('\n').map((l) => l.trim())
    expect(lines).toContain('42')
  })

  it('read devolve a tela atual do peer e o processo encerrado vira "exited" no wait', async () => {
    const read = await post<{ text: string; status: string }>(port, 'read', { peer: 'alvo', lines: 50 })
    expect(read.ok).toBe(true)
    expect((read as ApiOkBody<{ text: string }>).result.text).toContain('42')

    const sent = await post<SendResult>(port, 'send', { to: 'alvo', text: 'exit', wait: true })
    const { messageId } = (sent as ApiOkBody<SendResult>).result
    await until(() => ptys.info('t-alvo')?.status === 'exited', 15_000)
    const r = await post<WaitResult>(port, 'wait', { messageId, pollMs: 5000 })
    expect((r as ApiOkBody<WaitResult>).result).toMatchObject({ done: true, reason: 'exited' })
  })
})
