import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { WorkspaceListItem, WorkspaceOp, WorkspaceOpenResult } from '@shared/ipc'
import type { CanvasNode, WorkspaceDoc } from '@shared/schemas'
import {
  WorkspaceStore,
  ensureMetaDir,
  findValidBackup,
  loadWorkspaceDoc,
  restoreWorkspaceBackup,
  type OpSource
} from './WorkspaceStore'
import type { ConfigStore } from './ConfigStore'
import { log } from '../util/log'

export interface WorkspaceManagerEvents {
  ops: [string, WorkspaceOp[], OpSource]
  opened: [WorkspaceStore]
  closing: [WorkspaceStore]
  activated: [string | null]
}

function normDir(dir: string): string {
  const abs = path.resolve(dir)
  return process.platform === 'win32' ? abs.replace(/[\\/]+$/, '') : abs.replace(/\/+$/, '') || '/'
}

function sameDir(a: string, b: string): boolean {
  return process.platform === 'win32' ? normDir(a).toLowerCase() === normDir(b).toLowerCase() : normDir(a) === normDir(b)
}

function isGitRepo(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.git'))
}

/**
 * Workspaces "vivos" (carregados, com terminais podendo rodar em segundo plano) e o workspace
 * ativo, exibido no canvas. Trocar de workspace não encerra os terminais dos outros.
 */
export class WorkspaceManager extends EventEmitter<WorkspaceManagerEvents> {
  private readonly live = new Map<string, WorkspaceStore>()
  private activeKey: string | null = null

  constructor(private readonly config: ConfigStore) {
    super()
  }

  private key(dir: string): string {
    const n = normDir(dir)
    return process.platform === 'win32' ? n.toLowerCase() : n
  }

  get active(): WorkspaceStore | null {
    return this.activeKey ? (this.live.get(this.activeKey) ?? null) : null
  }

  get(dir: string): WorkspaceStore | undefined {
    return this.live.get(this.key(dir))
  }

  all(): WorkspaceStore[] {
    return [...this.live.values()]
  }

  /** Workspace que contém o nó (terminal, nota...). */
  forNode(nodeId: string): WorkspaceStore | undefined {
    for (const ws of this.live.values()) if (ws.doc.nodes.some((n) => n.id === nodeId)) return ws
    return undefined
  }

  nodeById(nodeId: string): { ws: WorkspaceStore; node: CanvasNode } | undefined {
    for (const ws of this.live.values()) {
      const node = ws.doc.nodes.find((n) => n.id === nodeId)
      if (node) return { ws, node }
    }
    return undefined
  }

  list(): WorkspaceListItem[] {
    const dirs = this.config.settings.recentWorkspaces
    const items: WorkspaceListItem[] = dirs.map((dir) => {
      const ws = this.get(dir)
      return {
        dir,
        name: ws?.doc.name ?? path.basename(dir),
        live: Boolean(ws),
        active: Boolean(ws && this.activeKey === this.key(dir)),
        exists: fs.existsSync(dir)
      }
    })
    return items
  }

  private result(ws: WorkspaceStore, extra: Partial<WorkspaceOpenResult> = {}): WorkspaceOpenResult {
    return { dir: ws.dir, doc: ws.doc, isGitRepo: isGitRepo(ws.dir), ...extra }
  }

  /** Abre (ou só ativa, se já estiver vivo) um workspace. */
  async open(dir: string): Promise<WorkspaceOpenResult> {
    const abs = normDir(dir)
    const existing = this.get(abs)
    if (existing) {
      this.setActive(existing)
      return this.result(existing)
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error('a pasta do workspace não existe')
    const outcome = await loadWorkspaceDoc(abs)
    if (!outcome.doc) {
      const valid = await findValidBackup(abs)
      log.warn('workspace.json corrompido', { backups: outcome.backups.length })
      return {
        dir: abs,
        doc: { version: 1, id: 'corrompido', name: path.basename(abs), nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, floors: [] },
        isGitRepo: isGitRepo(abs),
        corrupted: { error: outcome.error ?? 'arquivo inválido', backups: valid ? [valid.name, ...outcome.backups.filter((b) => b !== valid.name)] : outcome.backups }
      }
    }
    return this.activateLoaded(abs, outcome.doc)
  }

  private async activateLoaded(abs: string, doc: WorkspaceDoc, extra: Partial<WorkspaceOpenResult> = {}): Promise<WorkspaceOpenResult> {
    await ensureMetaDir(abs)
    const ws = new WorkspaceStore(abs, doc)
    ws.on('ops', (ops, source) => this.emit('ops', ws.dir, ops, source))
    this.live.set(this.key(abs), ws)
    this.config.addRecentWorkspace(abs)
    this.emit('opened', ws)
    this.setActive(ws)
    // Garante que o arquivo exista em disco desde a primeira abertura.
    ws.scheduleSave()
    log.info('workspace aberto', { nodes: doc.nodes.length })
    return this.result(ws, extra)
  }

  async restoreBackup(dir: string, backup: string): Promise<WorkspaceOpenResult> {
    const abs = normDir(dir)
    if (this.get(abs)) throw new Error('o workspace já está aberto')
    const doc = await restoreWorkspaceBackup(abs, backup)
    return this.activateLoaded(abs, doc, { restoredFrom: backup || undefined })
  }

  private setActive(ws: WorkspaceStore | null): void {
    this.activeKey = ws ? this.key(ws.dir) : null
    if (ws) this.config.setSettings({ lastWorkspace: ws.dir })
    this.emit('activated', ws?.dir ?? null)
  }

  /** Fecha um workspace: encerra seus terminais (via evento 'closing') e salva. */
  async close(dir: string): Promise<void> {
    const ws = this.get(dir)
    if (!ws) return
    this.emit('closing', ws)
    await ws.flush()
    this.live.delete(this.key(dir))
    if (this.activeKey === this.key(dir)) {
      const next = this.live.values().next().value as WorkspaceStore | undefined
      this.setActive(next ?? null)
    }
  }

  forget(dir: string): void {
    const remaining = this.config.settings.recentWorkspaces.filter((d) => !sameDir(d, dir))
    this.config.setSettings({ recentWorkspaces: remaining })
  }

  applyOps(dir: string, ops: WorkspaceOp[], source: OpSource): void {
    const ws = this.get(dir)
    if (!ws) throw new Error('workspace não está aberto')
    ws.apply(ops, source)
  }

  flushAllSync(): void {
    for (const ws of this.live.values()) ws.flushSync()
  }
}
