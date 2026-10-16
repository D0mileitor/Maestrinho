import { CLI_NAME } from './constants'

/**
 * Estado exato dos agentes: em vez de deduzir pelo silêncio da tela, o próprio agente avisa quando
 * começa a trabalhar, quando termina e quando para esperando você.
 *  - Claude Code: hooks (passados com `--settings`) chamam `orq hook`, que repassa só metadados ao app;
 *  - Codex: notificações de terminal (OSC 9) que o próprio TUI emite, lidas no espelho do PTY.
 * Funções puras (sem I/O): o main só liga as pontas.
 */

/** Como o preset avisa o estado: hooks do Claude Code, notificações do Codex ou nada. */
export type AgentEventsKind = 'none' | 'claude' | 'codex'

/** working = começou/continua trabalhando; done = terminou a vez; needsInput = parou esperando você. */
export type AgentSignal = 'working' | 'done' | 'needsInput'

/** Metadados de um hook do Claude Code (nunca o texto do prompt, da resposta ou das ferramentas). */
export interface HookInfo {
  event: string
  /** notification_type (Notification). */
  kind?: string
  /** tool_name (PreToolUse/PostToolUse/PermissionRequest). */
  tool?: string
}

/** Notificações do Claude Code que significam "parei e preciso de você". */
const CLAUDE_NEEDS_INPUT = new Set(['permission_prompt', 'elicitation_dialog'])

/** Traduz um hook do Claude Code no sinal de estado (null = não muda nada). */
export function claudeHookSignal(h: HookInfo): AgentSignal | null {
  switch (h.event) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return 'working'
    case 'PreToolUse':
      // Pergunta com opções: a vez do agente para até você responder.
      return h.tool === 'AskUserQuestion' ? 'needsInput' : 'working'
    case 'PermissionRequest':
      return 'needsInput'
    case 'Notification':
      return h.kind && CLAUDE_NEEDS_INPUT.has(h.kind) ? 'needsInput' : null
    case 'Stop':
      return 'done'
    default:
      return null
  }
}

/** Textos das notificações do TUI do Codex que pedem uma decisão sua (aprovação, plano, pergunta). */
const CODEX_NEEDS_INPUT = /^\s*(approval requested|codex wants to|plan mode prompt|question requested)|permission request/i

/**
 * Traduz o texto de uma notificação OSC 9 do Codex. "Agent turn complete" (ou a prévia da resposta) =
 * terminou; pedidos de aprovação, plano ou pergunta = precisa de você. Sequências OSC 9 com subcomando
 * numérico (ex.: 9;4 = barra de progresso do Windows Terminal) não são notificações.
 */
export function codexNotificationSignal(text: string): AgentSignal | null {
  const t = text.trim()
  if (t === '' || /^\d+;/.test(t)) return null
  return CODEX_NEEDS_INPUT.test(t) ? 'needsInput' : 'done'
}

/** Eventos do Claude Code que o app escuta (todos assíncronos: não atrasam o agente). */
export const CLAUDE_HOOK_EVENTS: readonly { event: string; matcher?: string }[] = [
  { event: 'UserPromptSubmit' },
  { event: 'PreToolUse', matcher: 'AskUserQuestion' },
  { event: 'PostToolUse', matcher: '*' },
  { event: 'PermissionRequest', matcher: '*' },
  { event: 'Notification', matcher: 'permission_prompt|elicitation_dialog' },
  { event: 'Stop' }
]

/**
 * Conteúdo do arquivo passado ao Claude Code com `--settings`: só hooks, todos chamando `orq hook`
 * (o shim do CLI está no PATH do terminal e lê porta e token do ambiente). Assíncronos: o agente não
 * espera o app; a ordem é garantida pelo horário que o CLI envia.
 */
export function claudeHookSettings(): { hooks: Record<string, { matcher?: string; hooks: { type: 'command'; command: string; async: true; timeout: number }[] }[]> } {
  const hooks: Record<string, { matcher?: string; hooks: { type: 'command'; command: string; async: true; timeout: number }[] }[]> = {}
  for (const { event, matcher } of CLAUDE_HOOK_EVENTS) {
    const entry = { hooks: [{ type: 'command' as const, command: `${CLI_NAME} hook`, async: true as const, timeout: 15 }] }
    hooks[event] = [matcher ? { matcher, ...entry } : entry]
  }
  return { hooks }
}

/**
 * Argumentos do Codex para ele avisar o terminal (OSC 9) ao terminar a vez e ao pedir aprovação, mesmo
 * com a janela em foco. Valores sem aspas: o `-c` do Codex trata como texto o que não é TOML válido, e
 * aspas não sobrevivem ao `codex.cmd` (cmd.exe) no Windows.
 */
export function codexNotifyArgs(): string[] {
  return ['-c', 'tui.notifications=true', '-c', 'tui.notification_method=osc9', '-c', 'tui.notification_condition=always']
}

/**
 * Extrai do JSON que o Claude Code passa ao hook apenas os metadados usados pelo app. Nunca lê prompt,
 * resposta, entrada/saída de ferramentas nem caminhos de arquivo.
 */
export function hookInfoFromPayload(raw: string): HookInfo | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  const pick = (k: string): string | undefined => {
    const v = o[k]
    return typeof v === 'string' && v.length > 0 && v.length <= 128 && /^[\w.:|-]+$/.test(v) ? v : undefined
  }
  const event = pick('hook_event_name')
  if (!event) return null
  const info: HookInfo = { event }
  const kind = pick('notification_type')
  const tool = pick('tool_name')
  if (kind) info.kind = kind
  if (tool) info.tool = tool
  return info
}
