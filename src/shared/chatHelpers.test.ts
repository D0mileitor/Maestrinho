import { describe, expect, it } from 'vitest'
import { parseHandback, parseTaskNotifications, parseTranscriptLine, type ChatItem, type HelperItem, type ParseState } from './chat'

const line = (o: Record<string, unknown>): string => JSON.stringify(o)
const callLine = (id: string, description: string, type = 'Explore'): string =>
  line({
    type: 'assistant',
    uuid: `u-${id}`,
    timestamp: '2026-10-13T19:00:00Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input: { description, subagent_type: type, prompt: 'segredo', run_in_background: true } }] }
  })
const launched = (id: string, agentId: string): string =>
  line({
    type: 'user',
    uuid: `r-${id}`,
    timestamp: '2026-10-13T19:00:01Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: `Async agent launched successfully. (internal)\nagentId: ${agentId} (internal ID)` }] }] }
  })
const handbackText = (agentId: string, report: string): string =>
  [
    'Another Claude session sent a message:',
    `<agent-message from="${agentId}">`,
    '[Subagent hand-back] The text below is the final report of a subagent this session delegated to. The report follows:',
    ...report.split('\n').map((l) => `  ${l}`),
    '</agent-message>',
    '',
    'That "other Claude session" is an agent working inside this same session.'
  ].join('\n')
const handback = (agentId: string, report: string): string =>
  line({ type: 'user', uuid: `h-${agentId}`, isMeta: true, timestamp: '2026-10-13T19:07:00Z', message: { role: 'user', content: handbackText(agentId, report) } })
const notificationText = (agentId: string, toolUseId: string, title: string, status = 'completed'): string =>
  [
    '<task-notification>',
    `<task-id>${agentId}</task-id>`,
    `<tool-use-id>${toolUseId}</tool-use-id>`,
    '<output-file>C:\\tmp\\x.output</output-file>',
    `<status>${status}</status>`,
    `<summary>Agent "${title}" finished</summary>`,
    '<result>This agent\'s report was delivered to you as a message.</result>',
    '<usage><subagent_tokens>252280</subagent_tokens><tool_uses>75</tool_uses><duration_ms>444885</duration_ms></usage>',
    '</task-notification>'
  ].join('\n')
const notification = (agentId: string, toolUseId: string, title: string, status?: string): string =>
  line({ type: 'user', uuid: `n-${agentId}`, timestamp: '2026-10-13T19:07:30Z', message: { role: 'user', content: notificationText(agentId, toolUseId, title, status) } })

function run(lines: string[]): ChatItem[][] {
  const state: ParseState = new Map()
  return lines.map((l) => parseTranscriptLine(l, state).items)
}

describe('ajudantes (sub-agentes) no chat', () => {
  it('pedido em segundo plano → relatório com rosto → aviso de término com o uso', () => {
    const [call, launch, report, notice] = run([
      callLine('toolu_A', 'Map Edi triage'),
      launched('toolu_A', 'af17'),
      handback('af17', '## Mapeamento\n- item 1\n  - sub-item'),
      notification('af17', 'toolu_A', 'Map Edi triage')
    ])
    expect(call).toEqual([expect.objectContaining({ kind: 'helper', key: 'toolu_A', role: 'call', seed: 'toolu_A', title: 'Map Edi triage', type: 'Explore', status: 'running' })])
    // o prompt dado ao ajudante não vai para o chat
    expect(JSON.stringify(call)).not.toContain('segredo')
    expect(launch).toEqual([expect.objectContaining({ key: 'toolu_A', agentId: 'af17', status: 'running' })])
    const [callDone, answer] = report as HelperItem[]
    expect(callDone).toMatchObject({ key: 'toolu_A', status: 'done' })
    expect(answer).toMatchObject({ kind: 'helper', key: 'relatorio:af17', role: 'report', seed: 'toolu_A', title: 'Map Edi triage', type: 'Explore', status: 'done' })
    expect(answer!.report).toBe('## Mapeamento\n- item 1\n  - sub-item')
    expect(notice).toEqual([
      expect.objectContaining({ key: 'toolu_A', status: 'done', usage: { tokens: 252280, tools: 75, ms: 444885 } }),
      expect.objectContaining({ key: 'relatorio:af17', report: '## Mapeamento\n- item 1\n  - sub-item', usage: { tokens: 252280, tools: 75, ms: 444885 } })
    ])
  })

  it('o aviso cru nunca aparece como mensagem do usuário', () => {
    const items = run([callLine('toolu_B', 'Plano'), launched('toolu_B', 'b1'), notification('b1', 'toolu_B', 'Plano', 'failed')]).flat()
    expect(items.some((i) => i.kind === 'user')).toBe(false)
    expect(items.at(-1)).toMatchObject({ kind: 'helper', role: 'report', status: 'error', title: 'Plano' })
  })

  it('em primeiro plano, o resultado da chamada já é a resposta', () => {
    const state: ParseState = new Map()
    parseTranscriptLine(callLine('toolu_C', 'Revisar diff', 'general-purpose'), state)
    const result = line({
      type: 'user',
      uuid: 'r-C',
      timestamp: '2026-10-13T19:02:00Z',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_C', content: [{ type: 'text', text: 'Tudo certo no diff.\nagentId: c9 (use para retomar)' }] }] }
    })
    const items = parseTranscriptLine(result, state).items
    expect(items).toEqual([
      expect.objectContaining({ key: 'toolu_C', status: 'done', agentId: 'c9' }),
      expect.objectContaining({ key: 'relatorio:c9', role: 'report', report: 'Tudo certo no diff.', seed: 'toolu_C' })
    ])
  })

  it('aviso de comando em segundo plano vira uma nota curta', () => {
    const text = '<task-notification>\n<task-id>b6p5</task-id>\n<status>completed</status>\n<summary>Background command "npm test" completed (exit code 0)</summary>\n</task-notification>'
    const items = run([line({ type: 'user', uuid: 'n1', timestamp: 't', message: { role: 'user', content: text } })])[0]
    expect(items).toEqual([{ kind: 'note', key: 'n1:0', at: 't', text: 'Segundo plano: Background command "npm test" completed (exit code 0)' }])
  })

  it('relatório de um ajudante chamado antes do trecho lido: aparece mesmo sem a chamada', () => {
    const items = run([handback('zz', 'Resumo')])[0]
    expect(items).toEqual([expect.objectContaining({ key: 'relatorio:zz', role: 'report', seed: 'zz', title: 'Ajudante', report: 'Resumo' })])
  })
})

describe('leitura dos blocos do Claude Code', () => {
  it('relatório: tira o aviso do começo e o recuo', () => {
    expect(parseHandback(handbackText('a1', 'linha 1\n  recuada'))).toEqual({ agentId: 'a1', report: 'linha 1\n  recuada' })
    expect(parseHandback('mensagem comum')).toBeNull()
  })

  it('aviso de término: campos e uso', () => {
    expect(parseTaskNotifications(notificationText('a1', 'toolu_1', 'X'))).toEqual([
      { taskId: 'a1', toolUseId: 'toolu_1', status: 'completed', summary: 'Agent "X" finished', usage: { tokens: 252280, tools: 75, ms: 444885 } }
    ])
  })
})
