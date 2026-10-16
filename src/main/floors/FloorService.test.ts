import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { WorkspaceOp } from '@shared/ipc'
import { WorkspaceStore, emptyDoc, ensureMetaDir } from '../store/WorkspaceStore'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import { FloorService } from './FloorService'
import { branchSlug, git } from './git'

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}

describe('branchSlug', () => {
  it('gera nomes de branch seguros', () => {
    expect(branchSlug('Experimento Ágil #1')).toBe('experimento-agil-1')
    expect(branchSlug('  --  ')).toBe('floor')
    expect(branchSlug('a/b;rm -rf')).toBe('a-b-rm-rf')
  })
})

describe('FloorService (git real)', () => {
  let root: string
  let ws: WorkspaceStore
  let service: FloorService
  const stopped: string[][] = []

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-floor-'))
    sh(root, 'init', '-q', '-b', 'main')
    sh(root, 'config', 'user.email', 'teste@example.com')
    sh(root, 'config', 'user.name', 'Teste')
    sh(root, 'config', 'commit.gpgsign', 'false')
    fs.writeFileSync(path.join(root, 'README.md'), '# projeto\n')
    sh(root, 'add', '.')
    sh(root, 'commit', '-q', '-m', 'inicial')
    await ensureMetaDir(root)
    ws = new WorkspaceStore(root, emptyDoc(root))
    const manager = { get: (d: string) => (path.resolve(d) === path.resolve(root) ? ws : undefined) } as unknown as WorkspaceManager
    service = new FloorService({
      workspaces: manager,
      stopTerminals: (ids) => stopped.push(ids),
      applyMainOps: (target, ops: WorkspaceOp[]) => target.apply(ops, 'main')
    })
  })

  afterEach(async () => {
    // Grava o workspace.json pendente (debounce de 400 ms): senão ele cai no meio do rmSync (ENOTEMPTY).
    await ws.flush()
    await git(root, ['worktree', 'prune'])
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  it('cria floor em worktree com branch nova, sem tocar na main', async () => {
    const floor = await service.create(root, 'Experimento 1')
    expect(floor.branch).toBe('floor/experimento-1')
    expect(floor.baseBranch).toBe('main')
    expect(fs.existsSync(path.join(floor.worktreePath, 'README.md'))).toBe(true)
    expect(ws.doc.floors.map((f) => f.id)).toEqual([floor.id])
    // O repositório principal continua na main e sem arquivos não rastreados do floor.
    expect(sh(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
    expect(sh(root, 'status', '--porcelain').trim()).toBe('?? .maestrinho/')
    const gi = fs.readFileSync(path.join(root, '.maestrinho', '.gitignore'), 'utf8')
    expect(gi).toMatch(/^floors\/$/m)
  }, 60_000)

  it('nomes repetidos ganham sufixo', async () => {
    const a = await service.create(root, 'Teste')
    const b = await service.create(root, 'Teste')
    expect(a.branch).toBe('floor/teste')
    expect(b.branch).toBe('floor/teste-2')
  }, 60_000)

  it('status reporta commits à frente e alterações pendentes', async () => {
    const floor = await service.create(root, 'Status')
    let st = await service.status(root, floor.id)
    expect(st.ahead).toBe(0)
    expect(st.dirty).toBe(false)
    fs.writeFileSync(path.join(floor.worktreePath, 'novo.txt'), 'x')
    st = await service.status(root, floor.id)
    expect(st.dirty).toBe(true)
    expect(st.mergeHint).toMatch(/commit/)
    sh(floor.worktreePath, 'add', '.')
    sh(floor.worktreePath, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'novo')
    st = await service.status(root, floor.id)
    expect(st.ahead).toBe(1)
    expect(st.dirty).toBe(false)
    expect(st.mergeHint).toContain('git merge --no-ff floor/status')
  }, 60_000)

  // Regressão: a branch era apagada com -D mesmo tendo commits que não estão na base.
  it('descartar recusa floor com commits que não estão na base (sem forçar)', async () => {
    const floor = await service.create(root, 'Com commit')
    fs.writeFileSync(path.join(floor.worktreePath, 'novo.txt'), 'x')
    sh(floor.worktreePath, 'add', '.')
    sh(floor.worktreePath, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'novo')
    await expect(service.discard(root, floor.id)).rejects.toThrow(/1 commit\(s\) que não estão na base/)
    expect(sh(root, 'branch', '--list', floor.branch).trim()).not.toBe('')
    await service.discard(root, floor.id, true)
    expect(sh(root, 'branch', '--list', floor.branch).trim()).toBe('')
  }, 60_000)

  it('descartar remove worktree, branch e nós do floor; main intacta', async () => {
    const floor = await service.create(root, 'Descartável')
    ws.apply(
      [
        {
          op: 'addNodes',
          nodes: [
            {
              id: 't1',
              kind: 'terminal',
              name: 'a',
              presetId: 'shell',
              cwd: '',
              autoStart: true,
              floorId: floor.id,
              position: { x: 0, y: 0 },
              size: { w: 600, h: 420 }
            }
          ]
        },
        { op: 'setActiveFloor', floorId: floor.id }
      ],
      'renderer'
    )
    fs.writeFileSync(path.join(floor.worktreePath, 'sujo.txt'), 'x')
    await expect(service.discard(root, floor.id)).rejects.toThrow(/sem commit/)
    await service.discard(root, floor.id, true)
    expect(stopped.at(-1)).toEqual(['t1'])
    expect(fs.existsSync(floor.worktreePath)).toBe(false)
    expect(sh(root, 'branch', '--list', 'floor/*').trim()).toBe('')
    expect(ws.doc.floors).toEqual([])
    expect(ws.doc.nodes).toEqual([])
    expect(ws.doc.activeFloorId).toBeUndefined()
    expect(sh(root, 'log', '--oneline', 'main').trim().split('\n')).toHaveLength(1)
  }, 60_000)

  it('recusa pasta que não é repositório git', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-plain-'))
    try {
      const plainWs = new WorkspaceStore(plain, emptyDoc(plain))
      const svc = new FloorService({
        workspaces: { get: () => plainWs } as unknown as WorkspaceManager,
        stopTerminals: () => undefined,
        applyMainOps: () => undefined
      })
      await expect(svc.create(plain, 'x')).rejects.toThrow(/repositório git/)
    } finally {
      fs.rmSync(plain, { recursive: true, force: true })
    }
  })
})
