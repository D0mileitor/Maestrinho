import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

// O módulo real do Electron não existe fora do app; os testes injetam a fábrica de notificações.
vi.mock('electron', () => ({ Notification: { isSupported: () => true } }))

import { createNotifier, type NotificationLike, type NotifyInfo } from './notify'

class FakeNotification implements NotificationLike {
  static shown: FakeNotification[] = []
  private readonly handlers = new Map<string, () => void>()
  constructor(readonly opts: { title: string; body: string }) {}
  on(event: 'click' | 'close' | 'failed', listener: () => void): this {
    this.handlers.set(event, listener)
    return this
  }
  show(): void {
    FakeNotification.shown.push(this)
  }
  emit(event: 'click' | 'close' | 'failed'): void {
    this.handlers.get(event)?.()
  }
}

function fakeWindow(minimized = false): BrowserWindow & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isDestroyed: () => false,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus')
  } as unknown as BrowserWindow & { calls: string[] }
}

const A: NotifyInfo = { terminalId: 't-a', dir: '/ws' }
const B: NotifyInfo = { terminalId: 't-b', dir: '/ws' }

describe('createNotifier', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeNotification.shown = []
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function make(win: BrowserWindow | null = fakeWindow(), supported = true) {
    const onClick = vi.fn()
    const notify = createNotifier({
      getWindow: () => win,
      onClick,
      create: (o) => new FakeNotification(o),
      isSupported: () => supported
    })
    return { notify, onClick }
  }

  it('mostra na hora e o clique foca a janela e avisa quem chamou', () => {
    const win = fakeWindow(true)
    const { notify, onClick } = make(win)
    notify('construtor', 'Build pronto', A)
    expect(FakeNotification.shown).toHaveLength(1)
    expect(FakeNotification.shown[0]!.opts).toEqual({ title: 'construtor', body: 'Build pronto' })
    FakeNotification.shown[0]!.emit('click')
    expect(win.calls).toEqual(['restore', 'show', 'focus'])
    expect(onClick).toHaveBeenCalledWith(A)
    notify.dispose()
  })

  it('agrupa rajadas: no máximo uma por terminal a cada 4 s, com a mais recente', () => {
    const { notify } = make()
    notify('a', '1', A)
    notify('a', '2', A)
    notify('a', '3', A)
    expect(FakeNotification.shown).toHaveLength(1)
    vi.advanceTimersByTime(3999)
    expect(FakeNotification.shown).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeNotification.shown).toHaveLength(2)
    expect(FakeNotification.shown[1]!.opts.body).toBe('3\n(+1 notificação anterior deste terminal)')
    // Nada novo na janela seguinte: a vaga é liberada e a próxima sai na hora.
    vi.advanceTimersByTime(4000)
    expect(FakeNotification.shown).toHaveLength(2)
    notify('a', '4', A)
    expect(FakeNotification.shown).toHaveLength(3)
    notify.dispose()
  })

  it('terminais diferentes não se bloqueiam', () => {
    const { notify } = make()
    notify('a', '1', A)
    notify('b', '1', B)
    expect(FakeNotification.shown).toHaveLength(2)
    notify.dispose()
  })

  it('sem suporte do sistema: não mostra nada e não lança', () => {
    const { notify } = make(fakeWindow(), false)
    expect(() => notify('a', '1', A)).not.toThrow()
    expect(FakeNotification.shown).toHaveLength(0)
    notify.dispose()
  })

  it('dispose cancela agrupamentos pendentes', () => {
    const { notify } = make()
    notify('a', '1', A)
    notify('a', '2', A)
    notify.dispose()
    vi.advanceTimersByTime(10_000)
    expect(FakeNotification.shown).toHaveLength(1)
  })

  it('remove caracteres de controle e corta textos longos', () => {
    const { notify } = make(null)
    notify('tí\u001btulo', `${'x'.repeat(1000)}\u0007`, A)
    const { title, body } = FakeNotification.shown[0]!.opts
    expect(title).toBe('tí tulo')
    expect(body.length).toBeLessThanOrEqual(600)
    expect(body.endsWith('…')).toBe(true)
    // Clique sem janela não quebra.
    expect(() => FakeNotification.shown[0]!.emit('click')).not.toThrow()
    notify.dispose()
  })
})
