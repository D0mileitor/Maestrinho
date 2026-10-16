import { describe, expect, it } from 'vitest'
import { planNewTask, type NewTaskRuntime, type NewTaskTerminal } from './newTask'

const term = (id: string, presetId: string, hibernated?: boolean): NewTaskTerminal => ({ id, name: id, presetId, ...(hibernated ? { hibernated } : {}) })
const ids = (list: NewTaskTerminal[]): string[] => list.map((t) => t.id)

describe('planNewTask', () => {
  const isShell = (presetId: string): boolean => presetId === 'shell' || presetId === 'ssh'

  it('agentes rodando recomeçam; hibernados e parados só esquecem a conversa; shells ficam de fora', () => {
    const runtime: Record<string, NewTaskRuntime> = {
      dev: { status: 'running', activity: 'idle' },
      qa: { status: 'running', activity: 'busy' },
      saiu: { status: 'exited' },
      servidor: { status: 'running', activity: 'busy' },
      remoto: { status: 'running' }
    }
    const plan = planNewTask(
      [term('dev', 'claude'), term('qa', 'codex'), term('dormindo', 'claude', true), term('saiu', 'gemini'), term('servidor', 'shell'), term('remoto', 'ssh'), term('nunca', 'aider')],
      isShell,
      (id) => runtime[id]
    )
    expect(ids(plan.restart)).toEqual(['dev', 'qa', 'saiu'])
    expect(ids(plan.later)).toEqual(['dormindo', 'nunca'])
    expect(ids(plan.shells)).toEqual(['servidor', 'remoto'])
    expect(ids(plan.busy)).toEqual(['qa'])
  })

  it('hibernado com runtime antigo ainda conta como "depois"', () => {
    const plan = planNewTask([term('dev', 'claude', true)], isShell, () => ({ status: 'exited' }))
    expect(ids(plan.restart)).toEqual([])
    expect(ids(plan.later)).toEqual(['dev'])
  })

  it('andar vazio: nada a fazer', () => {
    expect(planNewTask([], isShell, () => undefined)).toEqual({ restart: [], later: [], shells: [], busy: [] })
  })
})
