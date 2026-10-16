import * as fs from 'node:fs'
import * as path from 'node:path'
import { newId } from '@shared/ids'
import type { FloorStatus, WorkspaceOp } from '@shared/ipc'
import type { Floor } from '@shared/schemas'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import type { WorkspaceStore } from '../store/WorkspaceStore'
import { branchExists, branchSlug, currentBranch, git, isGitRepo, listBranches } from './git'
import { log } from '../util/log'

export interface FloorDeps {
  workspaces: WorkspaceManager
  /** Encerra os processos dos terminais indicados (antes de remover o worktree). */
  stopTerminals(ids: string[]): void
  applyMainOps(ws: WorkspaceStore, ops: WorkspaceOp[]): void
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Floors: ambientes isolados via `git worktree` numa branch nova. Os terminais de um floor rodam no
 * worktree; o canvas mostra cada floor como uma aba. Descartar remove o worktree (e a branch do
 * floor); incorporar é só orientado (nenhum merge automático é feito).
 */
export class FloorService {
  constructor(private readonly deps: FloorDeps) {}

  private ws(dir: string): WorkspaceStore {
    const ws = this.deps.workspaces.get(dir)
    if (!ws) throw new Error('workspace não está aberto')
    return ws
  }

  async branches(dir: string): Promise<string[]> {
    return listBranches(this.ws(dir).dir)
  }

  /** Garante que .maestrinho/floors/ não apareça como não rastreado no repositório principal. */
  private ensureIgnored(ws: WorkspaceStore): void {
    const gi = path.join(ws.metaDir, '.gitignore')
    try {
      const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : ''
      if (!/^floors\/\s*$/m.test(cur)) fs.writeFileSync(gi, `${cur}${cur.endsWith('\n') || cur === '' ? '' : '\n'}floors/\n`, 'utf8')
    } catch (err) {
      log.warn('não foi possível atualizar .maestrinho/.gitignore', err instanceof Error ? err : undefined)
    }
  }

  async create(dir: string, name: string, baseBranch?: string): Promise<Floor> {
    const ws = this.ws(dir)
    if (!(await isGitRepo(ws.dir))) throw new Error('floors exigem que a pasta do workspace seja um repositório git')
    const cleanName = name.trim().slice(0, 60)
    if (!cleanName) throw new Error('dê um nome ao floor')
    const base = (baseBranch?.trim() || (await currentBranch(ws.dir))) ?? ''
    if (!base || base === 'HEAD') throw new Error('não foi possível determinar a branch base (repositório sem commits?)')
    if (!(await branchExists(ws.dir, base))) throw new Error(`a branch base "${base}" não existe`)

    const slugBase = branchSlug(cleanName)
    const taken = new Set(ws.doc.floors.map((f) => path.basename(f.worktreePath)))
    let slug = slugBase
    let branch = `floor/${slug}`
    for (let i = 2; taken.has(slug) || (await branchExists(ws.dir, branch)) || fs.existsSync(path.join(ws.metaDir, 'floors', slug)); i++) {
      slug = `${slugBase}-${i}`
      branch = `floor/${slug}`
      if (i > 200) throw new Error('não foi possível escolher um nome livre para o floor')
    }
    const worktreePath = path.join(ws.metaDir, 'floors', slug)
    this.ensureIgnored(ws)
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
    const r = await git(ws.dir, ['worktree', 'add', '-b', branch, worktreePath, base], 180_000)
    if (r.code !== 0) throw new Error(`git worktree add falhou: ${r.stderr.trim().slice(0, 300)}`)

    const floor: Floor = {
      id: newId('f'),
      name: cleanName,
      branch,
      baseBranch: base,
      worktreePath,
      createdAt: new Date().toISOString()
    }
    this.deps.applyMainOps(ws, [{ op: 'setFloors', floors: [...ws.doc.floors, floor] }])
    log.info('floor criado', { floor: floor.id })
    return floor
  }

