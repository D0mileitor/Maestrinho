import { describe, expect, it } from 'vitest'
import {
  choiceSteps,
  codexSessionMeta,
  describeTool,
  detectPendingChoice,
  keysForChoice,
  lastAssistantText,
  modeFromScreen,
  modelLabel,
  parseCodexLine,
  parseTranscriptLine,
  type ChatItem
} from './chat'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>
const line = (o: unknown): string => JSON.stringify(o)

describe('parseTranscriptLine', () => {
  it('mensagem do usuário com print: texto sem o marcador e imagem separada', () => {
    const tools = new Map<string, ToolItem>()
    const r = parseTranscriptLine(
      line({
        type: 'user',
        uuid: 'u1',
        timestamp: 't',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'ajuste esta tela [Image #1]' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
          ]
        }
      }),
      tools
    )
    expect(r.items).toEqual([{ kind: 'user', key: 'u1', at: 't', text: 'ajuste esta tela', images: [{ mediaType: 'image/png', data: 'AAAA' }] }])
  })

  it('texto e ferramenta do assistente; o resultado chega depois e atualiza o mesmo item', () => {
    const tools = new Map<string, ToolItem>()
    const a = parseTranscriptLine(
      line({
        type: 'assistant',
        uuid: 'a1',
        timestamp: 't',
        message: {
          stop_reason: 'tool_use',
          content: [
            { type: 'thinking', thinking: 'segredo' },
            { type: 'text', text: 'Vou compilar.' },
            { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'dotnet build', description: 'Compila a solução' } }
          ]
        }
      }),
      tools
    )
    expect(a.items).toEqual([
      { kind: 'assistant', key: 'a1:1', at: 't', text: 'Vou compilar.' },
      { kind: 'tool', key: 'tu1', at: 't', done: false, name: 'Bash', title: 'Compila a solução', detail: 'dotnet build' }
    ])
    expect(JSON.stringify(a.items)).not.toContain('segredo')
    const r = parseTranscriptLine(
      line({ type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'Build succeeded.', is_error: false }] } }),
      tools
    )
    expect(r.items).toEqual([expect.objectContaining({ key: 'tu1', done: true, error: false, result: 'Build succeeded.' })])
  })

  it('fim da resposta (end_turn), mensagens do orq, interrupções, comandos e entradas internas', () => {
    const tools = new Map<string, ToolItem>()
    expect(parseTranscriptLine(line({ type: 'assistant', uuid: 'a', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Pronto.' }] } }), tools).turnEnded).toBe(true)
    const orq = parseTranscriptLine(
      line({ type: 'user', uuid: 'o', message: { content: '[Mensagem de "qa" via orq] APROVADO rodada 1\n(Para responder: orq send qa "<sua resposta>")' } }),
      tools
    )
    expect(orq.items).toEqual([{ kind: 'orq', key: 'o', at: '', from: 'qa', text: 'APROVADO rodada 1' }])
    expect(parseTranscriptLine(line({ type: 'user', uuid: 'i', message: { content: '[Request interrupted by user]' } }), tools).items[0]).toMatchObject({ kind: 'note' })
    expect(parseTranscriptLine(line({ type: 'user', uuid: 'c', message: { content: '<command-name>/usage</command-name>' } }), tools).items[0]).toMatchObject({ kind: 'note', text: 'Comando /usage' })
    expect(parseTranscriptLine(line({ type: 'user', uuid: 'm', isMeta: true, message: { content: 'contexto interno' } }), tools).items).toEqual([])
    expect(parseTranscriptLine(line({ type: 'user', uuid: 's', isSidechain: true, message: { content: 'subagente' } }), tools).items).toEqual([])
    expect(parseTranscriptLine(line({ type: 'mode', mode: 'auto' }), tools).items).toEqual([])
    expect(parseTranscriptLine('{quebrado', tools).items).toEqual([])
  })

  // Regressão: o texto enviado pelo chat (colado no terminal) aparecia com as marcas do Claude Code,
  // e mensagens do orq coladas assim deixavam de ser reconhecidas.
  it('esconde as marcas <pasted_content> e ainda reconhece mensagens do orq coladas', () => {
    const tools = new Map<string, ToolItem>()
    const u = parseTranscriptLine(
      line({ type: 'user', uuid: 'p', message: { content: '<pasted_content id="027c">\nvamos começar com a triagem\n</pasted_content id="027c">' } }),
      tools
    )
    expect(u.items).toEqual([{ kind: 'user', key: 'p', at: '', text: 'vamos começar com a triagem', images: [] }])
    const o = parseTranscriptLine(
      line({ type: 'user', uuid: 'q', message: { content: '<pasted_content id="a1">[Mensagem de "qa" via orq] APROVADO rodada 2</pasted_content id="a1">' } }),
      tools
    )
    expect(o.items).toEqual([{ kind: 'orq', key: 'q', at: '', from: 'qa', text: 'APROVADO rodada 2' }])
  })

  it('resultado longo é cortado', () => {
    const tools = new Map<string, ToolItem>()
    parseTranscriptLine(line({ type: 'assistant', uuid: 'a', message: { content: [{ type: 'tool_use', id: 't', name: 'Read', input: { file_path: 'C:\\x\\a.cs' } }] } }), tools)
    const big = Array.from({ length: 200 }, (_, i) => `linha ${i}`).join('\n')
    const r = parseTranscriptLine(line({ type: 'user', uuid: 'u', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: big }] } }), tools)
    const tool = r.items[0] as ToolItem
    expect(tool.title).toBe('Leu a.cs')
    expect(tool.result).toContain('(+140 linhas)')
  })
})

