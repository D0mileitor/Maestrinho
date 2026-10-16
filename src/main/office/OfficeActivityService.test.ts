import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { OfficeActivity } from '@shared/office'
import type { AgentPreset, TerminalNodeData } from '@shared/schemas'
import { encodeClaudeProjectDir } from '../terminals/sessions'
import { OfficeActivityService } from './OfficeActivityService'

const SESSION = '11111111-2222-3333-4444-555555555555'
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function setup(screen: { text: string }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'office-act-'))
  dirs.push(base)
  const cwd = path.join(base, 'proj')
  fs.mkdirSync(cwd)
  const projDir = path.join(base, 'claude', 'projects', encodeClaudeProjectDir(path.resolve(cwd)))
  fs.mkdirSync(projDir, { recursive: true })
  const file = path.join(projDir, `${SESSION}.jsonl`)
  fs.writeFileSync(file, '')
  const node = { id: 't1', kind: 'terminal', name: 'dev', presetId: 'claude', cwd, sessionId: SESSION } as TerminalNodeData
  const preset = { id: 'claude', command: 'claude', sessionStore: 'claude' } as AgentPreset
  const events: OfficeActivity[] = []
  const svc = new OfficeActivityService({
    node: (id) => (id === 't1' ? node : undefined),
    presetFor: () => preset,
    resolveCwd: () => cwd,
    startedAt: () => 1,
    isRunning: () => true,
    readScreen: () => screen.text,
    claimedByChat: () => new Set(),
    emit: (a) => events.push(a),
    env: { CLAUDE_CONFIG_DIR: path.join(base, 'claude') }
  })
  const append = (o: unknown): void => fs.appendFileSync(file, JSON.stringify(o) + '\n')
  return { svc, events, append, file }
}

const tick = (svc: OfficeActivityService): void => (svc as unknown as { tick(): void }).tick()

describe('OfficeActivityService', () => {
  it('ferramenta em uso, fim da resposta e pergunta esperando o usuário', () => {
    const screen = { text: '❯ ' }
    const { svc, events, append } = setup(screen)
    svc.watch(['t1'])
    append({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: 'C:\\p\\Triagem.cs', old_string: 'a', new_string: 'b' } }] } })
    tick(svc)
    expect(events.at(-1)).toMatchObject({ id: 't1', tool: { kind: 'typing', detail: 'Editou Triagem.cs', done: false }, turnEnded: false, waiting: false })

    append({ type: 'user', uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } })
    append({ type: 'assistant', uuid: 'a2', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Pronto.' }] } })
    tick(svc)
    expect(events.at(-1)).toMatchObject({ tool: { kind: 'typing', done: true }, turnEnded: true })

    screen.text = ' Do you want to proceed?\n ❯ 1. Yes\n   2. No'
    tick(svc)
    expect(events.at(-1)!.waiting).toBe(true)

    const count = events.length
    tick(svc)
    expect(events.length).toBe(count) // sem mudança, sem evento
    svc.stop()
  })

  it('cada leitura ou gravação do histórico de chamados conta uma ida ao arquivo', () => {
    const { svc, events, append } = setup({ text: '❯ ' })
    svc.watch(['t1'])
    append({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\p\\.maestrinho\\notes\\historico\\INDICE.md' } }] } })
    tick(svc)
    expect(events.at(-1)!.archive).toEqual({ seq: 1, mode: 'read' })
    // o resultado da mesma ferramenta não conta de novo; ler outro arquivo qualquer também não
    append({ type: 'user', uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '...' }] } })
    append({ type: 'assistant', uuid: 'a2', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'C:\\p\\src\\app.ts' } }] } })
    tick(svc)
    expect(events.at(-1)!.archive.seq).toBe(1)
    append({ type: 'assistant', uuid: 'a3', message: { content: [{ type: 'tool_use', id: 't3', name: 'Write', input: { file_path: 'C:\\p\\.maestrinho\\notes\\historico\\2026-10-07-123456-x.md', content: '#' } }] } })
    tick(svc)
    expect(events.at(-1)!.archive).toEqual({ seq: 2, mode: 'write' })
    svc.stop()
  })

  it('ajudantes: aparecem trabalhando (com o que fazem) e somem depois de terminar', () => {
    const { svc, events, append, file } = setup({ text: '❯ ' })
    const subagents = path.join(path.dirname(file), SESSION, 'subagents')
    fs.mkdirSync(subagents, { recursive: true })
    svc.watch(['t1'])
    append({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'tool_use', id: 'toolu_H', name: 'Agent', input: { description: 'Mapear a triagem', subagent_type: 'Explore', prompt: 'x' } }] } })
    append({ type: 'user', uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_H', content: 'Async agent launched successfully.\nagentId: abc1' }] } })
    fs.writeFileSync(path.join(subagents, 'agent-abc1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Mapear a triagem', toolUseId: 'toolu_H' }))
    fs.writeFileSync(path.join(subagents, 'agent-abc1.jsonl'), JSON.stringify({ isSidechain: true, message: { content: [{ type: 'tool_use', id: 'x1', name: 'Grep', input: {} }] } }) + '\n')
    tick(svc)
    expect(events.at(-1)!.helpers).toEqual([{ seed: 'toolu_H', title: 'Mapear a triagem', type: 'Explore', status: 'running', tool: 'reading' }])

    const report = 'Another Claude session sent a message:\n<agent-message from="abc1">\n[Subagent hand-back] The report follows:\n  Feito.\n</agent-message>'
    append({ type: 'user', uuid: 'u2', isMeta: true, timestamp: new Date().toISOString(), message: { content: report } })
    tick(svc)
    expect(events.at(-1)!.helpers).toEqual([{ seed: 'toolu_H', title: 'Mapear a triagem', type: 'Explore', status: 'done', tool: null }])
    svc.stop()
  })
})
