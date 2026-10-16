import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLI_NAME } from '@shared/constants'
import { ClaudeSkillManager, SKILL_MARKER, composeSkillFile, skillFilePath, skillName } from './claudeSkill'

vi.mock('../util/log', () => ({
  log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined }
}))

const DESC = 'Conversar com outros agentes: use quando receber "[Mensagem de X]" # sem comentário YAML'
const BODY = '# CLI\n- `orq peers`'

let root: string
let registry: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-skill-'))
  registry = path.join(root, 'userData', 'run', 'claude-skills.json')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function project(name = 'proj'): string {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

describe('composeSkillFile', () => {
  it('frontmatter válido (name/description), marcador e corpo', () => {
    const text = composeSkillFile(DESC, BODY)
    const lines = text.split('\n')
    expect(lines[0]).toBe('---')
    expect(lines[1]).toBe(`name: ${skillName()}`)
    expect(lines[2]).toBe(`description: ${JSON.stringify(DESC)}`)
    expect(lines[3]).toBe('---')
    expect(lines[4]).toBe(SKILL_MARKER)
    expect(text).toContain(BODY)
    expect(skillName()).toMatch(/^[a-z0-9-]{1,64}$/)
    expect(skillName()).toBe(CLI_NAME)
  })
})

describe('ClaudeSkillManager', () => {
  it('cria a skill e os diretórios; o último terminal remove tudo o que o app criou', () => {
    const dir = project()
    const m = new ClaudeSkillManager(registry)
    expect(m.acquire(dir, 't1', DESC, BODY)).toBe(true)
    const file = skillFilePath(dir)
    expect(file).toBe(path.join(dir, '.claude', 'skills', CLI_NAME, 'SKILL.md'))
    expect(fs.readFileSync(file, 'utf8')).toBe(composeSkillFile(DESC, BODY))
    m.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(false)
    expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false)
  })

  it('não remove diretórios que já existiam nem arquivos do usuário', () => {
    const dir = project()
    fs.mkdirSync(path.join(dir, '.claude'))
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{}')
    const m = new ClaudeSkillManager(registry)
    m.acquire(dir, 't1', DESC, BODY)
    // O usuário cria outra skill enquanto o terminal roda.
    fs.mkdirSync(path.join(dir, '.claude', 'skills', 'minha'))
    fs.writeFileSync(path.join(dir, '.claude', 'skills', 'minha', 'SKILL.md'), 'minha')
    m.release(dir, 't1')
    expect(fs.existsSync(skillFilePath(dir))).toBe(false)
    expect(fs.existsSync(path.dirname(skillFilePath(dir)))).toBe(false)
    expect(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')).toBe('{}')
    expect(fs.readFileSync(path.join(dir, '.claude', 'skills', 'minha', 'SKILL.md'), 'utf8')).toBe('minha')
  })

  it('nunca sobrescreve uma skill do usuário com o mesmo nome', () => {
    const dir = project()
    const file = skillFilePath(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '---\nname: orq\ndescription: minha\n---\nconteúdo do usuário\n')
    const m = new ClaudeSkillManager(registry)
    expect(m.acquire(dir, 't1', DESC, BODY)).toBe(false)
    expect(fs.readFileSync(file, 'utf8')).toContain('conteúdo do usuário')
    m.release(dir, 't1')
    expect(fs.readFileSync(file, 'utf8')).toContain('conteúdo do usuário')
  })

  it('contagem de referências entre terminais da mesma pasta', () => {
    const dir = project()
    const m = new ClaudeSkillManager(registry)
    m.acquire(dir, 't1', DESC, BODY)
    m.acquire(dir, 't2', DESC, BODY)
    m.release(dir, 't1')
    expect(fs.existsSync(skillFilePath(dir))).toBe(true)
    m.release(dir, 't2')
    expect(fs.existsSync(skillFilePath(dir))).toBe(false)
  })

  it('arquivo do app sem o marcador (o usuário assumiu): é mantido', () => {
    const dir = project()
    const m = new ClaudeSkillManager(registry)
    m.acquire(dir, 't1', DESC, BODY)
    const file = skillFilePath(dir)
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(SKILL_MARKER, ''))
    m.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(true)
  })

  it('atualiza uma skill do app deixada para trás (com o marcador)', () => {
    const dir = project()
    const file = skillFilePath(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, composeSkillFile('antiga', 'corpo antigo'))
    const m = new ClaudeSkillManager(registry)
    expect(m.acquire(dir, 't1', DESC, BODY)).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toBe(composeSkillFile(DESC, BODY))
    m.release(dir, 't1')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('cleanupOrphans após crash remove só o que o app criou', () => {
    const a = project('a')
    const b = project('b')
    fs.mkdirSync(path.join(b, '.claude'))
    const crashed = new ClaudeSkillManager(registry)
    crashed.acquire(a, 't1', DESC, BODY)
    crashed.acquire(b, 't2', DESC, BODY)

    const next = new ClaudeSkillManager(registry)
    next.cleanupOrphans()
    expect(fs.existsSync(path.join(a, '.claude'))).toBe(false)
    expect(fs.existsSync(skillFilePath(b))).toBe(false)
    expect(fs.existsSync(path.join(b, '.claude'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(registry, 'utf8'))).toEqual({ version: 1, entries: {} })
  })
})
