import { EventEmitter } from 'node:events'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@shared/api'
import type { EventBus } from '../ipc/registry'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import { NotesService, noteRevision } from './NotesService'
import { bindNotesWatcher, registerNotesIpc, toIpcError } from './ipc'

interface Registered {
  schema: { safeParse(v: unknown): { success: boolean; data?: unknown } } | null
  fn: (req: unknown) => unknown
}

// O registro real depende do Electron; aqui só capturamos os handlers.
const handlers = vi.hoisted(() => new Map<string, Registered>())
vi.mock('../ipc/registry', () => ({
  handle: (channel: string, schema: Registered['schema'], fn: Registered['fn']) => {
    handlers.set(channel, { schema, fn })
  }
}))

/** Simula o registry: valida o payload e chama o handler. */
async function invoke(channel: string, payload: unknown): Promise<unknown> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`canal não registrado: ${channel}`)
  let req = payload
  if (h.schema) {
    const parsed = h.schema.safeParse(payload)
    if (!parsed.success) throw new Error(`payload inválido em ${channel}`)
    req = parsed.data
  }
  return h.fn(req)
}

class FakeWorkspaces extends EventEmitter {
  readonly live = new Map<string, { dir: string }>()
  get(dir: string): { dir: string } | undefined {
    return this.live.get(path.resolve(dir).toLowerCase())
  }
  all(): { dir: string }[] {
    return [...this.live.values()]
  }
  add(dir: string): { dir: string } {
    const ws = { dir }
    this.live.set(path.resolve(dir).toLowerCase(), ws)
    return ws
  }
}

describe('IPC das notas', () => {
  let ws: string
  let notes: NotesService
  let workspaces: FakeWorkspaces
  let emitted: { channel: string; payload: unknown }[]
  let dispose: () => void

  beforeEach(async () => {
    ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'maestrinho-notas-ipc-'))
    notes = new NotesService({ debounceMs: 40 })
    workspaces = new FakeWorkspaces()
    workspaces.add(ws)
    emitted = []
    const bus = { emit: (channel: string, payload: unknown) => emitted.push({ channel, payload }) }
    handlers.clear()
    dispose = registerNotesIpc({
      notes,
      workspaces: workspaces as unknown as WorkspaceManager,
      bus: bus as unknown as EventBus
    })
  })

  afterEach(async () => {
    dispose()
    await notes.closeAll()
    await fsp.rm(ws, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('registra os quatro canais', () => {
    expect([...handlers.keys()].sort()).toEqual(['notes:create', 'notes:list', 'notes:read', 'notes:write'])
  })

  it('cria, escreve, lê e lista', async () => {
    expect(await invoke('notes:create', { dir: ws, file: 'spec' })).toBe('spec.md')
    expect(await invoke('notes:create', { dir: ws, file: 'spec.md', content: 'x' })).toBe('spec-2.md')
    await invoke('notes:write', { dir: ws, file: 'spec.md', content: '# Spec' })
    expect(await invoke('notes:read', { dir: ws, file: 'spec.md' })).toBe('# Spec')
    const list = (await invoke('notes:list', { dir: ws })) as { file: string; size: number }[]
    expect(list.map((e) => e.file)).toEqual(['spec.md', 'spec-2.md'])
    expect(Object.keys(list[0]!).sort()).toEqual(['file', 'mtimeMs', 'size'])
  })

  it('ifRevision divergente vira "[precondition] ..."', async () => {
    await invoke('notes:write', { dir: ws, file: 'n.md', content: 'a' })
    await invoke('notes:write', { dir: ws, file: 'n.md', content: 'b', ifRevision: noteRevision('a') })
    const stale = { dir: ws, file: 'n.md', content: 'c', ifRevision: noteRevision('a') }
    await expect(invoke('notes:write', stale)).rejects.toThrow(/^\[precondition\] .*revisão esperada/)
    expect(await invoke('notes:read', { dir: ws, file: 'n.md' })).toBe('b')
  })

  it('valida os payloads', async () => {
    const badRevision = { dir: ws, file: 'n.md', content: 'x', ifRevision: 'zz' }
    await expect(invoke('notes:write', badRevision)).rejects.toThrow(/payload inválido/)
    await expect(invoke('notes:read', { dir: ws })).rejects.toThrow(/payload inválido/)
    await expect(invoke('notes:read', { dir: ws, file: 'x'.repeat(201) })).rejects.toThrow(/payload inválido/)
    await expect(invoke('notes:list', {})).rejects.toThrow(/payload inválido/)
  })

  it('nome inválido e nota ausente trazem o código', async () => {
    await expect(invoke('notes:read', { dir: ws, file: '../fora.md' })).rejects.toThrow(/^\[bad_request\] /)
    await expect(invoke('notes:read', { dir: ws, file: 'nada.md' })).rejects.toThrow(/^\[not_found\] /)
  })

  it('só atende workspaces abertos', async () => {
    const other = path.join(ws, 'outro')
    await expect(invoke('notes:list', { dir: other })).rejects.toThrow(/^\[unavailable\] /)
    await expect(invoke('notes:write', { dir: other, file: 'x.md', content: 'x' })).rejects.toThrow(/^\[unavailable\] /)
  })

  it('repassa eventos do serviço só para workspaces abertos, com o dir do workspace', async () => {
    await invoke('notes:write', { dir: ws, file: 'e.md', content: '1' })
    expect(emitted).toEqual([
      { channel: 'note:changed', payload: { dir: ws, file: 'e.md' } },
      { channel: 'notes:listChanged', payload: { dir: ws } }
    ])
    emitted.length = 0
    notes.emit('changed', path.join(ws, 'fechado'), 'x.md')
    notes.emit('listChanged', path.join(ws, 'fechado'))
    expect(emitted).toEqual([])
    dispose()
    notes.emit('changed', ws, 'e.md')
    expect(emitted).toEqual([])
  })

  it('toIpcError põe o código no início da mensagem', () => {
    expect(toIpcError(new ApiError('not_found', 'sumiu')).message).toBe('[not_found] sumiu')
    const plain = new Error('x')
    expect(toIpcError(plain)).toBe(plain)
    expect(toIpcError('texto').message).toBe('texto')
  })
})

describe('bindNotesWatcher', () => {
  it('observa ao abrir (inclusive os já abertos) e para ao fechar', async () => {
    const dirA = await fsp.mkdtemp(path.join(os.tmpdir(), 'maestrinho-notas-a-'))
    const dirB = await fsp.mkdtemp(path.join(os.tmpdir(), 'maestrinho-notas-b-'))
    const notes = new NotesService()
    const workspaces = new FakeWorkspaces()
    const a = workspaces.add(dirA)
    try {
      const unbind = bindNotesWatcher(notes, workspaces as unknown as WorkspaceManager)
      expect(notes.isWatching(dirA)).toBe(true)
      const b = workspaces.add(dirB)
      workspaces.emit('opened', b)
      expect(notes.isWatching(dirB)).toBe(true)
      workspaces.emit('closing', a)
      expect(notes.isWatching(dirA)).toBe(false)
      unbind()
      workspaces.emit('closing', b)
      expect(notes.isWatching(dirB)).toBe(true)
    } finally {
      await notes.closeAll()
      await fsp.rm(dirA, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      await fsp.rm(dirB, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})
