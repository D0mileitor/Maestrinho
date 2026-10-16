import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IdleTransition } from '@shared/idle'
import { BriefingQueue, looksLikeConfirmationPrompt, type BriefingDeps, type InjectOptions } from './briefing'

vi.mock('../util/log', () => ({
  log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined }
}))

const OPTS: InjectOptions = { inputMode: 'bracketed', submitDelayMs: 300, isShell: false }
const idle = (firstIdle = false): IdleTransition => ({ state: 'idle', at: Date.now(), firstIdle })
const busy: IdleTransition = { state: 'busy', at: 0 }

function fakeDeps(screen: string) {
  const deps = {
    screenText: screen,
    running: true,
    inject: vi.fn((_id: string, _text: string, _opts: InjectOptions) => Promise.resolve()),
    isRunning: vi.fn((): boolean => deps.running),
    screen: vi.fn((): string => deps.screenText)
  }
  return deps
}

function setup(screen = ''): { q: BriefingQueue; deps: ReturnType<typeof fakeDeps> } {
  const deps = fakeDeps(screen)
  const typed: BriefingDeps = deps
  return { q: new BriefingQueue(typed, { readyMs: 60_000, promptMs: 600_000 }), deps }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('BriefingQueue', () => {
  it('entrega uma única vez, na primeira ociosidade', () => {
    const { q, deps } = setup()
    q.queue('t1', 'briefing', OPTS)
    q.handleActivity('t1', busy)
    q.handleActivity('t1', idle(false))
    expect(deps.inject).not.toHaveBeenCalled()
    q.handleActivity('t1', idle(true))
    expect(deps.inject).toHaveBeenCalledWith('t1', 'briefing', OPTS)
    q.handleActivity('t1', idle(true))
    expect(deps.inject).toHaveBeenCalledTimes(1)
    expect(q.has('t1')).toBe(false)
  })

  it('desiste se o agente não ficar pronto a tempo', () => {
    const { q, deps } = setup()
    q.queue('t1', 'briefing', OPTS)
    vi.advanceTimersByTime(60_001)
    expect(q.has('t1')).toBe(false)
    q.handleActivity('t1', idle(true))
    expect(deps.inject).not.toHaveBeenCalled()
  })

  it('cancel impede a entrega', () => {
    const { q, deps } = setup()
    q.queue('t1', 'briefing', OPTS)
    q.cancel('t1')
    q.handleActivity('t1', idle(true))
    expect(deps.inject).not.toHaveBeenCalled()
  })

  it('não entrega para processo que já saiu', () => {
    const { q, deps } = setup()
    deps.running = false
    q.queue('t1', 'briefing', OPTS)
    q.handleActivity('t1', idle(true))
    expect(deps.inject).not.toHaveBeenCalled()
    expect(q.has('t1')).toBe(false)
  })

  it('adia enquanto a tela mostra um diálogo de confirmação e entrega depois', () => {
    const { q, deps } = setup('Do you trust the files in this folder?\n❯ 1. Yes, proceed\n  2. No, exit')
    q.queue('t1', 'briefing', OPTS)
    q.handleActivity('t1', idle(true))
    expect(deps.inject).not.toHaveBeenCalled()
    // Passa do prazo normal: continua esperando o usuário responder.
    vi.advanceTimersByTime(120_000)
    expect(q.has('t1')).toBe(true)
    deps.screenText = '> '
    q.handleActivity('t1', idle(false))
    expect(deps.inject).toHaveBeenCalledTimes(1)
  })

  it('o adiamento também tem limite', () => {
    const { q } = setup('[y/n]')
    q.queue('t1', 'briefing', OPTS)
    q.handleActivity('t1', idle(true))
    vi.advanceTimersByTime(600_001)
    expect(q.has('t1')).toBe(false)
  })

  it('novo queue substitui o anterior', () => {
    const { q, deps } = setup()
    q.queue('t1', 'velho', OPTS)
    q.queue('t1', 'novo', OPTS)
    q.handleActivity('t1', idle(true))
    expect(deps.inject).toHaveBeenCalledWith('t1', 'novo', OPTS)
    expect(deps.inject).toHaveBeenCalledTimes(1)
  })

  it('falha na injeção não lança', async () => {
    const { q, deps } = setup()
    deps.inject.mockImplementationOnce(() => Promise.reject(new Error('o processo do terminal não está em execução')))
    q.queue('t1', 'briefing', OPTS)
    expect(() => q.handleActivity('t1', idle(true))).not.toThrow()
    await vi.runAllTimersAsync()
  })
})

describe('looksLikeConfirmationPrompt', () => {
  it.each([
    'Do you trust the files in this folder?\n\n❯ 1. Yes, proceed\n  2. No, exit',
    'Quick safety check: Is this a project you created or one you trust?\n❯ 1. Yes, I trust this folder',
    '› 1. Yes, allow Codex to work in this folder without asking for approval\n  2. Require approval',
    'Continuar? [y/N]',
    'Deseja continuar? (s/n)',
    'Você confia nesta pasta?'
  ])('reconhece: %s', (screen) => {
    expect(looksLikeConfirmationPrompt(screen)).toBe(true)
  })

  it.each([
    '',
    '> ',
    '╭───────────╮\n│ > Try "refactor <filepath>" │\n╰───────────╯\n  ? for shortcuts',
    'PS C:\\projeto> ',
    '1. primeiro item da lista\n2. segundo item'
  ])('não confunde com a tela normal: %s', (screen) => {
    expect(looksLikeConfirmationPrompt(screen)).toBe(false)
  })
})
