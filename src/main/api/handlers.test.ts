import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiMethod } from '@shared/api'
import type { WorkspaceOp } from '@shared/ipc'
import type { EdgeActivityEvent, TerminalRuntimeInfo } from '@shared/runtime'
import {
  AgentPresetSchema,
  RoleSchema,
  type AgentPreset,
  type CanvasEdge,
  type CanvasNode,
  type Role,
  type TerminalNodeData,
  type WorkspaceDoc
} from '@shared/schemas'
import { applyWorkspaceOps } from '@shared/workspaceOps'
import { createApiHandlers, type ApiHandlers, type ApiHandlersOptions } from './handlers'
import { normalizeName } from './graph'
import { RateLimiter } from './RateLimiter'
import type { ApiDeps } from './types'
import type { PortalApi } from '../portals/PortalRegistry'

// ------------------------------------------------------------------ dublês

class FakeStore {
  constructor(
    readonly dir: string,
    public doc: WorkspaceDoc
  ) {}
  apply(ops: WorkspaceOp[]): void {
    this.doc = applyWorkspaceOps(this.doc, ops)
  }
}

class FakeWorkspaces {
  constructor(readonly stores: FakeStore[]) {}
  nodeById(id: string): { ws: FakeStore; node: CanvasNode } | undefined {
    for (const ws of this.stores) {
      const node = ws.doc.nodes.find((n) => n.id === id)
      if (node) return { ws, node }
    }
    return undefined
  }
  forNode(id: string): FakeStore | undefined {
    return this.nodeById(id)?.ws
  }
}

interface FakeRuntime {
  status: TerminalRuntimeInfo['status']
  activity: TerminalRuntimeInfo['activity']
  ready?: boolean
  pid?: number
  badge?: string
  waitingOn?: string
  lastActivity: number
  lastUserInput: number
  screen: string
}

class FakePtys {
  readonly rt = new Map<string, FakeRuntime>()
  readonly injected: { id: string; text: string; opts: { inputMode: string; submitDelayMs: number; isShell: boolean } }[] = []
  readonly waitingLog: { id: string; peer: string | undefined }[] = []
  private nextPid = 1000
  readTextCalls: { id: string; lines: number }[] = []

  run(id: string, patch: Partial<FakeRuntime> = {}): FakeRuntime {
    const r: FakeRuntime = {
      status: 'running',
      activity: 'idle',
      ready: true,
      pid: this.nextPid++,
      lastActivity: Number.NEGATIVE_INFINITY,
      lastUserInput: Number.NEGATIVE_INFINITY,
      screen: '',
      ...patch
    }
    this.rt.set(id, r)
    return r
  }
  has(id: string): boolean {
    return this.rt.has(id)
  }
  info(id: string): TerminalRuntimeInfo | undefined {
    const r = this.rt.get(id)
    if (!r) return undefined
    return {
      id,
      status: r.status,
      activity: r.activity,
      ready: r.ready,
      pid: r.pid,
      badge: r.badge,
      waitingOn: r.waitingOn,
      attentionSeq: 0,
      cols: 80,
      rows: 24
    }
  }
  readText(id: string, lines: number): string | null {
    this.readTextCalls.push({ id, lines })
    const r = this.rt.get(id)
    return r ? r.screen.split('\n').slice(-lines).join('\n') : null
  }
  lastActivity(id: string): number {
    return this.rt.get(id)?.lastActivity ?? Number.NEGATIVE_INFINITY
  }
  lastUserInputAt(id: string): number {
    return this.rt.get(id)?.lastUserInput ?? Number.NEGATIVE_INFINITY
  }
  setWaitingOn(id: string, peer: string | undefined): void {
    this.waitingLog.push({ id, peer })
    const r = this.rt.get(id)
    if (r) r.waitingOn = peer
  }
  setBadge(id: string, badge: string | undefined): void {
    const r = this.rt.get(id)
    if (r) r.badge = badge
  }
  async inject(id: string, text: string, opts: { inputMode: string; submitDelayMs: number; isShell: boolean }): Promise<void> {
    const r = this.rt.get(id)
    if (!r || r.status !== 'running') throw new Error('o processo do terminal não está em execução')
    this.injected.push({ id, text, opts })
  }
  dispose(id: string): void {
    this.rt.delete(id)
  }
}

const PRESETS: AgentPreset[] = [
  AgentPresetSchema.parse({
    id: 'shell',
    label: 'Shell',
    command: 'sh',
    inputMode: 'raw',
    submitDelayMs: 30,
    messageTemplate: '{text}',
    isShell: true
  }),
  AgentPresetSchema.parse({ id: 'claude', label: 'Claude Code', command: 'claude', inputMode: 'bracketed', submitDelayMs: 300 }),
  AgentPresetSchema.parse({ id: 'codex', label: 'Codex', command: 'codex' })
]

const ROLES: Role[] = [
  RoleSchema.parse({ id: 'revisor', name: 'Revisor', instructions: 'Revise o código.' }),
  RoleSchema.parse({ id: 'construtor', name: 'Construtor', instructions: 'Construa.' }),
  RoleSchema.parse({ id: 'lider', name: 'Líder', instructions: 'Lidere.' })
]

class FakeConfig {
  presetsList = structuredClone(PRESETS)
  rolesList = structuredClone(ROLES)
  saved: Role[] = []
  get presets(): AgentPreset[] {
    return structuredClone(this.presetsList)
  }
  get roles(): Role[] {
    return structuredClone(this.rolesList)
  }
  preset(id: string): AgentPreset | undefined {
    return this.presetsList.find((p) => p.id === id)
  }
  role(id: string): Role | undefined {
    return this.rolesList.find((r) => r.id === id)
  }
  findRole(ref: string): Role | undefined {
    const key = normalizeName(ref)
    return this.rolesList.find((r) => r.id === ref || normalizeName(r.id) === key || normalizeName(r.name) === key)
  }
  saveRole(role: Role): Role[] {
    const valid = RoleSchema.parse(role)
    this.saved.push(valid)
    const idx = this.rolesList.findIndex((r) => r.id === valid.id)
    if (idx >= 0) this.rolesList[idx] = valid
    else this.rolesList.push(valid)
    return this.roles
  }
}