  async status(dir: string, id: string): Promise<FloorStatus> {
    const ws = this.ws(dir)
    const floor = ws.doc.floors.find((f) => f.id === id)
    if (!floor) throw new Error('floor não encontrado')
    const base = floor.baseBranch || (await currentBranch(ws.dir))
    let ahead = 0
    let behind = 0
    const counts = await git(ws.dir, ['rev-list', '--left-right', '--count', `${base}...${floor.branch}`], 30_000)
    if (counts.code === 0) {
      const [b, a] = counts.stdout.trim().split(/\s+/).map((n) => Number(n))
      behind = Number.isFinite(b) ? b! : 0
      ahead = Number.isFinite(a) ? a! : 0
    }
    let dirty = false
    if (fs.existsSync(floor.worktreePath)) {
      const st = await git(floor.worktreePath, ['status', '--porcelain'], 30_000)
      dirty = st.code === 0 && st.stdout.trim() !== ''
    }
    let mergeHint: string
    if (dirty) mergeHint = 'Há alterações sem commit no floor. Faça commit nele antes de incorporar.'
    else if (ahead === 0) mergeHint = 'Nada a incorporar: o floor não tem commits novos em relação à base.'
    else
      mergeHint = `Para incorporar, no diretório principal rode: git switch ${base} && git merge --no-ff ${floor.branch}` +
        (behind > 0 ? ` (a base avançou ${behind} commit(s); confira conflitos antes).` : '')
    return { branch: floor.branch, baseBranch: base, ahead, behind, dirty, mergeHint }
  }

  /** Descarta o floor: encerra os terminais dele, remove o worktree, a branch e os nós do floor. */
  async discard(dir: string, id: string, force = false): Promise<void> {
    const ws = this.ws(dir)
    const floor = ws.doc.floors.find((f) => f.id === id)
    if (!floor) throw new Error('floor não encontrado')
    if (fs.existsSync(floor.worktreePath) && !force) {
      const st = await git(floor.worktreePath, ['status', '--porcelain'], 30_000)
      if (st.code === 0 && st.stdout.trim() !== '') {
        throw new Error('o floor tem alterações sem commit; confirme o descarte forçado para apagá-las')
      }
    }
    // A branch é apagada com -D: commits que não estão na base se perderiam sem aviso.
    if (!force) {
      const { ahead } = await this.status(dir, id)
      if (ahead > 0) {
        throw new Error(`a branch ${floor.branch} tem ${ahead} commit(s) que não estão na base; confirme o descarte forçado para apagá-los`)
      }
    }
    const floorNodes = ws.doc.nodes.filter((n) => n.floorId === id)
    // No Windows, arquivos abertos impedem a remoção: encerra os processos primeiro.
    this.deps.stopTerminals(floorNodes.filter((n) => n.kind === 'terminal').map((n) => n.id))
    await sleep(400)

    if (fs.existsSync(floor.worktreePath)) {
      let r = await git(ws.dir, ['worktree', 'remove', ...(force ? ['--force'] : []), floor.worktreePath], 120_000)
      for (let attempt = 0; r.code !== 0 && attempt < 3; attempt++) {
        await sleep(800 * (attempt + 1))
        r = await git(ws.dir, ['worktree', 'remove', '--force', floor.worktreePath], 120_000)
      }
      if (r.code !== 0) throw new Error(`não foi possível remover o worktree: ${r.stderr.trim().slice(0, 300)}`)
    }
    await git(ws.dir, ['worktree', 'prune'], 60_000)
    const del = await git(ws.dir, ['branch', '-D', floor.branch], 30_000)
    if (del.code !== 0) log.warn('não foi possível apagar a branch do floor', { code: del.code })

    const ops: WorkspaceOp[] = []
    if (floorNodes.length) ops.push({ op: 'removeNodes', ids: floorNodes.map((n) => n.id) })
    ops.push({ op: 'setFloors', floors: ws.doc.floors.filter((f) => f.id !== id) })
    if (ws.doc.activeFloorId === id) ops.push({ op: 'setActiveFloor', floorId: null })
    this.deps.applyMainOps(ws, ops)
    log.info('floor descartado', { floor: id, force })
  }
}
