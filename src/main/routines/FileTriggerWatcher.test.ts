import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { FileTriggerWatcher, ignoredByTriggers } from './FileTriggerWatcher'

describe('observador de arquivos dos gatilhos', () => {
  const dirs: string[] = []
  let watcher: FileTriggerWatcher | null = null
  afterEach(() => {
    watcher?.stopAll()
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  it('ignora dependências, git, saída de build e dados do app', () => {
    expect(ignoredByTriggers('node_modules/x/index.js')).toBe(true)
    expect(ignoredByTriggers(path.join('a', '.git', 'HEAD'))).toBe(true)
    expect(ignoredByTriggers('.maestrinho/workspace.json')).toBe(true)
    expect(ignoredByTriggers('dist/app.js')).toBe(true)
    expect(ignoredByTriggers('src/distancia.ts')).toBe(false)
    expect(ignoredByTriggers('src/app.ts')).toBe(false)
  })

  it('só observa enquanto ativo e entrega as mudanças juntas, com caminhos relativos', async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-gatilho-')))
    dirs.push(dir)
    fs.mkdirSync(path.join(dir, 'src'))
    fs.mkdirSync(path.join(dir, 'node_modules'))
    const got: string[][] = []
    watcher = new FileTriggerWatcher((_d, files) => got.push(files.sort()))
    watcher.sync(dir, true)
    await new Promise((r) => setTimeout(r, 800))
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'a')
    fs.writeFileSync(path.join(dir, 'src', 'b.ts'), 'b')
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x')
    await new Promise((r) => setTimeout(r, 3500))
    expect(got).toEqual([['src/a.ts', 'src/b.ts']])
    watcher.sync(dir, false)
    fs.writeFileSync(path.join(dir, 'src', 'c.ts'), 'c')
    await new Promise((r) => setTimeout(r, 2500))
    expect(got).toHaveLength(1)
  })
})