function revisionOf(content: string): string {
  return `rev-${content.length}`
}

class FakeNotes {
  readonly files = new Map<string, string>([
    ['spec.md', '# Spec\n'],
    ['privada.md', 'segredo']
  ])
  async list(): Promise<{ file: string; size: number; mtimeMs: number }[]> {
    return [...this.files].map(([file, c]) => ({ file, size: c.length, mtimeMs: 123 }))
  }
  async exists(_dir: string, file: string): Promise<boolean> {
    return this.files.has(file)
  }
  async read(_dir: string, file: string): Promise<{ content: string; revision: string }> {
    const content = this.files.get(file)
    if (content === undefined) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    return { content, revision: revisionOf(content) }
  }
  async write(_dir: string, file: string, content: string, ifRevision?: string): Promise<{ revision: string }> {
    if (ifRevision !== undefined && ifRevision !== revisionOf(this.files.get(file) ?? '')) {
      throw new ApiError('precondition', 'A nota mudou desde a leitura.')
    }
    this.files.set(file, content)
    return { revision: revisionOf(content) }
  }
  async append(_dir: string, file: string, content: string): Promise<{ revision: string }> {
    const next = (this.files.get(file) ?? '') + content
    this.files.set(file, next)
    return { revision: revisionOf(next) }
  }
  async create(): Promise<string> {
    return 'nova.md'
  }
}

// ------------------------------------------------------------------ cenário

const SIZE = { w: 600, h: 420 }

function term(id: string, name: string, extra: Partial<TerminalNodeData> = {}): TerminalNodeData {
  return { id, kind: 'terminal', name, presetId: 'shell', cwd: '', autoStart: true, position: { x: 0, y: 0 }, size: SIZE, ...extra }
}

