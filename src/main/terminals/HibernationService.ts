import { detectPendingChoice } from '@shared/chat'
import { hibernationBlocker, shouldAutoHibernate } from '@shared/hibernation'
import type { WorkspaceOp } from '@shared/ipc'
import type { TerminalRuntimeInfo } from '@shared/runtime'
import type { TerminalNodeData } from '@shared/schemas'
import type { PtyManager } from '../pty/PtyManager'
import type { ConfigStore } from '../store/ConfigStore'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import type { WorkspaceStore } from '../store/WorkspaceStore'
import type { TerminalService } from './TerminalService'
import { log } from '../util/log'

export interface HibernationDeps {
  workspaces: WorkspaceManager
  terminals: TerminalService
  ptys: PtyManager
  config: ConfigStore
  applyMainOps(ws: WorkspaceStore, ops: WorkspaceOp[]): void
  /** Terminal em que você está no app (nunca hiberna). */
  focusedTerminal(): string | null
  /** O chat está ligado a este terminal (nunca hiberna). */
  chatOpen(id: string): boolean
}

const SWEEP_MS = 60_000
/** Quanto esperar o agente acordado terminar de iniciar antes de entregar algo a ele. */
const WAKE_READY_MS = 45_000

/**
 * Hibernação: encerra o processo de agentes parados (sozinho, depois do tempo das configurações, ou pelo
 * menu) e marca o nó como hibernando; a conversa fica no histórico do agente. Acordar = iniciar de novo,
 * retomando a mesma sessão. Acorda sozinho ao receber mensagem de outro agente, do chat ou de uma rotina.
 */
export class HibernationService {
  private timer: NodeJS.Timeout | null = null
  /** Tamanho da tela de cada terminal ao hibernar (para acordar já no tamanho certo). */
  private readonly sizes = new Map<string, { cols: number; rows: number }>()

  constructor(private readonly deps: HibernationDeps) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.sweep(), SWEEP_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private find(id: string): { ws: WorkspaceStore; node: TerminalNodeData } | null {
    const found = this.deps.workspaces.nodeById(id)
    if (!found || found.node.kind !== 'terminal') return null
    return { ws: found.ws, node: found.node }
  }

  /** Por que não dá para hibernar este terminal agora (pt-BR), ou null. */
  blocker(id: string): string | null {
    const found = this.find(id)
    if (!found) return 'terminal não encontrado'
    const { node } = found
    const preset = this.deps.terminals.presetFor(node)
    const reason = hibernationBlocker(node, preset, {
      resumeSessions: this.deps.config.settings.resumeSessions,
      sessionExists: this.deps.terminals.sessionExists(node)
    })
    if (reason) return reason
    const info = this.deps.ptys.info(id)
    if (info?.status === 'running') {
      if (info.activity === 'busy') return 'o agente está trabalhando'
      if (info.needsInput || detectPendingChoice(this.deps.ptys.readScreen(id, 40) ?? '')) return 'o agente está esperando a sua resposta'
      if (info.waitingOn) return `o agente está esperando "${info.waitingOn}"`
    }
    return null
  }

  /** Hiberna agora. Lança erro (pt-BR) se não puder. */
  hibernate(id: string, reason: 'auto' | 'manual'): void {
    const found = this.find(id)
    if (!found) throw new Error('terminal não encontrado')
    if (found.node.hibernated) return
    const blocked = this.blocker(id)
    if (blocked) throw new Error(`Não dá para hibernar "${found.node.name}": ${blocked}.`)
    const info = this.deps.ptys.info(id)
    if (info) this.sizes.set(id, { cols: info.cols, rows: info.rows })
    this.deps.applyMainOps(found.ws, [{ op: 'updateNode', id, patch: { hibernated: true } }])
    if (this.deps.ptys.has(id)) this.deps.terminals.stop(id)
    log.info('agente hibernado', { id, reason })
  }

  /**
   * Acorda um agente hibernando: tira a marca e inicia o processo (retomando a sessão). Devolve true se
   * estava hibernando. O processo fica "iniciando" até a primeira ociosidade (use `wakeAndWait`).
   */
  wake(id: string): boolean {
    const found = this.find(id)
    if (!found?.node.hibernated) return false
    this.deps.applyMainOps(found.ws, [{ op: 'updateNode', id, patch: { hibernated: undefined } }])
    const size = this.sizes.get(id) ?? estimateGrid(found.node.size)
    this.sizes.delete(id)
    try {
      this.deps.terminals.ensure(id, size.cols, size.rows)
    } catch (err) {
      log.warn('não foi possível acordar o agente', { id, error: err instanceof Error ? err.name : 'erro' })
    }
    log.info('agente acordado', { id })
    return true
  }

  /** Acorda (se hibernando) e espera o agente ficar pronto para receber texto. */
  async wakeAndWait(id: string): Promise<TerminalRuntimeInfo | undefined> {
    if (!this.wake(id)) return this.deps.ptys.info(id)
    const until = Date.now() + WAKE_READY_MS
    while (Date.now() < until) {
      const info = this.deps.ptys.info(id)
      if (!info || info.status !== 'running' || info.ready) return info
      await new Promise((r) => setTimeout(r, 200))
    }
    return this.deps.ptys.info(id)
  }

  /** Verificação periódica: hiberna quem está parado há mais tempo que o configurado. */
  sweep(now = Date.now()): void {
    const minutes = this.deps.config.settings.hibernateAfterMin
    if (minutes <= 0) return
    const focused = this.deps.focusedTerminal()
    for (const id of this.deps.terminals.runningIds()) {
      const info = this.deps.ptys.info(id)
      const found = this.find(id)
      if (!info || info.status !== 'running' || !found || found.node.hibernated) continue
      const lastActiveAt = Math.max(this.deps.ptys.lastActivity(id), this.deps.ptys.lastUserInputAt(id), info.startedAt ?? 0)
      const moment = {
        now,
        thresholdMs: minutes * 60_000,
        lastActiveAt,
        activity: info.activity,
        ready: info.ready === true,
        needsInput: info.needsInput === true,
        waitingOn: Boolean(info.waitingOn),
        focused: focused === id,
        chatOpen: this.deps.chatOpen(id),
        pendingChoice: false
      }
      if (!shouldAutoHibernate(moment)) continue
      // Só lê a tela de quem já passou nos critérios baratos.
      if (detectPendingChoice(this.deps.ptys.readScreen(id, 40) ?? '')) continue
      if (this.blocker(id)) continue
      try {
        this.hibernate(id, 'auto')
      } catch {
        // mudou de estado no meio: tenta na próxima volta
      }
    }
  }
}

/** Colunas/linhas aproximadas para o tamanho do nó (o renderer corrige ao mostrar). */
function estimateGrid(size: { w: number; h: number }): { cols: number; rows: number } {
  return {
    cols: Math.max(20, Math.min(400, Math.floor((size.w - 10) / 7.8))),
    rows: Math.max(5, Math.min(200, Math.floor((size.h - 40) / 17)))
  }
}
