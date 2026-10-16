import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatUpdate } from '@shared/chat'
import { AgentPresetSchema, TerminalNodeSchema, type TerminalNodeData } from '@shared/schemas'
import { encodeClaudeProjectDir } from '../terminals/sessions'

vi.mock('electron', () => ({ nativeImage: {} }))
const { ChatService } = await import('./ChatService')

const claude = AgentPresetSchema.parse({ id: 'claude', label: 'Claude Code', command: 'claude', sessionStore: 'claude' })
const codex = AgentPresetSchema.parse({ id: 'codex', label: 'Codex', command: 'codex', sessionStore: 'codex' })

describe('ChatService', () => {
  const dirs: string[] = []
  afterEach(() => {
    vi.useRealTimers()
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  it('terminal do Claude ainda sem sessão: começa na tela e passa ao histórico quando a sessão aparece', () => {
    vi.useFakeTimers()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-chat-'))
    dirs.push(root)
    const cwd = path.join(root, 'projeto')
    fs.mkdirSync(cwd)
    const node: TerminalNodeData = TerminalNodeSchema.parse({
      id: 't1',
      kind: 'terminal',
      name: 'leitor',
      presetId: 'claude',
      cwd,
      position: { x: 0, y: 0 },
      size: { w: 600, h: 400 }
    })
    const updates: ChatUpdate[] = []
    const chat = new ChatService({
      node: () => node,
      presetFor: () => claude,
      resolveCwd: () => cwd,
      isRunning: () => true,
      startedAt: () => Date.now(),
      inject: async () => undefined,
      writeRaw: () => true,
      emit: (u) => updates.push(u),
      env: { CLAUDE_CONFIG_DIR: root }
    })

    expect(chat.open('t1')).toMatchObject({ mode: 'screen', agent: null })
    expect(chat.isOpen('t1')).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(updates).toEqual([])

    // O terminal iniciou: ganhou o id da sessão e o Claude gravou a primeira mensagem.
    node.sessionId = '0b6f3c1e-4b7d-4e2a-9c3f-1a2b3c4d5e6f'
    const projDir = path.join(root, 'projects', encodeClaudeProjectDir(path.resolve(cwd)))
    fs.mkdirSync(projDir, { recursive: true })
    const user = { type: 'user', uuid: 'u1', timestamp: '2026-10-08T13:38:00Z', message: { role: 'user', content: [{ type: 'text', text: 'ola' }] } }
    fs.writeFileSync(path.join(projDir, `${node.sessionId}.jsonl`), `${JSON.stringify(user)}\n`)
    vi.advanceTimersByTime(700)

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ id: 't1', reset: true, agent: 'claude' })
    expect(updates[0]!.items.map((i) => i.kind)).toEqual(['user'])
    chat.dispose()
    expect(chat.isOpen('t1')).toBe(false)
  })

  it('Codex hibernado que esqueceu a conversa ("nova tarefa"): o chat recomeça vazio', () => {
    vi.useFakeTimers()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-chat-'))
    dirs.push(root)
    const cwd = path.join(root, 'projeto')
    fs.mkdirSync(cwd)
    const sessionId = '0b6f3c1e-4b7d-4e2a-9c3f-1a2b3c4d5e6f'
    const day = path.join(root, 'sessions', '2026', '10', '11')
    fs.mkdirSync(day, { recursive: true })
    const rec = { timestamp: '2026-10-11T18:46:00Z', type: 'response_item', payload: { type: 'message', id: 'm1', role: 'assistant', content: [{ type: 'output_text', text: 'Pronto.' }] } }
    fs.writeFileSync(path.join(day, `rollout-2026-10-11T18-46-00-${sessionId}.jsonl`), `${JSON.stringify(rec)}\n`)
    const node: TerminalNodeData = TerminalNodeSchema.parse({
      id: 't1',
      kind: 'terminal',
      name: 'qa',
      presetId: 'codex',
      cwd,
      sessionId,
      hibernated: true,
      position: { x: 0, y: 0 },
      size: { w: 600, h: 400 }
    })
    const updates: ChatUpdate[] = []
    const chat = new ChatService({
      node: () => node,
      presetFor: () => codex,
      resolveCwd: () => cwd,
      isRunning: () => false,
      startedAt: () => undefined,
      inject: async () => undefined,
      writeRaw: () => true,
      emit: (u) => updates.push(u),
      env: { CODEX_HOME: root }
    })

    const snap = chat.open('t1')
    expect(snap).toMatchObject({ mode: 'transcript', agent: 'codex' })
    expect(snap.items.map((i) => i.kind)).toEqual(['assistant'])
    vi.advanceTimersByTime(700)
    expect(updates).toEqual([])

    node.sessionId = undefined
    vi.advanceTimersByTime(700)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ id: 't1', reset: true, items: [] })
    // Sem processo iniciado, não "descobre" outra conversa na mesma pasta.
    vi.advanceTimersByTime(5000)
    expect(updates).toHaveLength(1)
    chat.dispose()
  })
})
