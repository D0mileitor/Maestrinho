import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SAFETY_TERMINAL } from '@shared/checkpoints'
import { CheckpointService } from './CheckpointService'

function repo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-ck-')))
  const run = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 'e2e@example.com')
  run('config', 'user.name', 'E2E')
  run('config', 'commit.gpgsign', 'false')
  run('config', 'core.autocrlf', 'false')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'original\n')
  fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n')
  run('add', '.')
  run('commit', '-q', '-m', 'inicial')
  return dir
}

const read = (dir: string, f: string): string | null => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null)
const gitOut = (dir: string, ...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

describe('checkpoints (git real)', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  it('grava antes do turno sem mexer no índice; volta ao checkpoint e permite desfazer a volta', async () => {
    const dir = repo()
    dirs.push(dir)
    const trashed: string[] = []
    const svc = new CheckpointService({
      trash: async (f) => {
        trashed.push(path.basename(f))
        fs.rmSync(f, { force: true })
      }
    })
    // Estado antes do turno: a.txt editado (não preparado) e b.txt novo.
    fs.writeFileSync(path.join(dir, 'a.txt'), 'antes do agente\n')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n')
    await svc.onTurnStart('t1', 'construtor', dir)
    await svc.onTurnStart('t1', 'construtor', dir) // nada mudou: não repete
    const root = (await svc.rootOf(dir))!
    const [ck, ...rest] = await svc.list(root)
    expect(rest).toHaveLength(0)
    expect(ck).toMatchObject({ terminalId: 't1', name: 'construtor', safety: false })
    // O índice do usuário continua igual (nada preparado) e as branches também.
    expect(gitOut(dir, 'diff', '--cached', '--name-only')).toBe('')
    expect(gitOut(dir, 'status', '--porcelain')).toContain('?? b.txt')
    expect(gitOut(dir, 'branch', '--list').trim()).toBe('* main')

    // O "agente" mexe: edita a.txt, apaga b.txt, cria c.txt, gera dist/ (ignorado) e mexe em .maestrinho/.
    fs.writeFileSync(path.join(dir, 'a.txt'), 'depois do agente\n')
    fs.rmSync(path.join(dir, 'b.txt'))
    fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n')
    fs.mkdirSync(path.join(dir, 'dist'))
    fs.writeFileSync(path.join(dir, 'dist', 'x.js'), 'x')
    fs.mkdirSync(path.join(dir, '.maestrinho'))
    fs.writeFileSync(path.join(dir, '.maestrinho', 'workspace.json'), '{}')

    expect(await svc.preview(root, ck!.id)).toEqual({ restore: ['a.txt', 'b.txt'], remove: ['c.txt'] })
    expect(await svc.restore(root, ck!.id)).toEqual({ restored: 2, removed: 1 })
    expect(read(dir, 'a.txt')).toBe('antes do agente\n')
    expect(read(dir, 'b.txt')).toBe('b\n')
    expect(read(dir, 'c.txt')).toBeNull()
    expect(trashed).toEqual(['c.txt'])
    expect(read(dir, 'dist/x.js')).toBe('x')
    expect(read(dir, '.maestrinho/workspace.json')).toBe('{}')

    // A volta pode ser desfeita pelo checkpoint de segurança.
    const safety = (await svc.list(root)).find((c) => c.terminalId === SAFETY_TERMINAL)!
    expect(safety.safety).toBe(true)
    await svc.restore(root, safety.id)
    expect(read(dir, 'a.txt')).toBe('depois do agente\n')
    expect(read(dir, 'c.txt')).toBe('c\n')
    expect(read(dir, 'b.txt')).toBeNull()
  })

  it('volta os bytes exatos mesmo com core.autocrlf=true (LF e CRLF no mesmo repositório)', async () => {
    const dir = repo()
    dirs.push(dir)
    execFileSync('git', ['config', 'core.autocrlf', 'true'], { cwd: dir })
    const svc = new CheckpointService({ trash: async () => undefined })
    fs.writeFileSync(path.join(dir, 'lf.txt'), 'um\ndois\n')
    fs.writeFileSync(path.join(dir, 'crlf.txt'), 'um\r\ndois\r\n')
    await svc.onTurnStart('t1', 'construtor', dir)
    fs.writeFileSync(path.join(dir, 'lf.txt'), 'mudou\n')
    fs.writeFileSync(path.join(dir, 'crlf.txt'), 'mudou\r\n')
    const root = (await svc.rootOf(dir))!
    const ck = (await svc.list(root))[0]!
    await svc.restore(root, ck.id)
    expect(fs.readFileSync(path.join(dir, 'lf.txt'), 'utf8')).toBe('um\ndois\n')
    expect(fs.readFileSync(path.join(dir, 'crlf.txt'), 'utf8')).toBe('um\r\ndois\r\n')
  })

  it('pasta fora de um repositório git: nada acontece', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-ck-nogit-'))
    dirs.push(dir)
    const svc = new CheckpointService({ trash: async () => undefined })
    await svc.onTurnStart('t1', 'construtor', dir)
    expect(await svc.rootOf(dir)).toBeNull()
  })

  it('referência inválida é recusada', async () => {
    const dir = repo()
    dirs.push(dir)
    const svc = new CheckpointService({ trash: async () => undefined })
    await expect(svc.restore(dir, 'refs/heads/main')).rejects.toThrow('checkpoint inválido')
  })
})
