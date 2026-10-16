import { describe, expect, it } from 'vitest'
import { AgentPresetSchema, RoleSchema, TerminalNodeSchema } from './schemas'
import { TEAM_KIND, TeamFileSchema, adoptPreset, presetCommandLine, samePreset, teamPreview } from './team'

const claude = AgentPresetSchema.parse({ id: 'claude', label: 'Claude Code', command: 'claude', args: ['--append-system-prompt', '{instructions}'] })
const custom = AgentPresetSchema.parse({ id: 'meu-agente', label: 'Meu agente', command: 'powershell.exe', args: ['-File', 'C:\\x\\rodar.ps1'] })

function team(): ReturnType<typeof TeamFileSchema.parse> {
  const node = (name: string, presetId: string, roleId?: string): unknown =>
    TerminalNodeSchema.parse({ id: `t-${name}`, kind: 'terminal', name, presetId, roleId, position: { x: 0, y: 0 }, size: { w: 600, h: 400 } })
  return TeamFileSchema.parse({
    kind: TEAM_KIND,
    version: 1,
    name: 'Time do chamado',
    createdAt: '2026-10-07T00:00:00Z',
    nodes: [node('dev', 'claude', 'r-dev'), node('robo', 'meu-agente')],
    edges: [],
    roles: [RoleSchema.parse({ id: 'r-dev', name: 'Dev', instructions: 'x' })],
    notes: { 'chamado-atual.md': '# novo', 'spec.md': 'igual' },
    presets: [claude, custom],
    boardColumns: [{ id: 'a', name: 'A fazer', color: '' }]
  })
}

describe('teamPreview', () => {
  it('mostra o que é novo, igual ou diferente, sem mudar nada', () => {
    const editedClaude = { ...claude, args: ['--outro'] }
    const p = teamPreview(
      team(),
      { presets: [editedClaude], roles: [RoleSchema.parse({ id: 'outro', name: 'dev', instructions: '' })], notes: new Map([['spec.md', 'igual'], ['chamado-atual.md', 'meu']]) },
      'tok'
    )
    expect(p.terminals).toEqual([
      { name: 'dev', role: 'Dev', preset: 'claude', presetLabel: 'Claude Code', presetStatus: 'diferente' },
      { name: 'robo', role: null, preset: 'meu-agente', presetLabel: 'Meu agente', presetStatus: 'novo' }
    ])
    expect(p.roles).toEqual([{ name: 'Dev', status: 'existente' }])
    expect(p.notes).toEqual([
      { file: 'chamado-atual.md', status: 'copia', chars: 6 },
      { file: 'spec.md', status: 'igual', chars: 5 }
    ])
    expect(p.presets.find((x) => x.id === 'meu-agente')).toMatchObject({ status: 'novo', commandLine: 'powershell.exe -File C:\\x\\rodar.ps1' })
    expect(p.board).toEqual(['A fazer'])
  })

  it('avisa quando o nome do terminal já existe no workspace (o novo ganha sufixo)', () => {
    const p = teamPreview(team(), { presets: [claude, custom], roles: [], notes: new Map(), terminalNames: ['dev'] }, 'tok')
    expect(p.terminals.map((x) => x.renamedTo)).toEqual(['dev-2', undefined])
  })
})

describe('presets do time', () => {
  it('samePreset compara o que executa (não o rótulo)', () => {
    expect(samePreset(claude, { ...claude, label: 'Outro nome' })).toBe(true)
    expect(samePreset(claude, { ...claude, command: 'outro' })).toBe(false)
  })

  it('adoptPreset nunca sobrescreve um preset local com o mesmo id', () => {
    expect(adoptPreset(custom, ['claude'])).toMatchObject({ id: 'meu-agente', builtin: false })
    expect(adoptPreset(claude, ['claude', 'claude-time'])).toMatchObject({ id: 'claude-time-2', label: 'Claude Code (time)' })
  })

  it('presetCommandLine mostra a linha de comando com aspas onde precisa', () => {
    expect(presetCommandLine({ command: 'C:\\Program Files\\x.exe', args: ['-a', 'b c'] })).toBe('"C:\\Program Files\\x.exe" -a "b c"')
  })
})
