import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  CHECKPOINT_REF_PREFIX,
  SAFETY_TERMINAL,
  checkpointPlan,
  checkpointRef,
  checkpointSubject,
  checkpointsToPrune,
  parseCheckpoints,
  type Checkpoint,
  type CheckpointPlan
} from '@shared/checkpoints'
import { git } from '../floors/git'
import { log } from '../util/log'

/** Quantos checkpoints cada repositório guarda, e por quanto tempo. */
const KEEP = 40
const MAX_AGE_MS = 7 * 24 * 60 * 60_000
/** Raiz do repositório de cada pasta: lembrada por um tempo (um turno começa a todo momento). */
const ROOT_TTL_MS = 60_000
/** Restauração em lotes (linha de comando do Windows tem limite). */
const BATCH = 100

/** Identidade dos commits de checkpoint: não usa (nem exige) a identidade git do usuário. */
const IDENT = {
  GIT_AUTHOR_NAME: 'Maestrinho',
  GIT_AUTHOR_EMAIL: 'maestrinho@localhost',
  GIT_COMMITTER_NAME: 'Maestrinho',
  GIT_COMMITTER_EMAIL: 'maestrinho@localhost'
}

let tmpSeq = 0

/**
 * Guardar e restaurar os bytes como estão: sem isto, com core.autocrlf=true (padrão no Windows) um
 * arquivo LF voltaria como CRLF. Quem declara `eol`/`text` no .gitattributes continua valendo.
 */
const RAW = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false']

/**
 * Checkpoints do repositório antes de cada turno dos agentes (ver @shared/checkpoints). Tudo passa
 * por um índice temporário: o índice, as branches e o histórico do usuário ficam intocados. As
 * operações de um mesmo repositório rodam em fila.
 */
export class CheckpointService {
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly roots = new Map<string, { root: string | null; at: number }>()

  constructor(private readonly deps: { trash(file: string): Promise<void> }) {}

  /** Raiz do repositório que contém `cwd` (null = não é repositório git). */
  async rootOf(cwd: string): Promise<string | null> {
    const cached = this.roots.get(cwd)
    if (cached && Date.now() - cached.at < ROOT_TTL_MS) return cached.root
    const r = fs.existsSync(cwd) ? await git(cwd, ['rev-parse', '--show-toplevel'], 15_000) : null
    const root = r?.code === 0 ? r.stdout.trim() : null
    this.roots.set(cwd, { root, at: Date.now() })
    return root
  }

  private inQueue<T>(root: string, job: () => Promise<T>): Promise<T> {
    const key = process.platform === 'win32' ? root.toLowerCase() : root
    const prev = this.queues.get(key) ?? Promise.resolve()
    const next = prev.then(job, job)
    this.queues.set(
      key,
      next.catch(() => undefined)
    )
    return next
  }

