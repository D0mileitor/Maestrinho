import type { AgentPreset, TerminalNodeData } from './schemas'

/**
 * Hibernação de agentes parados (lógica pura): o processo é encerrado para poupar memória e a conversa
 * continua guardada no histórico do agente; ao acordar, o app retoma a mesma sessão.
 */

/** Momento do agente que pode impedir a hibernação automática. */
export interface HibernationMoment {
  now: number
  /** Tempo parado para hibernar (ms); 0 = desligado. */
  thresholdMs: number
  /** Última atividade real: saída do processo, digitação sua ou início do processo. */
  lastActiveAt: number
  activity: 'idle' | 'busy'
  /** Terminou de iniciar (primeira ociosidade). */
  ready: boolean
  /** Parado pedindo aprovação ou resposta (a pergunta se perderia ao encerrar). */
  needsInput: boolean
  /** Esperando outro agente (orq send --wait). */
  waitingOn: boolean
  /** Você está neste terminal no app. */
  focused: boolean
  /** O chat está ligado a este terminal. */
  chatOpen: boolean
  /** A tela mostra uma pergunta com opções (permissão, AskUserQuestion). */
  pendingChoice: boolean
}

export function shouldAutoHibernate(m: HibernationMoment): boolean {
  if (m.thresholdMs <= 0) return false
  if (m.activity !== 'idle' || !m.ready) return false
  if (m.needsInput || m.waitingOn || m.focused || m.chatOpen || m.pendingChoice) return false
  return m.now - m.lastActiveAt >= m.thresholdMs
}

/**
 * Por que este terminal não pode hibernar (texto em pt-BR), ou null se pode. Só hiberna quem consegue
 * retomar a conversa: agente com retomada de sessão, id de sessão conhecido e histórico existente.
 */
export function hibernationBlocker(
  node: TerminalNodeData,
  preset: AgentPreset,
  opts: { resumeSessions: boolean; sessionExists: boolean }
): string | null {
  if (preset.isShell || preset.remoteOrq) return 'shells e sessões SSH perderiam o que está rodando'
  if (preset.sessionStore === 'none' || preset.resumeArgs.length === 0) return 'o preset não retoma a conversa'
  if (!opts.resumeSessions) return 'a retomada de conversa está desligada nas configurações'
  if (!node.sessionId) return 'a conversa ainda não tem histórico (mande ao menos uma mensagem antes)'
  if (!opts.sessionExists) return 'o histórico da conversa não foi encontrado'
  return null
}
