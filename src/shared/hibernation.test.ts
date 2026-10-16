import { describe, expect, it } from 'vitest'
import { AgentPresetSchema, TerminalNodeSchema } from './schemas'
import { hibernationBlocker, shouldAutoHibernate, type HibernationMoment } from './hibernation'

const MIN = 60_000

function moment(over: Partial<HibernationMoment> = {}): HibernationMoment {
  return {
    now: 100 * MIN,
    thresholdMs: 30 * MIN,
    lastActiveAt: 60 * MIN,
    activity: 'idle',
    ready: true,
    needsInput: false,
    waitingOn: false,
    focused: false,
    chatOpen: false,
    pendingChoice: false,
    ...over
  }
}

describe('shouldAutoHibernate', () => {
  it('hiberna quem está parado há mais que o limite', () => {
    expect(shouldAutoHibernate(moment())).toBe(true)
    expect(shouldAutoHibernate(moment({ lastActiveAt: 70 * MIN }))).toBe(true)
    expect(shouldAutoHibernate(moment({ lastActiveAt: 71 * MIN }))).toBe(false)
  })

  it('desligado (0) nunca hiberna', () => {
    expect(shouldAutoHibernate(moment({ thresholdMs: 0 }))).toBe(false)
  })

  it('nunca hiberna quem trabalha, inicia, pede algo, espera outro agente ou está em uso por você', () => {
    expect(shouldAutoHibernate(moment({ activity: 'busy' }))).toBe(false)
    expect(shouldAutoHibernate(moment({ ready: false }))).toBe(false)
    expect(shouldAutoHibernate(moment({ needsInput: true }))).toBe(false)
    expect(shouldAutoHibernate(moment({ pendingChoice: true }))).toBe(false)
    expect(shouldAutoHibernate(moment({ waitingOn: true }))).toBe(false)
    expect(shouldAutoHibernate(moment({ focused: true }))).toBe(false)
    expect(shouldAutoHibernate(moment({ chatOpen: true }))).toBe(false)
  })
})

describe('hibernationBlocker', () => {
  const claude = AgentPresetSchema.parse({
    id: 'claude',
    label: 'Claude',
    command: 'claude',
    sessionArgs: ['--session-id', '{sessionId}'],
    resumeArgs: ['--resume', '{sessionId}'],
    sessionStore: 'claude'
  })
  const node = TerminalNodeSchema.parse({
    id: 't1',
    kind: 'terminal',
    name: 'dev',
    presetId: 'claude',
    position: { x: 0, y: 0 },
    size: { w: 600, h: 400 },
    sessionId: '8f6a2c1e-4b7d-4e2a-9c3f-1a2b3c4d5e6f'
  })
  const ok = { resumeSessions: true, sessionExists: true }

  it('agente com conversa retomável pode hibernar', () => {
    expect(hibernationBlocker(node, claude, ok)).toBeNull()
  })

  it('shell, SSH e preset sem retomada não hibernam', () => {
    expect(hibernationBlocker(node, { ...claude, isShell: true }, ok)).toMatch(/shells/)
    expect(hibernationBlocker(node, { ...claude, remoteOrq: true }, ok)).toMatch(/SSH/)
    expect(hibernationBlocker(node, { ...claude, sessionStore: 'none' }, ok)).toMatch(/não retoma/)
    expect(hibernationBlocker(node, { ...claude, resumeArgs: [] }, ok)).toMatch(/não retoma/)
  })

  it('sem retomada ligada, sem id ou sem histórico não hiberna', () => {
    expect(hibernationBlocker(node, claude, { ...ok, resumeSessions: false })).toMatch(/desligada/)
    expect(hibernationBlocker({ ...node, sessionId: undefined }, claude, ok)).toMatch(/histórico/)
    expect(hibernationBlocker(node, claude, { ...ok, sessionExists: false })).toMatch(/não foi encontrado/)
  })
})
