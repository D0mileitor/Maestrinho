import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../floors/git'
import { ChangesService, type ChangesDeps } from './ChangesService'

let dir: string
let trashed: string[]
let svc: ChangesService

async function run(args: string[]): Promise<string> {
  const r = await git(dir, args)
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudancas-'))
  trashed = []
  await run(['init', '-q', '-b', 'main'])
  await run(['config', 'user.name', 'Teste'])
  await run(['config', 'user.email', 'teste@exemplo.local'])
  await run(['config', 'core.autocrlf', 'false'])
  fs.writeFileSync(path.join(dir, 'a.txt'), 'um\ndois\ntrês\n')
  fs.writeFileSync(path.join(dir, 'c.txt'), 'apagar\n')
  await run(['add', '-A'])
  await run(['commit', '-q', '-m', 'inicial'])
  const ws = { dir, doc: { name: 'Projeto', floors: [], nodes: [] } }
  const deps: ChangesDeps = {
    workspaces: { get: () => ws } as unknown as ChangesDeps['workspaces'],
    terminals: {} as ChangesDeps['terminals'],
    trash: async (f) => {
      trashed.push(path.basename(f))
      fs.rmSync(f, { force: true })
    }
  }
  svc = new ChangesService(deps)
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('ChangesService (repositório git de verdade)', () => {
  it('lista o repositório, as mudanças com contagens e o diff', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'um\nDOIS\ntrês\nquatro\n')
    fs.writeFileSync(path.join(dir, 'novo arquivo.md'), '# título\ntexto\n')
    fs.rmSync(path.join(dir, 'c.txt'))
    const [repo] = await svc.repos(dir)
    expect(repo).toMatchObject({ label: 'Projeto', branch: 'main' })
    const st = await svc.status(dir, repo!.root)
    const byPath = Object.fromEntries(st.files.map((f) => [f.path, f]))
    expect(byPath['a.txt']).toMatchObject({ kind: 'M', added: 2, deleted: 1 })
    expect(byPath['novo arquivo.md']).toMatchObject({ kind: '?', added: 2 })
    expect(byPath['c.txt']).toMatchObject({ kind: 'D', deleted: 1 })
    const d = await svc.diff(dir, repo!.root, 'a.txt')
    expect(d.hunks[0]!.lines.filter((l) => l.type !== 'ctx').map((l) => `${l.type}:${l.text}`)).toEqual(['del:dois', 'add:DOIS', 'add:quatro'])
    const novo = await svc.diff(dir, repo!.root, 'novo arquivo.md')
    expect(novo.hunks[0]!.lines).toHaveLength(2)
  })

  it('commit só dos arquivos escolhidos', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'mudou\n')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'novo\n')
    const [repo] = await svc.repos(dir)
    const { hash } = await svc.commit(dir, repo!.root, ['b.txt'], 'Adiciona b')
    expect(hash).toMatch(/^[0-9a-f]{7,}$/)
    const st = await svc.status(dir, repo!.root)
    expect(st.files.map((f) => f.path)).toEqual(['a.txt'])
    expect((await run(['log', '-1', '--format=%s'])).trim()).toBe('Adiciona b')
  })

  it('descartar: novo vai para a lixeira; modificado volta ao commit e a cópia do atual vai para a lixeira', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'estragado\n')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'novo\n')
    const [repo] = await svc.repos(dir)
    await svc.discard(dir, repo!.root, ['a.txt', 'b.txt'])
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('um\ndois\ntrês\n')
    expect(fs.existsSync(path.join(dir, 'b.txt'))).toBe(false)
    expect(trashed).toContain('b.txt')
    expect(trashed.some((n) => /^a \(descartado .+\)\.txt$/.test(n))).toBe(true)
    expect((await svc.status(dir, repo!.root)).files).toEqual([])
  })

  it('recusa caminho que não está entre as mudanças e repositório de fora do workspace', async () => {
    const [repo] = await svc.repos(dir)
    await expect(svc.diff(dir, repo!.root, '../fora.txt')).rejects.toThrow(/não tem mais mudanças/)
    await expect(svc.discard(dir, repo!.root, ['a.txt'])).rejects.toThrow(/não tem mais mudanças/)
    await expect(svc.status(dir, os.tmpdir())).rejects.toThrow(/não pertence/)
  })
})
