import * as os from 'node:os'
import { describe, expect, it } from 'vitest'
import { AgentPresetSchema, RoleSchema, SettingsSchema, TerminalNodeSchema, type AgentPreset, type Role, type TerminalNodeData } from '@shared/schemas'
import { builtinPresets } from '../store/defaults'
import { TerminalService, type TerminalServiceDeps } from './TerminalService'

function service(opts: {
  presets?: AgentPreset[]
  roles?: Role[]
  node: TerminalNodeData
  nodes?: TerminalNodeData[]
  exact?: boolean
  ptys?: Partial<TerminalServiceDeps['ptys']>
  setSessionId?: TerminalServiceDeps['setSessionId']
}): TerminalService {
  const presets = opts.presets ?? builtinPresets()
  const settings = SettingsSchema.parse({ exactAgentState: opts.exact ?? true, resumeSessions: false })
  const ws = { dir: os.tmpdir(), doc: { name: 'LOJA-ONLINE', nodes: [opts.node, ...(opts.nodes ?? [])], floors: [] } }
  const deps = {
    ptys: (opts.ptys ?? {}) as TerminalServiceDeps['ptys'],
    ...(opts.setSessionId ? { setSessionId: opts.setSessionId } : {}),
    config: {
      settings,
      preset: (id: string) => presets.find((p) => p.id === id),
      presets,
      role: (id: string) => (opts.roles ?? []).find((r) => r.id === id)
    } as unknown as TerminalServiceDeps['config'],
    workspaceOf: () => ws as unknown as ReturnType<TerminalServiceDeps['workspaceOf']>,
    binDir: os.tmpdir(),
    nodeExe: process.execPath,
    cliScript: 'orq.js',
    apiPort: () => 1234,
    instructionsFor: () => 'INSTRUCOES',
    claudeHooksFile: 'C:/dados/run/claude-hooks.json',
    env: { CODEX_HOME: os.tmpdir() }
  } satisfies TerminalServiceDeps
  return new TerminalService(deps)
}

function terminal(presetId: string, extra: Partial<TerminalNodeData> = {}): TerminalNodeData {
  return TerminalNodeSchema.parse({ id: 't1', kind: 'terminal', name: 'dev', presetId, position: { x: 0, y: 0 }, size: { w: 600, h: 400 }, ...extra })
}

describe('TerminalService.buildSpec: modelo, esforço, nome da sessão e estado exato', () => {
  it('Claude: modelo e esforço do terminal, nome "projeto/agente" e hooks', () => {
    const node = terminal('claude', { model: 'opus', effort: 'high' })
    const spec = service({ node }).buildSpec(node, 100, 30)
    const a = spec.args
    expect(a.slice(a.indexOf('--model'), a.indexOf('--model') + 2)).toEqual(['--model', 'opus'])
    expect(a.slice(a.indexOf('--effort'), a.indexOf('--effort') + 2)).toEqual(['--effort', 'high'])
    expect(a.slice(a.indexOf('--name'), a.indexOf('--name') + 2)).toEqual(['--name', 'LOJA-ONLINE/dev'])
    expect(a.slice(a.indexOf('--remote-control-session-name-prefix'), a.indexOf('--remote-control-session-name-prefix') + 2)).toEqual([
      '--remote-control-session-name-prefix',
      'loja-online-dev'
    ])
    expect(a.slice(a.indexOf('--settings'), a.indexOf('--settings') + 2)).toEqual(['--settings', 'C:/dados/run/claude-hooks.json'])
    expect(spec.agentEvents).toBe('claude')
  })

  it('sem escolha no terminal, vale o padrão da função; sem estado exato, nada de hooks', () => {
    const role = RoleSchema.parse({ id: 'dev', name: 'Dev', instructions: '', agentDefaults: { claude: { model: 'sonnet', effort: 'max' } } })
    const node = terminal('claude', { roleId: 'dev' })
    const spec = service({ node, roles: [role], exact: false }).buildSpec(node, 100, 30)
    expect(spec.args).toContain('sonnet')
    expect(spec.args).toContain('max')
    expect(spec.args).not.toContain('--settings')
    expect(spec.agentEvents).toBe('none')
  })

  it('Codex: notificações, modelo e esforço vêm antes da retomada ("resume <id>")', () => {
    const node = terminal('codex', { model: 'gpt-6.1-sol', effort: 'xhigh' })
    const spec = service({ node }).buildSpec(node, 100, 30)
    const a = spec.args
    expect(a).toContain('tui.notification_method=osc9')
    expect(a.slice(a.indexOf('-m'), a.indexOf('-m') + 2)).toEqual(['-m', 'gpt-6.1-sol'])
    expect(a).toContain('model_reasoning_effort=xhigh')
    expect(a).not.toContain('--name')
    expect(spec.agentEvents).toBe('codex')
  })

  it('preset próprio sem os campos novos não ganha argumentos extras', () => {
    const custom = AgentPresetSchema.parse({ id: 'meu', label: 'Meu', command: 'claude', args: [] })
    const node = terminal('meu', { model: 'opus' })
    const spec = service({ node, presets: [...builtinPresets(), custom] }).buildSpec(node, 100, 30)
    expect(spec.args).toEqual([])
  })
})

describe('TerminalService.newTask', () => {
  it('reinicia os agentes rodando numa conversa nova; hibernados só esquecem a conversa; shells ficam', () => {
    const old = '0b6f3c1e-4b7d-4e2a-9c3f-1a2b3c4d5e6f'
    const dev = terminal('claude', { id: 'dev', sessionId: old })
    const qa = terminal('codex', { id: 'qa', sessionId: old })
    const dormindo = terminal('claude', { id: 'dormindo', sessionId: old, hibernated: true })
    const aider = terminal('aider', { id: 'aider' })
    const servidor = terminal('shell', { id: 'servidor' })
    const running = new Set(['dev', 'qa', 'servidor'])
    const restarted: string[] = []
    const sessions: [string, string | undefined][] = []
    const svc = service({
      node: dev,
      nodes: [qa, dormindo, aider, servidor],
      ptys: {
        has: (id: string) => running.has(id),
        info: () => ({ cols: 100, rows: 30 }) as ReturnType<TerminalServiceDeps['ptys']['info']>,
        restart: (id: string) => {
          restarted.push(id)
          return { id, status: 'starting' } as ReturnType<TerminalServiceDeps['ptys']['restart']>
        }
      },
      setSessionId: (id, sessionId) => sessions.push([id, sessionId])
    })

    expect(svc.newTask(['dev', 'qa', 'dormindo', 'aider', 'servidor', 'sumiu'])).toEqual({ restarted: 2, later: 2 })
    expect(restarted).toEqual(['dev', 'qa'])
    const first = (id: string): string | undefined => sessions.find(([s]) => s === id)?.[1]
    // Claude: id novo escolhido por nós; Codex: o atual some (o novo é descoberto depois).
    expect(first('dev')).toMatch(/^[0-9a-f-]{36}$/)
    expect(first('dev')).not.toBe(old)
    expect(sessions.some(([s]) => s === 'qa')).toBe(true)
    expect(first('qa')).toBeUndefined()
    expect(first('dormindo')).toMatch(/^[0-9a-f-]{36}$/)
    expect(first('dormindo')).not.toBe(old)
    // Sem sessão (Aider) e shells: nada a esquecer.
    expect(sessions.some(([s]) => s === 'aider' || s === 'servidor')).toBe(false)
  })
})
