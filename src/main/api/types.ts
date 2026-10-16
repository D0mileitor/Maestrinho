import type { WorkspaceOp } from '@shared/ipc'
import type { EdgeActivityEvent } from '@shared/runtime'
import type { PtyManager } from '../pty/PtyManager'
import type { ConfigStore } from '../store/ConfigStore'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import type { WorkspaceStore } from '../store/WorkspaceStore'
import type { TerminalService } from '../terminals/TerminalService'
import type { NotesApi } from '../notes/types'
import type { BoardService } from '../board/BoardService'
import type { PortalApi } from '../portals/PortalRegistry'

/** Dependências dos handlers da API local (fornecidas pelo AppContext). */
export interface ApiDeps {
  workspaces: WorkspaceManager
  terminals: TerminalService
  ptys: PtyManager
  config: ConfigStore
  notes: NotesApi
  /** Aplica operações originadas no main (persistidas e repassadas ao renderer). */
  applyMainOps(ws: WorkspaceStore, ops: WorkspaceOp[]): void
  /** Notificação nativa do sistema. */
  notify(title: string, body: string, opts: { terminalId: string; dir: string }): void
  /** Uma mensagem/leitura passou por uma conexão (anima a aresta). */
  emitEdgeActivity(e: EdgeActivityEvent): void
  /** Quadro de chamados dos workspaces (orq board). */
  board?: BoardService
  /** Páginas dos portais (orq portal); ausente nos testes que não usam portais. */
  portals?: PortalApi
  /** Acorda um agente hibernando (true se estava hibernando; o processo fica iniciando). */
  wake?(id: string): boolean
}
