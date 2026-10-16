import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENTS_MD_BEGIN, CLI_NAME } from '@shared/constants'
import type { IdleTransition } from '@shared/idle'
import type { TerminalRuntimeInfo } from '@shared/runtime'
import {
  AgentPresetSchema,
  RoleSchema,
  WorkspaceDocSchema,
  type AgentPreset,
  type TerminalNodeData,
  type WorkspaceDoc
} from '@shared/schemas'
import { createInstructions, peersOf, type InstructionsDeps } from './index'
import { skillFilePath } from './claudeSkill'

vi.mock('../util/log', () => ({
  log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined }
}))

const C = CLI_NAME

function terminal(id: string, name: string, over: Partial<TerminalNodeData> = {}): TerminalNodeData {
  return {
    id,
    kind: 'terminal',
    name,
    presetId: 'claude',
    cwd: '',
    autoStart: true,
    position: { x: 0, y: 0 },
    size: { w: 400, h: 300 },
    ...over
  }
}

function preset(over: Partial<AgentPreset>): AgentPreset {
  return AgentPresetSchema.parse({ id: 'p', label: 'Agente', command: 'agente', ...over })
}

const CLAUDE = preset({
  id: 'claude',
  label: 'Claude Code',
  args: ['--append-system-prompt', '{instructions}'],
  instructionsTarget: 'claude-system-prompt'
})
const CODEX = preset({ id: 'codex', label: 'Codex', instructionsTarget: 'agents-md', submitDelayMs: 250 })
const SKILLED = preset({ id: 'skilled', label: 'Claude (skill)', args: ['--append-system-prompt', '{instructions}'], instructionsTarget: 'claude-skill' })
const FIRST = preset({ id: 'first', label: 'Outro', inputMode: 'raw', instructionsTarget: 'first-message' })
const NONE = preset({ id: 'none', label: 'Nada', args: ['{instructions}'], instructionsTarget: 'none' })
const SHELL = preset({ id: 'shell', label: 'Shell', isShell: true, inputMode: 'raw', instructionsTarget: 'first-message' })

const ROLE = RoleSchema.parse({ id: 'revisor', name: 'Revisor', instructions: 'Você revisa mudanças com cuidado.' })

let root: string
let cwd: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-instr-'))
  cwd = path.join(root, 'proj')
  fs.mkdirSync(cwd)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(root, { recursive: true, force: true })
})

function setup(nodes: TerminalNodeData[]): {
  svc: ReturnType<typeof createInstructions>
  inject: ReturnType<typeof vi.fn>
  doc: WorkspaceDoc
} {
  const doc = WorkspaceDocSchema.parse({
    version: 1,
    id: 'ws1',
    name: 'meu-projeto',
    nodes: [...nodes, { id: 'n1', kind: 'note', file: 'spec.md', position: { x: 0, y: 0 }, size: { w: 300, h: 200 } }],
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'n1', target: 'a' }
    ]
  })
  const inject = vi.fn((_id: string, _text: string, _opts: unknown) => Promise.resolve())
  const info = (id: string): TerminalRuntimeInfo => ({ id, status: 'running', activity: 'idle', attentionSeq: 0, cols: 80, rows: 24 })
  const deps: InstructionsDeps = {
    config: {
      role: (id: string) => (id === ROLE.id ? ROLE : undefined),
      presets: [CLAUDE, CODEX],
      roles: [ROLE]
    },
    registryDir: path.join(root, 'userData', 'run'),
    workspaceOf: () => ({ doc }),
    ptys: { inject, info, readText: () => '> ' },
    platform: 'linux'
  }
  return { svc: createInstructions(deps), inject, doc }
}

const firstIdle: IdleTransition = { state: 'idle', at: 0, firstIdle: true }

describe('peersOf', () => {
  it('conexões valem nos dois sentidos e separam terminais e notas', () => {
    const { doc } = setup([terminal('a', 'construtor'), terminal('b', 'revisor'), terminal('c', 'solto')])
    expect(peersOf(doc, 'a')).toEqual({ terminals: ['revisor'], notes: ['spec.md'] })
    expect(peersOf(doc, 'b')).toEqual({ terminals: ['construtor'], notes: [] })
    expect(peersOf(doc, 'c')).toEqual({ terminals: [], notes: [] })
  })
})