describe('modelo, esforço e modo', () => {
  it('metadados vêm da resposta (modelo, esforço) e da mensagem do usuário (modo)', () => {
    const tools = new Map<string, ToolItem>()
    const a = parseTranscriptLine(line({ type: 'assistant', uuid: 'a', effort: 'xhigh', message: { model: 'claude-opus-5-5', content: [] } }), tools)
    expect(a.meta).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
    const u = parseTranscriptLine(line({ type: 'user', uuid: 'u', permissionMode: 'auto', message: { content: 'oi' } }), tools)
    expect(u.meta).toEqual({ permissionMode: 'auto' })
    expect(parseTranscriptLine(line({ type: 'assistant', uuid: 's', message: { model: '<synthetic>', content: [] } }), tools).meta).toBeUndefined()
  })

  it('nomes curtos de modelo', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M)')
    expect(modelLabel('outro-modelo')).toBe('outro-modelo')
  })

  it('modo pela linha de status do terminal', () => {
    expect(modeFromScreen('❯ \n  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents')).toBe('auto')
    expect(modeFromScreen('❯ \n  ⏸ plan mode on (shift+tab to cycle)')).toBe('plan')
    expect(modeFromScreen('❯ \n  ⏵⏵ accept edits on (shift+tab to cycle)')).toBe('acceptEdits')
    expect(modeFromScreen('❯ \n  ? for shortcuts')).toBe('default')
    expect(modeFromScreen('compilando...')).toBeNull()
  })
})

