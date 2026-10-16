import type { ActivityState } from './idle'
import type { MessageMood } from './mood'

/** Tipos de estado em tempo de execução (não persistidos). */

export type TerminalStatus = 'starting' | 'running' | 'exited' | 'error'

export interface TerminalRuntimeInfo {
  id: string
  status: TerminalStatus
  activity: ActivityState
  pid?: number
  exitCode?: number
  /** Mensagem de erro amigável (ex.: comando não encontrado). */
  error?: string
  /** Selo de status definido pelo agente via `orq status`. */
  badge?: string
  /** O processo já ficou ocioso ao menos uma vez (terminou de iniciar). */
  ready?: boolean
  /**
   * Contador de "terminou e aguarda você": incrementa quando o terminal fica ocioso depois de um
   * período de trabalho real (não conta a inicialização, rajadas curtas nem espera por outro agente).
   */
  attentionSeq: number
  /** Motivo do último pedido de atenção: terminou a vez ou parou esperando você (aprovação, pergunta). */
  attentionKind?: 'done' | 'waiting'
  /**
   * O agente avisa o próprio estado (hooks do Claude Code / notificações do Codex) neste processo: o
   * "terminou" é exato, não deduzido pelo silêncio da tela.
   */
  exact?: boolean
  /** Agente parado esperando você (aprovação, pergunta) segundo o próprio agente. */
  needsInput?: boolean
  /** Nome do peer que este terminal está aguardando (orq send --wait). */
  waitingOn?: string
  cols: number
  rows: number
  /** Linha de comando efetivamente iniciada (sem conteúdo de instruções). */
  commandLine?: string
  /** Quando o processo atual foi iniciado (ms desde a época); o chat usa para achar a sessão do Codex. */
  startedAt?: number
}

export interface AttachResult {
  info: TerminalRuntimeInfo
  /** Estado serializado da tela + scrollback (sequências VT) para reconstruir o xterm. */
  snapshot: string
  /** Sequência do último bloco incluído no snapshot; blocos com seq <= este devem ser ignorados. */
  seq: number
}

export interface PtyDataEvent {
  id: string
  seq: number
  data: string
}

/** Uma mensagem passou por uma conexão (para animar a aresta). */
export interface EdgeActivityEvent {
  from: string
  to: string
  kind: 'send' | 'read' | 'note'
  /** Tom da mensagem (reprovação ou aprovação), para a cena no escritório. Nunca o texto. */
  mood?: MessageMood
}