  /** Árvore git do estado atual da pasta (rastreados + novos não ignorados), num índice temporário. */
  private async currentTree(root: string): Promise<string | null> {
    const idx = await git(root, ['rev-parse', '--git-path', 'index'], 15_000)
    if (idx.code !== 0) return null
    const index = path.resolve(root, idx.stdout.trim())
    const tmp = path.join(os.tmpdir(), `maestrinho-checkpoint-${process.pid}-${++tmpSeq}.idx`)
    try {
      // Partir de uma cópia do índice real deixa o `add` rápido: só o que mudou é relido.
      if (fs.existsSync(index)) await fsp.copyFile(index, tmp)
      const env = { GIT_INDEX_FILE: tmp }
      const add = await git(root, [...RAW, 'add', '-A'], 120_000, env)
      if (add.code !== 0) return null
      const tree = await git(root, ['write-tree'], 60_000, env)
      return tree.code === 0 ? tree.stdout.trim() : null
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => undefined)
      await fsp.rm(`${tmp}.lock`, { force: true }).catch(() => undefined)
    }
  }

  private async listIn(root: string): Promise<Checkpoint[]> {
    const r = await git(root, ['for-each-ref', '--format=%(refname)%00%(subject)', CHECKPOINT_REF_PREFIX], 15_000)
    return r.code === 0 ? parseCheckpoints(r.stdout) : []
  }

  private async treeOf(ref: string, root: string): Promise<string | null> {
    const r = await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{tree}`], 15_000)
    return r.code === 0 ? r.stdout.trim() : null
  }

  /** Grava um checkpoint; null se nada mudou desde o último do mesmo terminal (ou se o git falhou). */
  private async snapshot(root: string, terminalId: string, name: string, tree?: string | null): Promise<Checkpoint | null> {
    tree ??= await this.currentTree(root)
    if (!tree) return null
    const existing = await this.listIn(root)
    const last = existing.find((c) => c.terminalId === terminalId)
    if (last && (await this.treeOf(last.id, root)) === tree) return null
    const head = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], 15_000)
    const parents = head.code === 0 ? ['-p', head.stdout.trim()] : []
    const safety = terminalId === SAFETY_TERMINAL
    const message = `${checkpointSubject(name, safety)}\n\nMaestrinho-Terminal: ${terminalId}`
    const commit = await git(root, ['commit-tree', tree, ...parents, '-m', message], 60_000, IDENT)
    if (commit.code !== 0) return null
    const at = Date.now()
    const ref = checkpointRef(at, terminalId)
    const upd = await git(root, ['update-ref', ref, commit.stdout.trim()], 15_000)
    if (upd.code !== 0) return null
    for (const old of checkpointsToPrune([{ id: ref, at, terminalId, name, safety }, ...existing], KEEP, MAX_AGE_MS, at)) {
      await git(root, ['update-ref', '-d', old], 15_000)
    }
    return { id: ref, at, terminalId, name, safety }
  }

  /** Início do turno de um agente: checkpoint da pasta dele (silencioso; falhar não atrapalha o agente). */
  async onTurnStart(terminalId: string, name: string, cwd: string): Promise<void> {
    try {
      const root = await this.rootOf(cwd)
      if (!root) return
      await this.inQueue(root, () => this.snapshot(root, terminalId, name))
    } catch (err) {
      log.warn('checkpoint: falhou', err instanceof Error ? err : undefined)
    }
  }

  async list(root: string): Promise<Checkpoint[]> {
    return this.listIn(root)
  }

  private async plan(root: string, ref: string, now: string): Promise<CheckpointPlan> {
    const target = await this.treeOf(ref, root)
    if (!target) throw new Error('checkpoint não encontrado (pode ter sido apagado)')
    const diff = await git(root, ['diff', '--name-status', '-z', '--no-renames', target, now], 60_000)
    if (diff.code !== 0) throw new Error('não foi possível comparar com o checkpoint')
    return checkpointPlan(diff.stdout)
  }

  /** O que voltar ao checkpoint faria (sem mudar nada). */
  preview(root: string, ref: string): Promise<CheckpointPlan> {
    return this.inQueue(root, async () => {
      const now = await this.currentTree(root)
      if (!now) throw new Error('não foi possível ler o estado atual do repositório')
      return this.plan(root, ref, now)
    })
  }

  /**
   * Volta os arquivos ao checkpoint. Antes, grava um checkpoint de segurança do estado atual (dá para
   * desfazer a restauração); arquivos criados depois do checkpoint vão para a lixeira.
   */
  restore(root: string, ref: string): Promise<{ restored: number; removed: number }> {
    if (!ref.startsWith(CHECKPOINT_REF_PREFIX)) return Promise.reject(new Error('checkpoint inválido'))
    return this.inQueue(root, async () => {
      const now = await this.currentTree(root)
      if (!now) throw new Error('não foi possível ler o estado atual do repositório')
      const plan = await this.plan(root, ref, now)
      if (plan.restore.length + plan.remove.length > 0) await this.snapshot(root, SAFETY_TERMINAL, '', now)
      for (const file of plan.remove) {
        const abs = path.join(root, ...file.split('/'))
        if (fs.existsSync(abs)) await this.deps.trash(abs)
      }
      for (let i = 0; i < plan.restore.length; i += BATCH) {
        const r = await git(root, [...RAW, '--literal-pathspecs', 'restore', `--source=${ref}`, '--worktree', '--', ...plan.restore.slice(i, i + BATCH)], 120_000)
        if (r.code !== 0) throw new Error(`git restore falhou: ${r.stderr.split('\n')[0] ?? ''}`)
      }
      log.info('checkpoint restaurado', { restored: plan.restore.length, removed: plan.remove.length })
      return { restored: plan.restore.length, removed: plan.remove.length }
    })
  }
}
