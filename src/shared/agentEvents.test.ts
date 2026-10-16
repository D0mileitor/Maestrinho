import { describe, expect, it } from 'vitest'
import { claudeHookSettings, claudeHookSignal, codexNotificationSignal, codexNotifyArgs, hookInfoFromPayload } from './agentEvents'

describe('claudeHookSignal', () => {
  it('pedido enviado e ferramentas = trabalhando; Stop = terminou', () => {
    expect(claudeHookSignal({ event: 'UserPromptSubmit' })).toBe('working')
    expect(claudeHookSignal({ event: 'PostToolUse', tool: 'Bash' })).toBe('working')
    expect(claudeHookSignal({ event: 'PreToolUse', tool: 'Edit' })).toBe('working')
    expect(claudeHookSignal({ event: 'Stop' })).toBe('done')
  })

  it('permissão, pergunta com opções e diálogos de MCP = precisa de você', () => {
    expect(claudeHookSignal({ event: 'PermissionRequest', tool: 'Bash' })).toBe('needsInput')
    expect(claudeHookSignal({ event: 'PreToolUse', tool: 'AskUserQuestion' })).toBe('needsInput')
    expect(claudeHookSignal({ event: 'Notification', kind: 'permission_prompt' })).toBe('needsInput')
    expect(claudeHookSignal({ event: 'Notification', kind: 'elicitation_dialog' })).toBe('needsInput')
  })

  it('aviso de "parado esperando" e eventos desconhecidos não mudam o estado', () => {
    expect(claudeHookSignal({ event: 'Notification', kind: 'idle_prompt' })).toBeNull()
    expect(claudeHookSignal({ event: 'Notification' })).toBeNull()
    expect(claudeHookSignal({ event: 'SessionStart' })).toBeNull()
    expect(claudeHookSignal({ event: 'Qualquer' })).toBeNull()
  })
})

describe('codexNotificationSignal', () => {
  it('fim da vez (texto padrão ou prévia da resposta) = terminou', () => {
    expect(codexNotificationSignal('Agent turn complete')).toBe('done')
    expect(codexNotificationSignal('Pronto: filtro de CPF corrigido')).toBe('done')
  })

  it('aprovação, edição, plano e pergunta = precisa de você', () => {
    expect(codexNotificationSignal('Approval requested: npm test')).toBe('needsInput')
    expect(codexNotificationSignal('Codex wants to edit src/a.ts')).toBe('needsInput')
    expect(codexNotificationSignal('Plan mode prompt: confirmar plano')).toBe('needsInput')
    expect(codexNotificationSignal('Question requested')).toBe('needsInput')
  })

  it('OSC 9 com subcomando numérico (progresso, pasta atual) e texto vazio são ignorados', () => {
    expect(codexNotificationSignal('4;1;50')).toBeNull()
    expect(codexNotificationSignal('9;C:\\projeto')).toBeNull()
    expect(codexNotificationSignal('   ')).toBeNull()
  })
})

describe('hookInfoFromPayload', () => {
  it('pega só evento, tipo de notificação e nome da ferramenta', () => {
    const raw = JSON.stringify({
      session_id: 'x',
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'C:/segredo.txt', new_string: 'senha' },
      prompt: 'conteúdo do usuário'
    })
    expect(hookInfoFromPayload(raw)).toEqual({ event: 'PostToolUse', tool: 'Edit' })
    expect(hookInfoFromPayload(JSON.stringify({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'x' }))).toEqual({
      event: 'Notification',
      kind: 'permission_prompt'
    })
  })

  it('JSON inválido, sem evento ou com valores estranhos devolve null ou ignora o campo', () => {
    expect(hookInfoFromPayload('não é json')).toBeNull()
    expect(hookInfoFromPayload('{}')).toBeNull()
    expect(hookInfoFromPayload(JSON.stringify({ hook_event_name: 'Stop\n; rm -rf' }))).toBeNull()
    expect(hookInfoFromPayload(JSON.stringify({ hook_event_name: 'Stop', tool_name: 42 }))).toEqual({ event: 'Stop' })
  })
})

describe('configuração dos agentes', () => {
  it('hooks do Claude: todos assíncronos chamando "orq hook"', () => {
    const { hooks } = claudeHookSettings()
    expect(Object.keys(hooks).sort()).toEqual(['Notification', 'PermissionRequest', 'PostToolUse', 'PreToolUse', 'Stop', 'UserPromptSubmit'])
    for (const groups of Object.values(hooks)) {
      for (const g of groups) for (const h of g.hooks) expect(h).toMatchObject({ type: 'command', command: 'orq hook', async: true })
    }
    expect(hooks['PreToolUse']![0]!.matcher).toBe('AskUserQuestion')
  })

  it('Codex: notificações OSC 9 sempre, sem aspas nos valores', () => {
    const args = codexNotifyArgs()
    expect(args.filter((a) => a !== '-c')).toEqual(['tui.notifications=true', 'tui.notification_method=osc9', 'tui.notification_condition=always'])
    expect(args.join(' ')).not.toContain('"')
  })
})
