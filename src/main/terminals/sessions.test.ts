import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { claudeSessionExists, codexSessionFile, encodeClaudeProjectDir } from './sessions'

describe('sessões do Claude Code', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  it('codifica o cwd como o Claude Code', () => {
    expect(encodeClaudeProjectDir('C:\\Users\\ana.souza\\Desktop\\Projeto')).toBe('C--Users-ana-souza-Desktop-Projeto')
    expect(encodeClaudeProjectDir('/home/ana/meu proj')).toBe('-home-ana-meu-proj')
  })

  it('encontra a sessão em CLAUDE_CONFIG_DIR e recusa ids inválidos', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-'))
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'))
    dirs.push(home, cwd)
    const id = '3f1c2b4a-1111-4222-8333-944455556666'
    const projectDir = path.join(home, 'projects', encodeClaudeProjectDir(path.resolve(cwd)))
    fs.mkdirSync(projectDir, { recursive: true })
    const env = { CLAUDE_CONFIG_DIR: home }
    expect(claudeSessionExists(cwd, id, env)).toBe(false)
    fs.writeFileSync(path.join(projectDir, `${id}.jsonl`), '{}\n')
    expect(claudeSessionExists(cwd, id, env)).toBe(true)
    expect(claudeSessionExists(cwd, '../../etc/passwd', env)).toBe(false)
  })
})

describe('sessões do Codex', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  it('acha o histórico pelo id (em qualquer dia) e recusa ids inválidos', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))
    dirs.push(home)
    const env = { CODEX_HOME: home }
    const id = '01a117fa-ae09-7040-aa0d-a3731e26c51e'
    expect(codexSessionFile(id, env)).toBeNull()
    const old = path.join(home, 'sessions', '2026', '09', '30')
    const recent = path.join(home, 'sessions', '2026', '10', '07')
    fs.mkdirSync(old, { recursive: true })
    fs.mkdirSync(recent, { recursive: true })
    fs.writeFileSync(path.join(recent, 'rollout-2026-10-07T08-06-11-01a11641-c4a4-7ab2-9719-b601adb0badb.jsonl'), '{}\n')
    const file = path.join(old, `rollout-2026-09-30T16-07-47-${id}.jsonl`)
    fs.writeFileSync(file, '{}\n')
    expect(codexSessionFile(id, env)).toBe(file)
    expect(codexSessionFile('../../segredo', env)).toBeNull()
  })
})