describe('parseCodexLine', () => {
  const rec = (type: string, payload: unknown, ordinal = 1): string => JSON.stringify({ timestamp: '2026-10-05T18:46:00Z', ordinal, type, payload })

  it('modelo/esforço/aprovação do turn_context e fim do turno', () => {
    const tools = new Map<string, ToolItem>()
    expect(parseCodexLine(rec('turn_context', { model: 'gpt-5.5', effort: 'xhigh', approval_policy: 'on-request' }), tools).meta).toEqual({
      model: 'gpt-5.5',
      effort: 'xhigh',
      permissionMode: 'codex:on-request'
    })
    expect(parseCodexLine(rec('event_msg', { type: 'task_complete' }), tools).turnEnded).toBe(true)
    expect(modelLabel('gpt-5.5')).toBe('GPT-5.5')
  })

  it('mensagens: ignora instruções/ambiente, reconhece orq e respostas do agente', () => {
    const tools = new Map<string, ToolItem>()
    const ctx = parseCodexLine(
      rec('response_item', {
        type: 'message',
        id: 'm0',
        role: 'user',
        content: [
          { type: 'input_text', text: '# AGENTS.md instructions for C:\\proj' },
          { type: 'input_text', text: '<environment_context>\n  <cwd>C:\\proj</cwd>' }
        ]
      }),
      tools
    )
    expect(ctx.items).toEqual([])
    const orq = parseCodexLine(rec('response_item', { type: 'message', id: 'm1', role: 'user', content: [{ type: 'input_text', text: '[Mensagem de "dev" via orq] ENTREGA rodada 1' }] }), tools)
    expect(orq.items).toEqual([{ kind: 'orq', key: 'm1', at: '2026-10-05T18:46:00Z', from: 'dev', text: 'ENTREGA rodada 1' }])
    const dev = parseCodexLine(rec('response_item', { type: 'message', id: 'd', role: 'developer', content: [{ type: 'input_text', text: 'regras' }] }), tools)
    expect(dev.items).toEqual([])
    const ai = parseCodexLine(rec('response_item', { type: 'message', id: 'm2', role: 'assistant', content: [{ type: 'output_text', text: 'Vou validar a triagem.' }] }), tools)
    expect(ai.items).toEqual([{ kind: 'assistant', key: 'm2', at: '2026-10-05T18:46:00Z', text: 'Vou validar a triagem.' }])
    expect(parseCodexLine(rec('response_item', { type: 'reasoning', encrypted_content: 'x' }), tools).items).toEqual([])
  })

  it('comandos, navegador e patch viram cartões; a saída atualiza o cartão', () => {
    const tools = new Map<string, ToolItem>()
    const cmd = parseCodexLine(rec('response_item', { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"npm test","workdir":"C:\\\\proj"}', call_id: 'c1' }), tools)
    expect(cmd.items[0]).toMatchObject({ kind: 'tool', key: 'c1', title: 'Executou um comando', detail: 'npm test', done: false })
    const out = parseCodexLine(rec('response_item', { type: 'function_call_output', call_id: 'c1', output: 'Process exited with code 1\nOutput:\nfalhou' }), tools)
    expect(out.items[0]).toMatchObject({ key: 'c1', done: true, error: true })
    const nav = parseCodexLine(rec('response_item', { type: 'function_call', name: 'browser_click', arguments: '{"element":"Enviar"}', call_id: 'c2' }), tools)
    expect(nav.items[0]).toMatchObject({ title: 'navegador: click', detail: 'Enviar' })
    const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-antes\n+depois\n*** End Patch'
    const ed = parseCodexLine(rec('response_item', { type: 'custom_tool_call', name: 'apply_patch', input: patch, call_id: 'c3' }), tools)
    expect(ed.items[0]).toMatchObject({ title: 'Editou a.ts', diff: { del: ['antes'], add: ['depois'] } })
  })

  it('session_meta: pasta e início da sessão', () => {
    expect(codexSessionMeta(rec('session_meta', { id: 's1', cwd: 'C:\\proj', timestamp: '2026-10-05T17:22:29Z' }))).toEqual({
      id: 's1',
      cwd: 'C:\\proj',
      startedAt: Date.parse('2026-10-05T17:22:29Z')
    })
    expect(codexSessionMeta(rec('turn_context', {}))).toBeNull()
  })
})

describe('describeTool', () => {
  it('edição vira diff; MCP do Playwright fica legível; tarefas viram lista', () => {
    expect(describeTool('Edit', { file_path: '/p/x.ts', old_string: 'a', new_string: 'b\nc' })).toMatchObject({ title: 'Editou x.ts', diff: { del: ['a'], add: ['b', 'c'] } })
    expect(describeTool('mcp__playwright__browser_navigate', { url: 'http://localhost:55354' })).toMatchObject({ title: 'playwright: navigate', detail: 'http://localhost:55354' })
    expect(describeTool('TodoWrite', { todos: [{ content: 'Testar', status: 'pending' }] }).todos).toEqual([{ text: 'Testar', status: 'pending' }])
  })
})

describe('detectPendingChoice', () => {
  const permission = [
    '● Bash(dotnet build ATUALIZAPREV.sln)',
    '',
    ' Bash command',
    '',
    '   dotnet build ATUALIZAPREV.sln',
    '   Compila a solução',
    '',
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    "   2. Yes, and don't ask again for dotnet build commands in this project",
    '   3. No, and tell Claude what to do differently (esc)',
    ''
  ].join('\n')

  it('pedido de permissão do Claude Code: pergunta, opções e cursor', () => {
    const c = detectPendingChoice(permission)!
    expect(c.question).toBe('Do you want to proceed?')
    expect(c.options.map((o) => o.number)).toEqual(['1', '2', '3'])
    expect(c.options[1]!.label).toContain("don't ask again")
    expect(c.cursorKnown).toBe(true)
    expect(c.excerpt).toContain('dotnet build ATUALIZAPREV.sln')
    expect(keysForChoice(c, 0)).toBe('\r')
    expect(keysForChoice(c, 2)).toBe('\x1b[B\x1b[B\r')
  })

  it('menu sem números com rodapé (confiança na pasta)', () => {
    const c = detectPendingChoice(
      [' Quick safety check: Is this a project you created or one you trust?', '', ' ❯ No, exit', '   Yes, I trust this folder', '', ' Enter to confirm · Esc to cancel'].join('\n')
    )!
    expect(c.question).toBe('Quick safety check: Is this a project you created or one you trust?')
    expect(c.options.map((o) => o.label)).toEqual(['No, exit', 'Yes, I trust this folder'])
    expect(c.cursor).toBe(0)
    expect(keysForChoice(c, 1)).toBe('\x1b[B\r')
  })

  it('questionário do AskUserQuestion: abas, opções com explicação, separador antes do "Chat about this"', () => {
    const screen = [
      '● Hoje o assistente só menciona os documentos obrigatórios pendentes.',
      '',
      '────────────────────────────────────────',
      ' ←  ☒ Momento  ☐ Opcionais  ✓ Submit  →',
      '',
      'E os documentos que NÃO são obrigatórios para a pessoa?',
      '',
      '❯ 1. Listar e conferir também (Recomendado)',
      '     O assistente lista os opcionais separados dos obrigatórios ("se você tiver"), e a pessoa',
      '     pode enviá-los pelo clipe.',
      '  2. Listar, mas não receber',
      '     O assistente só informa os opcionais para a pessoa levar se tiver.',
      '  3. Type something.',
      '────────────────────────────────────────',
      '  4. Chat about this',
      '',
      'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
      ''
    ].join('\n')
    const c = detectPendingChoice(screen)!
    expect(c).not.toBeNull()
    expect(c.question).toBe('E os documentos que NÃO são obrigatórios para a pessoa?')
    expect(c.progress).toBe('☒ Momento · ☐ Opcionais · ✓ Submit')
    expect(c.options.map((o) => o.label)).toEqual(['Listar e conferir também (Recomendado)', 'Listar, mas não receber', 'Type something.', 'Chat about this'])
    expect(c.options[0]!.detail).toBe('O assistente lista os opcionais separados dos obrigatórios ("se você tiver"), e a pessoa pode enviá-los pelo clipe.')
    expect(c.options[2]!.input).toBe(true)
    expect(c.cursor).toBe(0)
    expect(choiceSteps(c, 1)).toEqual(['\x1b[B', '\r'])
    expect(choiceSteps(c, 2, 'só listar\nsem cobrar')).toEqual(['\x1b[B', '\x1b[B', 'só listar sem cobrar', '\r'])
    expect(keysForChoice(c, 3)).toBe('\x1b[B\x1b[B\x1b[B\r')
  })

  it('questionário do Claude Code 2.1.294: pergunta longa com barra à esquerda e a borda com o nome da sessão embaixo', () => {
    const screen = [
      '─────────────────────────────────────────────────────────────────',
      '←  ☐ Ambiente  ☐ Login  ✔ Submit  →',
      '',
      '│ O manual pede fotos das telas reais, mas nenhuma base de teste',
      '│ tem as tabelas do módulo novo. Como faço as capturas?',
      '',
      '❯ 1. Instalar na base de teste (Recomendado)',
      '     Rodar um script SQL que cria as tabelas do módulo.',
      '  2. Usar outro ambiente pronto',
      '     Capturar as telas em um ambiente que já tenha as tabelas.',
      '  3. Type something.',
      '─────────────────────────────────────────────────────────────────',
      '  4. Chat about this',
      '',
      'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
      '──────────────────────────────────────────────── LOJA-ONLINE/leitor ─'
    ].join('\n')
    const c = detectPendingChoice(screen)!
    // linhas da mesma frase quebradas pela largura da tela voltam a ser uma frase só
    expect(c.question).toBe('O manual pede fotos das telas reais, mas nenhuma base de teste tem as tabelas do módulo novo. Como faço as capturas?')
    expect(c.progress).toBe('☐ Ambiente · ☐ Login · ✔ Submit')
    expect(c.options.map((o) => o.label)).toEqual(['Instalar na base de teste (Recomendado)', 'Usar outro ambiente pronto', 'Type something.', 'Chat about this'])
    expect(c.cursor).toBe(0)
  })

  it('aba de envio do questionário', () => {
    const c = detectPendingChoice(
      [' ←  ☒ Momento  ☒ Opcionais  ✔ Submit  →', '', 'Review your answers', '', ' ● Momento', '   → Antes de marcar', '', 'Ready to submit your answers?', '', '❯ 1. Submit answers', '  2. Cancel', '', 'Enter to select · Esc to cancel'].join('\n')
    )!
    expect(c.options.map((o) => o.label)).toEqual(['Submit answers', 'Cancel'])
    expect(c.progress).toContain('Submit')
  })

  it('não confunde o campo de digitação nem listas numeradas na resposta com um menu', () => {
    expect(detectPendingChoice(['● Pronto.', '', '─────', '❯ ', '─────', '  ⏵⏵ auto mode on (shift+tab to cycle)'].join('\n'))).toBeNull()
    expect(detectPendingChoice(['Passos:', '2. compile', '3. teste', '', '❯ '].join('\n'))).toBeNull()
    expect(detectPendingChoice(['● Passos:', '  1. compile', '  2. teste', '─────', '❯ ', '─────', '  ⏵⏵ auto mode on'].join('\n'))).toBeNull()
    expect(detectPendingChoice('')).toBeNull()
  })
})

describe('lastAssistantText', () => {
  it('pega a última resposta escrita do agente, ignorando ferramentas e linhas quebradas', () => {
    const lines = [
      '{"type":"assistant","uuid":"a1","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"Primeira"}]}}',
      'linha cortada {"type":',
      '{"type":"assistant","uuid":"a2","timestamp":"t","message":{"role":"assistant","content":[{"type":"tool_use","id":"x","name":"Bash","input":{"command":"ls"}}]}}',
      '{"type":"assistant","uuid":"a3","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"Terminei a correção."}]}}'
    ].join('\n')
    expect(lastAssistantText(lines, 'claude')).toBe('Terminei a correção.')
    expect(lastAssistantText('', 'claude')).toBe('')
  })
})