describe('createInstructions', () => {
  it('claude-system-prompt: briefing completo no argumento, com peers e papel; nada por mensagem', () => {
    const a = terminal('a', 'construtor', { roleId: 'revisor', manager: true })
    const { svc, inject } = setup([a, terminal('b', 'revisor')])
    const text = svc.instructionsFor(a, CLAUDE)
    expect(text).toContain('"construtor"')
    expect(text).toContain('terminais: revisor; notas: spec.md')
    expect(text).toContain('Você revisa mudanças com cuidado.')
    expect(text).toContain(`${C} recruit`)
    expect(text).toContain('claude = Claude Code')
    svc.prepare(a, CLAUDE, cwd)
    svc.handleActivity('a', firstIdle)
    expect(inject).not.toHaveBeenCalled()
    expect(fs.readdirSync(cwd)).toEqual([])
  })

  it('claude-system-prompt sem {instructions} nos args: cai para a primeira mensagem', () => {
    const a = terminal('a', 'construtor')
    const { svc, inject } = setup([a])
    const noPlaceholder = { ...CLAUDE, args: [] }
    svc.prepare(a, noPlaceholder, cwd)
    svc.handleActivity('a', firstIdle)
    expect(inject).toHaveBeenCalledTimes(1)
    expect(String(inject.mock.calls[0]?.[1])).toContain(`${C} whoami`)
  })

  it('agents-md: seção genérica no AGENTS.md e removida no cleanup; sem papel não há mensagem', () => {
    const b = terminal('b', 'revisor', { presetId: 'codex' })
    const { svc, inject } = setup([terminal('a', 'construtor'), b])
    svc.prepare(b, CODEX, cwd)
    const file = path.join(cwd, 'AGENTS.md')
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain(AGENTS_MD_BEGIN)
    expect(text).toContain(`${C} whoami`)
    expect(text).not.toContain('"revisor"')
    svc.handleActivity('b', firstIdle)
    expect(inject).not.toHaveBeenCalled()
    svc.cleanup(b, cwd)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('agents-md com papel: briefing na primeira ociosidade, com o modo de entrada do preset', () => {
    const b = terminal('b', 'revisor', { presetId: 'codex', roleId: 'revisor' })
    const { svc, inject } = setup([terminal('a', 'construtor'), b])
    svc.prepare(b, CODEX, cwd)
    svc.handleActivity('b', { state: 'busy', at: 0 })
    expect(inject).not.toHaveBeenCalled()
    svc.handleActivity('b', firstIdle)
    expect(inject).toHaveBeenCalledTimes(1)
    const [id, text, opts] = inject.mock.calls[0]!
    expect(id).toBe('b')
    expect(text).toContain('Seu papel: Revisor.')
    expect(text).toContain('AGENTS.md')
    expect(opts).toEqual({ inputMode: 'bracketed', submitDelayMs: 250, isShell: false })
    svc.cleanup(b, cwd)
  })

  it('conversa retomada: o briefing só vai de novo se o papel/conexões mudaram', async () => {
    const b = terminal('b', 'revisor', { presetId: 'codex', roleId: 'revisor' })
    const { svc, inject, doc } = setup([terminal('a', 'construtor'), b])
    // conversa nova: vai e fica registrado depois de entregue
    svc.prepare(b, CODEX, cwd, false)
    svc.handleActivity('b', firstIdle)
    expect(inject).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    svc.cleanup(b, cwd)
    // retomada com o mesmo papel e conexões: não repete
    svc.prepare(b, CODEX, cwd, true)
    svc.handleActivity('b', firstIdle)
    expect(inject).toHaveBeenCalledTimes(1)
    svc.cleanup(b, cwd)
    // a conexão mudou: na retomada o briefing (atualizado) vai de novo
    doc.edges.push({ id: 'e3', source: 'b', target: 'n1' })
    svc.prepare(b, CODEX, cwd, true)
    svc.handleActivity('b', firstIdle)
    expect(inject).toHaveBeenCalledTimes(2)
    expect(String(inject.mock.calls[1]![1])).toContain('spec.md')
    svc.cleanup(b, cwd)
  })

  it('cleanup cancela o briefing ainda não entregue', () => {
    const b = terminal('b', 'revisor', { presetId: 'codex', manager: true })
    const { svc, inject } = setup([b])
    svc.prepare(b, CODEX, cwd)
    svc.cleanup(b, cwd)
    svc.handleActivity('b', firstIdle)
    expect(inject).not.toHaveBeenCalled()
  })

  it('agents-md impossível (marcadores malformados): referência completa por mensagem', () => {
    const file = path.join(cwd, 'AGENTS.md')
    fs.writeFileSync(file, `# Meu\n${AGENTS_MD_BEGIN}\n`)
    const b = terminal('b', 'revisor', { presetId: 'codex' })
    const { svc, inject } = setup([b])
    svc.prepare(b, CODEX, cwd)
    expect(fs.readFileSync(file, 'utf8')).toBe(`# Meu\n${AGENTS_MD_BEGIN}\n`)
    svc.handleActivity('b', firstIdle)
    expect(String(inject.mock.calls[0]?.[1])).toContain(`${C} note append`)
    svc.cleanup(b, cwd)
    expect(fs.readFileSync(file, 'utf8')).toBe(`# Meu\n${AGENTS_MD_BEGIN}\n`)
  })

  it('claude-skill: escreve a skill, argumento leva papel/identidade, cleanup remove', () => {
    const a = terminal('a', 'construtor', { presetId: 'skilled', roleId: 'revisor' })
    const { svc, inject } = setup([a])
    const text = svc.instructionsFor(a, SKILLED)
    expect(text).toContain('Seu papel: Revisor')
    expect(text).toContain(`skill \`${C}\``)
    expect(text).not.toContain(`${C} note append`)
    svc.prepare(a, SKILLED, cwd)
    const skill = fs.readFileSync(skillFilePath(cwd), 'utf8')
    expect(skill).toContain(`name: ${C}`)
    expect(skill).toContain(`${C} note append`)
    svc.handleActivity('a', firstIdle)
    expect(inject).not.toHaveBeenCalled()
    svc.cleanup(a, cwd)
    expect(fs.existsSync(path.join(cwd, '.claude'))).toBe(false)
  })

  it('first-message: referência completa como primeira mensagem', () => {
    const a = terminal('a', 'construtor', { presetId: 'first' })
    const { svc, inject } = setup([a])
    svc.prepare(a, FIRST, cwd)
    svc.handleActivity('a', firstIdle)
    expect(inject).toHaveBeenCalledTimes(1)
    const [, text, opts] = inject.mock.calls[0]!
    expect(text).toContain(`${C} send <peer>`)
    expect(text).toContain('"construtor"')
    expect(opts).toEqual({ inputMode: 'raw', submitDelayMs: 200, isShell: false })
  })

  it('none: nenhum texto, arquivo ou mensagem', () => {
    const a = terminal('a', 'construtor', { presetId: 'none', roleId: 'revisor', manager: true })
    const { svc, inject } = setup([a])
    expect(svc.instructionsFor(a, NONE)).toBe('')
    svc.prepare(a, NONE, cwd)
    svc.handleActivity('a', firstIdle)
    expect(inject).not.toHaveBeenCalled()
    expect(fs.readdirSync(cwd)).toEqual([])
  })

  it('shell nunca recebe briefing por mensagem (seria executado como comando)', () => {
    const a = terminal('a', 'sh', { presetId: 'shell', roleId: 'revisor' })
    const { svc, inject } = setup([a])
    svc.prepare(a, SHELL, cwd)
    svc.handleActivity('a', firstIdle)
    expect(inject).not.toHaveBeenCalled()
  })

  it('cleanupOrphans remove o que uma sessão anterior deixou', () => {
    const b = terminal('b', 'revisor', { presetId: 'codex' })
    const first = setup([b])
    first.svc.prepare(b, CODEX, cwd)
    expect(fs.existsSync(path.join(cwd, 'AGENTS.md'))).toBe(true)
    // "Crash": um novo serviço lê o mesmo registro.
    const second = setup([b])
    second.svc.cleanupOrphans()
    expect(fs.existsSync(path.join(cwd, 'AGENTS.md'))).toBe(false)
  })
})