function baseDoc(): WorkspaceDoc {
  const nodes: CanvasNode[] = [
    term('t-ger', 'gerente', { manager: true, presetId: 'claude', position: { x: 0, y: 0 } }),
    term('t-con', 'construtor', { presetId: 'claude', position: { x: 2000, y: 0 }, roleId: 'construtor' }),
    term('t-rev', 'revisor', { position: { x: 3000, y: 0 } }),
    term('t-sol', 'solitario', { position: { x: 4000, y: 0 } }),
    term('t-off', 'desligado', { position: { x: 5000, y: 0 } }),
    { id: 'n-spec', kind: 'note', file: 'spec.md', position: { x: 700, y: 0 }, size: { w: 400, h: 320 } },
    { id: 'n-priv', kind: 'note', file: 'privada.md', position: { x: 4000, y: 600 }, size: { w: 400, h: 320 } },
    { id: 'p-docs', kind: 'portal', url: 'https://example.com/docs', title: 'Docs', position: { x: 2000, y: 600 }, size: { w: 800, h: 560 } }
  ]
  const edges: CanvasEdge[] = [
    { id: 'e-ger-con', source: 't-ger', target: 't-con' },
    { id: 'e-con-rev', source: 't-con', target: 't-rev' },
    { id: 'e-ger-spec', source: 'n-spec', target: 't-ger' },
    { id: 'e-con-spec', source: 't-con', target: 'n-spec' },
    { id: 'e-con-docs', source: 't-con', target: 'p-docs' },
    { id: 'e-sol-priv', source: 't-sol', target: 'n-priv' },
    { id: 'e-con-off', source: 't-con', target: 't-off' }
  ]
  return {
    version: 1,
    id: 'ws-1',
    name: 'Projeto',
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    floors: [
      {
        id: 'f-1',
        name: 'Experimento',
        branch: 'exp/1',
        baseBranch: 'main',
        worktreePath: '/tmp/exp',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
  }
}

interface Env {
  store: FakeStore
  ptys: FakePtys
  config: FakeConfig
  notes: FakeNotes
  deps: ApiDeps
  applyMainOps: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  edges: EdgeActivityEvent[]
  ensure: ReturnType<typeof vi.fn>
  restart: ReturnType<typeof vi.fn>
  api: ApiHandlers
  call(caller: string, method: ApiMethod, body?: unknown, signal?: AbortSignal): Promise<unknown>
  fail(caller: string, method: ApiMethod, body?: unknown): Promise<ApiError>
  node(id: string): CanvasNode | undefined
  byName(name: string): TerminalNodeData | undefined
}

/** Opções rápidas para os testes (esperas curtas). */
const FAST: ApiHandlersOptions = {
  messages: { pollIntervalMs: 5, userQuietMs: 60, maxUserDeferMs: 400, readyWaitMs: 400 }
}

let current: Env | null = null

function setup(opts: ApiHandlersOptions = FAST): Env {
  const store = new FakeStore('/ws/projeto', baseDoc())
  const workspaces = new FakeWorkspaces([store])
  const ptys = new FakePtys()
  for (const id of ['t-ger', 't-con', 't-rev', 't-sol']) ptys.run(id)
  const config = new FakeConfig()
  const notes = new FakeNotes()
  const edges: EdgeActivityEvent[] = []
  const applyMainOps = vi.fn((ws: FakeStore, ops: WorkspaceOp[]) => ws.apply(ops))
  const notify = vi.fn()
  const ensure = vi.fn((id: string) => {
    ptys.run(id)
    return ptys.info(id)
  })
  const restart = vi.fn((id: string) => ptys.info(id) ?? null)
  const terminals = {
    presetFor: (node: TerminalNodeData) => config.preset(node.presetId) ?? config.preset('shell')!,
    resolveCwd: () => '/ws/projeto',
    ensure,
    restart,
    node: (id: string) => {
      const n = store.doc.nodes.find((x) => x.id === id)
      return n?.kind === 'terminal' ? n : undefined
    }
  }
  const deps = {
    workspaces,
    terminals,
    ptys,
    config,
    notes,
    applyMainOps,
    notify,
    emitEdgeActivity: (e: EdgeActivityEvent) => edges.push(e)
  } as unknown as ApiDeps
  const api = createApiHandlers(deps, opts)
  const env: Env = {
    store,
    ptys,
    config,
    notes,
    deps,
    applyMainOps,
    notify,
    edges,
    ensure,
    restart,
    api,
    call: (caller, method, body = {}, signal) => api.dispatch(caller, method, body, signal),
    fail: async (caller, method, body = {}) => {
      try {
        await api.dispatch(caller, method, body)
      } catch (err) {
        if (err instanceof ApiError) return err
        throw err
      }
      throw new Error(`esperava ApiError em ${method}`)
    },
    node: (id) => store.doc.nodes.find((n) => n.id === id),
    byName: (name) => store.doc.nodes.find((n): n is TerminalNodeData => n.kind === 'terminal' && n.name === name)
  }
  current = env
  return env
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

afterEach(() => {
  current?.api.dispose()
  current = null
})

// ------------------------------------------------------------------ identidade e validação

describe('dispatch: identidade e validação', () => {
  it('chamador desconhecido (ou que não é terminal) é recusado', async () => {
    const env = setup()
    expect((await env.fail('t-inexistente', 'whoami')).code).toBe('unauthorized')
    expect((await env.fail('n-spec', 'whoami')).code).toBe('unauthorized')
  })

  it('valida o corpo também no dispatch (defesa em profundidade)', async () => {
    const env = setup()
    const err = await env.fail('t-con', 'send', { to: 'revisor' })
    expect(err.code).toBe('bad_request')
    expect(err.message).toContain('"text"')
    expect((await env.fail('t-con', 'whoami', { id: 't-ger' })).code).toBe('bad_request')
  })
})

describe('whoami e peers', () => {
  it('whoami descreve o próprio terminal', async () => {
    const env = setup()
    const me = (await env.call('t-con', 'whoami')) as Record<string, unknown>
    expect(me).toMatchObject({
      id: 't-con',
      name: 'construtor',
      role: { id: 'construtor', name: 'Construtor', instructions: 'Construa.' },
      manager: false,
      preset: { id: 'claude', label: 'Claude Code' },
      workspace: { dir: '/ws/projeto', name: 'Projeto' },
      floor: null,
      cwd: '/ws/projeto',
      peers: { terminals: 3, notes: 1 }
    })
    const ger = (await env.call('t-ger', 'whoami')) as Record<string, unknown>
    expect(ger['manager']).toBe(true)
  })

  it('peers lista só o que está conectado (terminais, notas e portais)', async () => {
    const env = setup()
    env.ptys.setBadge('t-rev', 'revisando')
    const peers = (await env.call('t-con', 'peers')) as {
      terminals: { name: string; status: string; manager?: boolean; badge?: string; preset: string; role: string | null }[]
      notes: { file: string }[]
      portals: { url: string; title?: string }[]
    }
    expect(peers.terminals.map((t) => t.name)).toEqual(['desligado', 'gerente', 'revisor'])
    expect(peers.terminals.find((t) => t.name === 'desligado')?.status).toBe('stopped')
    expect(peers.terminals.find((t) => t.name === 'gerente')).toMatchObject({ manager: true, preset: 'Claude Code', role: null })
    expect(peers.terminals.find((t) => t.name === 'revisor')?.badge).toBe('revisando')
    expect(peers.notes.map((n) => n.file)).toEqual(['spec.md'])
    expect(peers.portals).toEqual([{ id: 'p-docs', url: 'https://example.com/docs', title: 'Docs' }])
    const lonely = (await env.call('t-sol', 'peers')) as { terminals: unknown[]; notes: { file: string }[] }
    expect(lonely.terminals).toEqual([])
    expect(lonely.notes.map((n) => n.file)).toEqual(['privada.md'])
  })
})

// ------------------------------------------------------------------ mensagens

describe('send', () => {
  it('recusa destino sem conexão com mensagem clara', async () => {
    const env = setup()
    const err = await env.fail('t-con', 'send', { to: 'solitario', text: 'oi' })
    expect(err.code).toBe('forbidden')
    expect(err.message).toBe(
      'Não há conexão entre "construtor" e "solitario" no canvas. Peça ao usuário para conectar os dois terminais.'
    )
    expect(env.ptys.injected).toHaveLength(0)
  })

  it('recusa enviar para si mesmo e destino inexistente', async () => {
    const env = setup()
    expect((await env.fail('t-con', 'send', { to: 'CONSTRUTOR', text: 'oi' })).code).toBe('bad_request')
    const nf = await env.fail('t-con', 'send', { to: 'fantasma', text: 'oi' })
    expect(nf.code).toBe('not_found')
    expect(nf.message).toContain('"revisor"')
  })

  it('entrega o texto formatado com o modelo do preset do DESTINO via inject', async () => {
    const env = setup()
    const res = (await env.call('t-con', 'send', { to: 'gerente', text: 'Pronto: veja o diff' })) as Record<string, unknown>
    expect(res).toMatchObject({ to: 'gerente', delivered: true })
    expect(typeof res['messageId']).toBe('string')
    expect(env.ptys.injected).toHaveLength(1)
    const [msg] = env.ptys.injected
    expect(msg!.id).toBe('t-ger')
    expect(msg!.text).toBe(
      '[Mensagem de "construtor" via orq] Pronto: veja o diff\n(Para responder: orq send construtor "<sua resposta>")'
    )
    expect(msg!.opts).toEqual({ inputMode: 'bracketed', submitDelayMs: 300, isShell: false })
    expect(env.edges).toEqual([{ from: 't-con', to: 't-ger', kind: 'send' }])

    // Shell: modelo "{text}" e modo raw.
    await env.call('t-con', 'send', { to: 'revisor', text: 'npm test' })
    expect(env.ptys.injected[1]).toEqual({ id: 't-rev', text: 'npm test', opts: { inputMode: 'raw', submitDelayMs: 30, isShell: true } })
  })

  it('a atividade da conexão leva só o tom da mensagem (reprovação/aprovação), nunca o texto', async () => {
    const env = setup()
    await env.call('t-con', 'send', { to: 'gerente', text: 'REPROVADO rodada 2: o filtro não funciona' })
    await env.call('t-con', 'send', { to: 'gerente', text: 'APROVADO rodada 3' })
    expect(env.edges).toEqual([
      { from: 't-con', to: 't-ger', kind: 'send', mood: 'complaint' },
      { from: 't-con', to: 't-ger', kind: 'send', mood: 'praise' }
    ])
  })

  it('conexão vale nos dois sentidos', async () => {
    const env = setup()
    await env.call('t-rev', 'send', { to: 'construtor', text: 'feito' })
    expect(env.ptys.injected[0]!.id).toBe('t-con')
  })

  it('destino parado ou encerrado: unavailable', async () => {
    const env = setup()
    const stopped = await env.fail('t-con', 'send', { to: 'desligado', text: 'oi' })
    expect(stopped.code).toBe('unavailable')
    expect(stopped.message).toContain('"desligado"')
    env.ptys.rt.get('t-rev')!.status = 'exited'
    expect((await env.fail('t-con', 'send', { to: 'revisor', text: 'oi' })).code).toBe('unavailable')
  })

  it('limita a taxa por conexão (nos dois sentidos) para cortar ping-pong', async () => {
    const env = setup({ ...FAST, messages: { ...FAST.messages, limiter: new RateLimiter({ limit: 3, windowMs: 60_000 }) } })
    await env.call('t-con', 'send', { to: 'revisor', text: '1' })
    await env.call('t-rev', 'send', { to: 'construtor', text: '2' })
    await env.call('t-con', 'send', { to: 'revisor', text: '3' })
    const err = await env.fail('t-rev', 'send', { to: 'construtor', text: '4' })
    expect(err.code).toBe('rate_limited')
    expect(err.message).toContain('"revisor" e "construtor"')
    expect(err.message).toMatch(/Aguarde \d+ s/)
    expect(env.ptys.injected).toHaveLength(3)
    // Outra conexão não é afetada.
    await env.call('t-con', 'send', { to: 'gerente', text: 'ok' })
    expect(env.ptys.injected).toHaveLength(4)
  })

  it('espera o usuário parar de digitar no destino antes de injetar', async () => {
    const env = setup()
    const rev = env.ptys.rt.get('t-rev')!
    rev.lastUserInput = Date.now()
    const started = Date.now()
    const p = env.call('t-con', 'send', { to: 'revisor', text: 'oi' })
    await delay(20)
    expect(env.ptys.injected).toHaveLength(0)
    await p
    expect(Date.now() - started).toBeGreaterThanOrEqual(50)
    expect(env.ptys.injected).toHaveLength(1)
  })

  it('não espera para sempre se o usuário continuar digitando', async () => {
    const env = setup()
    const rev = env.ptys.rt.get('t-rev')!
    rev.lastUserInput = Date.now()
    const typing = setInterval(() => (rev.lastUserInput = Date.now()), 5)
    try {
      const started = Date.now()
      await env.call('t-con', 'send', { to: 'revisor', text: 'oi' })
      expect(Date.now() - started).toBeGreaterThanOrEqual(380)
      expect(env.ptys.injected).toHaveLength(1)
    } finally {
      clearInterval(typing)
    }
  })

  it('espera o destino terminar de iniciar (ready) antes de colar', async () => {
    const env = setup()
    const rev = env.ptys.rt.get('t-rev')!
    rev.ready = false
    const p = env.call('t-con', 'send', { to: 'revisor', text: 'oi' })
    await delay(30)
    expect(env.ptys.injected).toHaveLength(0)
    rev.ready = true
    await p
    expect(env.ptys.injected).toHaveLength(1)
  })

  it('revalida a conexão depois da espera (usuário removeu a aresta no meio)', async () => {
    const env = setup()
    env.ptys.rt.get('t-rev')!.lastUserInput = Date.now()
    const p = env.fail('t-con', 'send', { to: 'revisor', text: 'oi' })
    await delay(10)
    env.store.apply([{ op: 'removeEdges', ids: ['e-con-rev'] }])
    const err = await p
    expect(err.code).toBe('forbidden')
    expect(env.ptys.injected).toHaveLength(0)
  })
})

describe('wait (send --wait)', () => {
  it('termina quando o destino fica ocioso depois de atividade real após o envio', async () => {
    const env = setup()
    const rev = env.ptys.rt.get('t-rev')!
    rev.screen = 'linha 1\nlinha 2\nresposta final'
    const { messageId } = (await env.call('t-con', 'send', { to: 'revisor', text: 'revise', wait: true })) as { messageId: string }
    expect(env.ptys.rt.get('t-con')!.waitingOn).toBe('revisor')

    const waiting = env.call('t-con', 'wait', { messageId, pollMs: 3000, lines: 2 }) as Promise<Record<string, unknown>>
    await delay(30)
    // Atividade: o destino processa...
    rev.activity = 'busy'
    rev.lastActivity = Date.now()
    await delay(30)
    // ...e fica ocioso.
    rev.activity = 'idle'
    const res = await waiting
    expect(res).toEqual({ done: true, reason: 'idle', output: 'linha 2\nresposta final', to: 'revisor' })
    expect(env.ptys.rt.get('t-con')!.waitingOn).toBeUndefined()
    expect(env.edges).toContainEqual({ from: 't-rev', to: 't-con', kind: 'read' })
    // A espera foi consumida.
    expect((await env.fail('t-con', 'wait', { messageId })).code).toBe('not_found')
  })

  it('ociosidade sem atividade depois do envio não conta', async () => {
    const env = setup()
    const rev = env.ptys.rt.get('t-rev')!
    rev.lastActivity = Date.now() - 1000 // atividade antiga, antes do envio
    const { messageId } = (await env.call('t-con', 'send', { to: 'revisor', text: 'x', wait: true })) as { messageId: string }
    const res = await env.call('t-con', 'wait', { messageId, pollMs: 60 })
    expect(res).toEqual({ done: false, to: 'revisor' })
    expect(env.ptys.rt.get('t-con')!.waitingOn).toBe('revisor')
  })

  it('devolve done=false ao vencer o pollMs enquanto o destino trabalha', async () => {
    const env = setup()
    const { messageId } = (await env.call('t-con', 'send', { to: 'revisor', text: 'x', wait: true })) as { messageId: string }
    const rev = env.ptys.rt.get('t-rev')!
    rev.activity = 'busy'
    rev.lastActivity = Date.now() + 5
    const started = Date.now()
    const res = await env.call('t-con', 'wait', { messageId, pollMs: 80 })
    expect(res).toEqual({ done: false, to: 'revisor' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(70)
  })

  it('termina com "exited" se o processo do destino encerra, é descartado ou reiniciado', async () => {
    const env = setup()
    const send = async (): Promise<string> =>
      ((await env.call('t-con', 'send', { to: 'revisor', text: 'x', wait: true })) as { messageId: string }).messageId

    const a = await send()
    env.ptys.rt.get('t-rev')!.status = 'exited'
    expect(await env.call('t-con', 'wait', { messageId: a, pollMs: 500 })).toMatchObject({ done: true, reason: 'exited' })

    env.ptys.rt.get('t-rev')!.status = 'running'
    const b = await send()
    env.ptys.rt.get('t-rev')!.pid = 99_999 // reiniciado
    expect(await env.call('t-con', 'wait', { messageId: b, pollMs: 500 })).toMatchObject({ done: true, reason: 'exited' })

    const c = await send()
    env.ptys.dispose('t-rev')
    expect(await env.call('t-con', 'wait', { messageId: c, pollMs: 500 })).toMatchObject({ done: true, reason: 'exited', output: '' })
  })

  it('só quem enviou pode acompanhar a mensagem', async () => {
    const env = setup()
    const { messageId } = (await env.call('t-con', 'send', { to: 'revisor', text: 'x', wait: true })) as { messageId: string }
    const err = await env.fail('t-ger', 'wait', { messageId, pollMs: 10 })
    expect(err.code).toBe('not_found')
    expect(env.api.messages.pendingCount).toBe(1)
  })

  it('cancel encerra a espera e limpa o "aguardando"', async () => {
    const env = setup()
    const { messageId } = (await env.call('t-con', 'send', { to: 'revisor', text: 'x', wait: true })) as { messageId: string }
    expect(await env.call('t-con', 'wait', { messageId, cancel: true })).toEqual({ done: true, reason: 'cancelled', to: 'revisor' })
    expect(env.ptys.rt.get('t-con')!.waitingOn).toBeUndefined()
    expect(env.api.messages.pendingCount).toBe(0)
  })

  it('"aguardando" mostra a espera mais recente enquanto houver outra pendente', async () => {
    const env = setup()
    const first = (await env.call('t-con', 'send', { to: 'revisor', text: 'x', wait: true })) as { messageId: string }
    await delay(2)
    await env.call('t-con', 'send', { to: 'gerente', text: 'y', wait: true })
    expect(env.ptys.rt.get('t-con')!.waitingOn).toBe('gerente')
    await env.call('t-con', 'wait', { messageId: first.messageId, cancel: true })
    expect(env.ptys.rt.get('t-con')!.waitingOn).toBe('gerente')
  })

  it('cliente desconectado (abort) encerra o long-poll sem consumir a espera', async () => {
    const env = setup()
    const { messageId } = (await env.call('t-con', 'send', { to: 'revisor', text: 'x', wait: true })) as { messageId: string }
    const ctrl = new AbortController()
    const started = Date.now()
    const p = env.call('t-con', 'wait', { messageId, pollMs: 20_000 }, ctrl.signal)
    await delay(20)
    ctrl.abort()
    expect(await p).toEqual({ done: false, to: 'revisor' })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(env.api.messages.pendingCount).toBe(1)
  })

  it('esperas abandonadas ou vencidas são descartadas pela limpeza', async () => {
    const env = setup({ messages: { ...FAST.messages, orphanMs: 1000, waitTtlMs: 10_000 } })
    await env.call('t-con', 'send', { to: 'revisor', text: 'x', wait: true })
    env.api.messages.sweep(Date.now() + 500)
    expect(env.api.messages.pendingCount).toBe(1)
    env.api.messages.sweep(Date.now() + 1500)
    expect(env.api.messages.pendingCount).toBe(0)
    expect(env.ptys.rt.get('t-con')!.waitingOn).toBeUndefined()
  })

  it('dispose encerra long-polls em andamento', async () => {
    const env = setup()
    const { messageId } = (await env.call('t-con', 'send', { to: 'revisor', text: 'x', wait: true })) as { messageId: string }
    const p = env.call('t-con', 'wait', { messageId, pollMs: 20_000 })
    await delay(10)
    env.api.dispose()
    expect(await p).toMatchObject({ done: true, reason: 'cancelled' })
    expect(env.api.messages.pendingCount).toBe(0)
  })
})

describe('read', () => {
  it('lê a tela de um peer conectado (padrão 50 linhas) e anima a aresta', async () => {
    const env = setup()
    env.ptys.rt.get('t-rev')!.screen = 'a\nb\nc'
    const res = await env.call('t-con', 'read', { peer: 'revisor' })
    expect(res).toEqual({ name: 'revisor', text: 'a\nb\nc', status: 'running', activity: 'idle' })
    expect(env.ptys.readTextCalls.at(-1)).toEqual({ id: 't-rev', lines: 50 })
    expect(env.edges).toEqual([{ from: 't-rev', to: 't-con', kind: 'read' }])
    const stopped = await env.call('t-con', 'read', { peer: 'desligado', lines: 5 })
    expect(stopped).toEqual({ name: 'desligado', text: '', status: 'stopped', activity: 'idle' })
  })

  it('recusa ler terminal não conectado', async () => {
    const env = setup()
    const err = await env.fail('t-rev', 'read', { peer: 'gerente' })
    expect(err.code).toBe('forbidden')
    expect(err.message).toContain('Não há conexão entre "revisor" e "gerente"')
  })
})

// ------------------------------------------------------------------ notas, notify, status

describe('notas', () => {
  it('note.list mostra só as notas conectadas', async () => {
    const env = setup()
    expect(await env.call('t-con', 'note.list')).toEqual({ notes: [{ id: 'n-spec', file: 'spec.md', size: 7, mtimeMs: 123 }] })
    expect(await env.call('t-rev', 'note.list')).toEqual({ notes: [] })
  })

  it('note.read / write / append em nota conectada, com animação da aresta', async () => {
    const env = setup()
    expect(await env.call('t-con', 'note.read', { note: 'SPEC' })).toEqual({
      id: 'n-spec',
      file: 'spec.md',
      content: '# Spec\n',
      revision: 'rev-7'
    })
    expect(await env.call('t-con', 'note.write', { note: 'spec.md', content: 'novo', ifRevision: 'rev-7' })).toEqual({
      id: 'n-spec',
      file: 'spec.md',
      revision: 'rev-4'
    })
    expect(await env.call('t-con', 'note.append', { note: 'n-spec', content: '+1' })).toEqual({
      id: 'n-spec',
      file: 'spec.md',
      revision: 'rev-6'
    })
    expect(env.notes.files.get('spec.md')).toBe('novo+1')
    expect(env.edges).toEqual([
      { from: 'n-spec', to: 't-con', kind: 'note' },
      { from: 't-con', to: 'n-spec', kind: 'note' },
      { from: 't-con', to: 'n-spec', kind: 'note' }
    ])
  })

  it('recusa nota não conectada e repassa conflitos de revisão', async () => {
    const env = setup()
    const err = await env.fail('t-con', 'note.read', { note: 'privada' })
    expect(err.code).toBe('forbidden')
    expect(err.message).toContain('"privada.md" não está conectada a "construtor"')
    expect(env.notes.files.get('privada.md')).toBe('segredo')
    expect((await env.fail('t-con', 'note.write', { note: 'privada.md', content: 'x' })).code).toBe('forbidden')
    expect(env.notes.files.get('privada.md')).toBe('segredo')
    expect((await env.fail('t-con', 'note.write', { note: 'spec', content: 'x', ifRevision: 'velha' })).code).toBe('precondition')
  })

  it('arquivo apagado do disco vira not_found', async () => {
    const env = setup()
    env.notes.files.delete('spec.md')
    const err = await env.fail('t-con', 'note.read', { note: 'spec' })
    expect(err.code).toBe('not_found')
    expect(err.message).toContain('spec.md')
  })
})

describe('notify e status', () => {
  it('notify identifica o terminal no título', async () => {
    const env = setup()
    await env.call('t-con', 'notify', { text: 'Build\u0007 pronto' })
    expect(env.notify).toHaveBeenLastCalledWith('construtor', 'Build  pronto', { terminalId: 't-con', dir: '/ws/projeto' })
    await env.call('t-con', 'notify', { text: 'ok', title: 'Testes' })
    expect(env.notify).toHaveBeenLastCalledWith('construtor: Testes', 'ok', { terminalId: 't-con', dir: '/ws/projeto' })
  })

  it('status define e limpa o selo', async () => {
    const env = setup()
    await env.call('t-con', 'status', { text: '  compilando\n módulo ' })
    expect(env.ptys.rt.get('t-con')!.badge).toBe('compilando módulo')
    await env.call('t-con', 'status', { text: '' })
    expect(env.ptys.rt.get('t-con')!.badge).toBeUndefined()
  })
})

// ------------------------------------------------------------------ gerente

describe('modo gerente', () => {
  it('comandos de gerente exigem a flag manager', async () => {
    const env = setup()
    const bodies: [ApiMethod, unknown][] = [
      ['recruit', { name: 'x' }],
      ['dismiss', { name: 'revisor' }],
      ['role.set', { name: 'revisor', role: 'revisor' }],
      ['role.edit', { role: 'revisor', instructions: 'x' }],
      ['connect', { a: 'revisor', b: 'spec' }]
    ]
    for (const [method, body] of bodies) {
      const err = await env.fail('t-con', method, body)
      expect(err.code, method).toBe('forbidden')
      expect(err.message).toContain('modo gerente')
    }
    expect(env.applyMainOps).not.toHaveBeenCalled()
    // role.list é livre.
    const list = (await env.call('t-con', 'role.list')) as { roles: { id: string }[] }
    expect(list.roles.map((r) => r.id)).toEqual(['revisor', 'construtor', 'lider'])
  })

  it('recruit cria o nó abaixo do gerente, conectado a ele e às notas, e inicia o processo', async () => {
    const env = setup()
    const res = await env.call('t-ger', 'recruit', { name: 'testador', role: 'Revisor', notes: ['spec'] })
    const recruit = env.byName('testador')!
    expect(res).toEqual({ id: recruit.id, name: 'testador', preset: 'Claude Code', role: 'Revisor', notes: ['spec.md'] })
    expect(recruit).toMatchObject({
      kind: 'terminal',
      presetId: 'claude', // padrão: o mesmo agente do gerente
      roleId: 'revisor',
      recruitedBy: 't-ger',
      cwd: '',
      autoStart: true,
      size: { w: 600, h: 420 }
    })
    expect(recruit.floorId).toBeUndefined()
    expect(recruit.manager).toBeUndefined()
    expect(recruit.position.y).toBeGreaterThanOrEqual(420 + 40)
    const doc = env.store.doc
    const linked = (a: string, b: string): boolean =>
      doc.edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))
    expect(linked('t-ger', recruit.id)).toBe(true)
    expect(linked(recruit.id, 'n-spec')).toBe(true)
    expect(doc.edges.find((e) => e.source === 't-ger' && e.target === recruit.id)).toMatchObject({ sourceHandle: 'b', targetHandle: 't' })
    expect(env.ensure).toHaveBeenCalledWith(recruit.id, 75, 22)
    // Uma única aplicação com addNodes + addEdges.
    const ops = env.applyMainOps.mock.calls[0]![1] as WorkspaceOp[]
    expect(ops.map((o) => o.op)).toEqual(['addNodes', 'addEdges'])
  })

  it('recrutas criados em sequência ficam lado a lado, sem sobreposição', async () => {
    const env = setup()
    for (const name of ['construtor-2', 'revisor-2', 'testador']) await env.call('t-ger', 'recruit', { name })
    const recruits = env.store.doc.nodes.filter((n): n is TerminalNodeData => n.kind === 'terminal' && n.recruitedBy === 't-ger')
    expect(recruits).toHaveLength(3)
    expect(new Set(recruits.map((r) => r.position.y)).size).toBe(1)
    const xs = recruits.map((r) => r.position.x).sort((a, b) => a - b)
    expect(xs[1]! - xs[0]!).toBeGreaterThanOrEqual(640)
    expect(xs[2]! - xs[1]!).toBeGreaterThanOrEqual(640)
  })

  it('recruit escolhe agente por id ou rótulo e lista os disponíveis quando não acha', async () => {
    const env = setup()
    await env.call('t-ger', 'recruit', { name: 'a1', agent: 'codex' })
    await env.call('t-ger', 'recruit', { name: 'a2', agent: 'claude code' })
    expect(env.byName('a1')!.presetId).toBe('codex')
    expect(env.byName('a2')!.presetId).toBe('claude')
    const err = await env.fail('t-ger', 'recruit', { name: 'a3', agent: 'gpt' })
    expect(err.code).toBe('not_found')
    expect(err.message).toContain('shell ("Shell")')
    expect(err.message).toContain('claude ("Claude Code")')
  })

  it('recruit recusa nome duplicado (sem diferenciar maiúsculas/acentos) e nome inválido', async () => {
    const env = setup()
    const dup = await env.fail('t-ger', 'recruit', { name: 'CONSTRUTOR' })
    expect(dup.code).toBe('conflict')
    expect(dup.message).toContain('"construtor"')
    expect(dup.message.toLowerCase()).toContain('construtor-2')
    await env.call('t-ger', 'recruit', { name: 'revisão' })
    expect((await env.fail('t-ger', 'recruit', { name: 'Revisao' })).code).toBe('conflict')
    const bad = await env.fail('t-ger', 'recruit', { name: 'meu revisor' })
    expect(bad.code).toBe('bad_request')
    expect(bad.message).toContain('sem espaços')
    expect(env.store.doc.nodes.filter((n) => n.kind === 'terminal')).toHaveLength(6)
  })

  it('recruit valida papel, notas (precisam estar conectadas ao gerente) e floor', async () => {
    const env = setup()
    const role = await env.fail('t-ger', 'recruit', { name: 'x1', role: 'arquiteto' })
    expect(role.code).toBe('not_found')
    expect(role.message).toContain('"Revisor" (revisor)')
    const note = await env.fail('t-ger', 'recruit', { name: 'x2', notes: ['privada'] })
    expect(note.code).toBe('forbidden')
    expect(note.message).toContain('"privada.md" não está conectada a "gerente"')
    const floor = await env.fail('t-ger', 'recruit', { name: 'x3', floor: 'marte' })
    expect(floor.code).toBe('not_found')
    expect(floor.message).toContain('"Experimento"')
    expect(env.byName('x1') ?? env.byName('x2') ?? env.byName('x3')).toBeUndefined()

    await env.call('t-ger', 'recruit', { name: 'x4', floor: 'experimento' })
    expect(env.byName('x4')!.floorId).toBe('f-1')
    await env.call('t-ger', 'recruit', { name: 'x5', floor: 'térreo' })
    expect(env.byName('x5')!.floorId).toBeUndefined()
  })

  it('recruit respeita o limite de recrutas por gerente', async () => {
    const env = setup({ ...FAST, maxRecruits: 2 })
    await env.call('t-ger', 'recruit', { name: 'r1' })
    await env.call('t-ger', 'recruit', { name: 'r2' })
    const err = await env.fail('t-ger', 'recruit', { name: 'r3' })
    expect(err.code).toBe('conflict')
    expect(err.message).toContain('dismiss')
  })

  it('dismiss remove só os próprios recrutas', async () => {
    const env = setup()
    await env.call('t-ger', 'recruit', { name: 'temporario', notes: ['spec.md'] })
    const id = env.byName('temporario')!.id
    expect(await env.call('t-ger', 'dismiss', { name: 'Temporario' })).toEqual({})
    expect(env.node(id)).toBeUndefined()
    expect(env.store.doc.edges.some((e) => e.source === id || e.target === id)).toBe(false)
    expect(env.applyMainOps).toHaveBeenLastCalledWith(env.store, [{ op: 'removeNodes', ids: [id] }])

    const foreign = await env.fail('t-ger', 'dismiss', { name: 'construtor' })
    expect(foreign.code).toBe('forbidden')
    expect(foreign.message).toContain('não foi recrutado por "gerente"')
    expect(env.byName('construtor')).toBeDefined()
    expect((await env.fail('t-ger', 'dismiss', { name: 'gerente' })).code).toBe('bad_request')
  })

  it('role.set troca o papel do recruta e reinicia o processo; recusa terminais de outros', async () => {
    const env = setup()
    await env.call('t-ger', 'recruit', { name: 'ajudante', role: 'construtor' })
    const id = env.byName('ajudante')!.id
    expect(await env.call('t-ger', 'role.set', { name: 'ajudante', role: 'Líder' })).toEqual({})
    expect(env.byName('ajudante')!.roleId).toBe('lider')
    expect(env.restart).toHaveBeenCalledWith(id)
    await env.call('t-ger', 'role.set', { name: 'ajudante', role: 'nenhum' })
    expect(env.byName('ajudante')!.roleId).toBeUndefined()

    const foreign = await env.fail('t-ger', 'role.set', { name: 'construtor', role: 'revisor' })
    expect(foreign.code).toBe('forbidden')
    expect(env.byName('construtor')!.roleId).toBe('construtor')
    expect((await env.fail('t-ger', 'role.set', { name: 'ajudante', role: 'astronauta' })).code).toBe('not_found')
  })

  it('role.edit atualiza ou cria papéis e reinicia os recrutas do gerente que o usam', async () => {
    const env = setup()
    await env.call('t-ger', 'recruit', { name: 'rev2', role: 'revisor' })
    const res = await env.call('t-ger', 'role.edit', { role: 'Revisor', instructions: 'Novo texto' })
    expect(res).toEqual({ role: { id: 'revisor', name: 'Revisor' }, restarted: ['rev2'] })
    expect(env.config.role('revisor')!.instructions).toBe('Novo texto')
    expect(env.restart).toHaveBeenCalledWith(env.byName('rev2')!.id)

    const missing = await env.fail('t-ger', 'role.edit', { role: 'Revisor Sênior', instructions: 'x' })
    expect(missing.code).toBe('not_found')
    expect(missing.message).toContain('--create')
    const created = await env.call('t-ger', 'role.edit', { role: 'Revisor Sênior', instructions: 'Revise com rigor.', create: true })
    expect(created).toEqual({ role: { id: 'revisor-senior', name: 'Revisor Sênior' }, restarted: [] })
    expect(env.config.role('revisor-senior')).toMatchObject({ name: 'Revisor Sênior', instructions: 'Revise com rigor.', builtin: false })
  })

  it('connect: só gerente, recrutas dele e notas conectadas ao gerente', async () => {
    const env = setup()
    await env.call('t-ger', 'recruit', { name: 'r1' })
    await env.call('t-ger', 'recruit', { name: 'r2' })
    const r1 = env.byName('r1')!.id
    const r2 = env.byName('r2')!.id

    const ok = (await env.call('t-ger', 'connect', { a: 'r1', b: 'spec' })) as { edgeId: string; existed?: boolean }
    expect(ok).toMatchObject({ a: 'r1', b: 'spec.md' })
    expect(ok.existed).toBeUndefined()
    expect(env.store.doc.edges.some((e) => e.id === ok.edgeId && e.source === r1 && e.target === 'n-spec')).toBe(true)

    const again = await env.call('t-ger', 'connect', { a: 'spec.md', b: 'R1' })
    expect(again).toEqual({ edgeId: ok.edgeId, a: 'spec.md', b: 'r1', existed: true })

    const pair = (await env.call('t-ger', 'connect', { a: 'r1', b: 'r2' })) as { edgeId: string }
    expect(env.store.doc.edges.some((e) => e.id === pair.edgeId && e.source === r1 && e.target === r2)).toBe(true)

    const foreignNote = await env.fail('t-ger', 'connect', { a: 'r1', b: 'privada' })
    expect(foreignNote.code).toBe('forbidden')
    expect(foreignNote.message).toContain('"privada.md" não está conectada a "gerente"')

    const foreignTerm = await env.fail('t-ger', 'connect', { a: 'r2', b: 'solitario' })
    expect(foreignTerm.code).toBe('forbidden')
    expect(foreignTerm.message).toContain('"solitario" não é um recruta de "gerente"')

    // O usuário conectou "construtor" ao gerente, mas ele não é recruta: o gerente não pode religá-lo.
    expect((await env.fail('t-ger', 'connect', { a: 'construtor', b: 'r1' })).code).toBe('forbidden')
    expect((await env.fail('t-ger', 'connect', { a: 'r1', b: 'r1' })).code).toBe('bad_request')
    expect((await env.fail('t-ger', 'connect', { a: 'r1', b: 'nada' })).code).toBe('not_found')
  })
})

describe('portais (orq portal)', () => {
  function withPortals(env: Env, fail = false) {
    const calls: string[] = []
    const portals: PortalApi = {
      read: async (id) => {
        calls.push(`read:${id}`)
        if (fail) throw new Error('o portal não está aberto no canvas agora')
        return { url: 'https://example.com/docs', title: 'Docs', text: 'Bem-vindo à documentação', truncated: false }
      },
      capture: async (id, file) => {
        calls.push(`capture:${id}:${file}`)
        return { url: 'https://example.com/docs', title: 'Docs', width: 800, height: 600 }
      },
      open: async (id, url) => {
        calls.push(`open:${id}:${url}`)
        return { url, title: 'Novo' }
      }
    }
    ;(env.deps as { portals?: PortalApi }).portals = portals
    return calls
  }
  const liberar = (env: Env): void => env.store.apply([{ op: 'updateNode', id: 'p-docs', patch: { agentAccess: true } }])

  it('recusa portal não liberado e terminal sem portal', async () => {
    const env = setup()
    withPortals(env)
    const e = await env.fail('t-con', 'portal.read')
    expect(e.code).toBe('forbidden')
    expect(e.message).toContain('não está liberado para agentes')
    const sem = await env.fail('t-rev', 'portal.read')
    expect(sem.code).toBe('not_found')
    expect(sem.message).toContain('Nenhum portal conectado a "revisor"')
  })

  it('lê, tira print em .maestrinho/prints e navega um portal liberado', async () => {
    const env = setup()
    const calls = withPortals(env)
    liberar(env)
    expect(await env.call('t-con', 'portal.read')).toEqual({ id: 'p-docs', url: 'https://example.com/docs', title: 'Docs', text: 'Bem-vindo à documentação', truncated: false })
    expect(env.edges.at(-1)).toEqual({ from: 'p-docs', to: 't-con', kind: 'read' })

    const shot = (await env.call('t-con', 'portal.print', { portal: 'docs' })) as { file: string; width: number }
    expect(shot.width).toBe(800)
    expect(shot.file.split('\\').join('/')).toMatch(/\/ws\/projeto\/\.maestrinho\/prints\/portal-.*-docs\.png$/)
    expect(calls.some((c) => c.startsWith('capture:p-docs:'))).toBe(true)

    expect(await env.call('t-con', 'portal.open', { url: 'http://localhost:5173/' })).toEqual({ id: 'p-docs', url: 'http://localhost:5173/', title: 'Novo' })
    expect(env.applyMainOps).toHaveBeenCalledWith(env.store, [{ op: 'updateNode', id: 'p-docs', patch: { url: 'http://localhost:5173/' } }])
  })

  it('endereço inválido, portal inexistente e página fora do ar viram erros claros', async () => {
    const env = setup()
    withPortals(env, true)
    liberar(env)
    expect((await env.fail('t-con', 'portal.open', { url: 'file:///C:/segredo.txt' })).code).toBe('bad_request')
    const nf = await env.fail('t-con', 'portal.read', { portal: 'github' })
    expect(nf.code).toBe('not_found')
    expect(nf.message).toContain('Conectados: "Docs"')
    const off = await env.fail('t-con', 'portal.read')
    expect(off.code).toBe('unavailable')
    expect(off.message).toBe('Portal: o portal não está aberto no canvas agora')
  })
})
