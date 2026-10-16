import { Notification, type BrowserWindow } from 'electron'
import { APP_NAME } from '@shared/constants'
import { log } from './util/log'

/**
 * Notificações nativas do sistema (orq notify e avisos do app).
 *
 * Rajadas são agrupadas: no máximo uma notificação por terminal a cada `coalesceMs` (padrão 4 s);
 * o que chegar dentro da janela vira UMA notificação ao fim dela, com a mensagem mais recente e a
 * contagem das demais. Clicar foca a janela e chama `onClick` (ex.: centralizar o terminal).
 */

export interface NotifyInfo {
  terminalId: string
  dir: string
}

/** O mínimo usado de uma notificação do Electron (permite substituir nos testes). */
export interface NotificationLike {
  on(event: 'click', listener: () => void): unknown
  on(event: 'close', listener: () => void): unknown
  on(event: 'failed', listener: () => void): unknown
  show(): void
}

export interface NotifierOptions {
  getWindow(): BrowserWindow | null
  onClick(info: NotifyInfo): void
  /** Janela de agrupamento por terminal (padrão 4 s). */
  coalesceMs?: number
  /** Fábrica da notificação (padrão: Notification do Electron). */
  create?: (opts: { title: string; body: string }) => NotificationLike
  /** Suporte a notificações no sistema (padrão: Notification.isSupported()). */
  isSupported?: () => boolean
}

export type Notifier = ((title: string, body: string, info: NotifyInfo) => void) & {
  /** Cancela agrupamentos pendentes (saída do app). */
  dispose(): void
}

const MAX_TITLE = 120
const MAX_BODY = 600
/** Referências mantidas para o GC não descartar a notificação antes do clique (Windows). */
const MAX_RETAINED = 50

interface Slot {
  /** Fim da janela atual de agrupamento. */
  until: number
  timer: NodeJS.Timeout | null
  pending: { title: string; body: string; info: NotifyInfo; extra: number } | null
}

function clip(text: string, max: number): string {
  const clean = text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** Acrescenta ao corpo quantas notificações anteriores do terminal foram agrupadas nesta. */
function withExtra(body: string, extra: number): string {
  if (extra <= 0) return body
  return `${body}\n(+${extra} ${extra === 1 ? 'notificação anterior' : 'notificações anteriores'} deste terminal)`
}

function focusWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function createNotifier(opts: NotifierOptions): Notifier {
  const coalesceMs = Math.max(0, opts.coalesceMs ?? 4000)
  const create = opts.create ?? ((o: { title: string; body: string }): NotificationLike => new Notification(o))
  const isSupported = opts.isSupported ?? ((): boolean => Notification.isSupported())
  const slots = new Map<string, Slot>()
  const retained = new Set<NotificationLike>()
  let warnedUnsupported = false

  const supportedNow = (): boolean => {
    try {
      return isSupported()
    } catch {
      return false
    }
  }

  const show = (title: string, body: string, info: NotifyInfo): void => {
    if (!supportedNow()) {
      if (!warnedUnsupported) log.warn('notificações nativas não suportadas neste sistema')
      warnedUnsupported = true
      return
    }
    try {
      const n = create({ title: clip(title, MAX_TITLE) || APP_NAME, body: clip(body, MAX_BODY) })
      const release = (): void => {
        retained.delete(n)
      }
      n.on('click', () => {
        release()
        focusWindow(opts.getWindow())
        opts.onClick(info)
      })
      n.on('close', release)
      n.on('failed', release)
      retained.add(n)
      if (retained.size > MAX_RETAINED) {
        const oldest = retained.values().next().value
        if (oldest) retained.delete(oldest)
      }
      n.show()
    } catch (err) {
      log.warn('falha ao exibir notificação', { error: err instanceof Error ? err.name : 'erro' })
    }
  }

  const flush = (key: string): void => {
    const slot = slots.get(key)
    if (!slot) return
    slot.timer = null
    const p = slot.pending
    if (!p) {
      slots.delete(key)
      return
    }
    slot.pending = null
    show(p.title, withExtra(p.body, p.extra), p.info)
    // Nova janela a partir desta exibição; se nada mais chegar, a vaga é liberada ao fim dela.
    slot.until = Date.now() + coalesceMs
    slot.timer = setTimeout(() => flush(key), coalesceMs)
    slot.timer.unref?.()
  }

  const notify = (title: string, body: string, info: NotifyInfo): void => {
    const key = info.terminalId
    const now = Date.now()
    const slot = slots.get(key)
    if (!slot || now >= slot.until) {
      if (slot?.timer) clearTimeout(slot.timer)
      // Timer atrasado (laço de eventos ocupado): o agrupado pendente não é perdido, entra na contagem.
      const extra = slot?.pending ? slot.pending.extra + 1 : 0
      show(title, withExtra(body, extra), info)
      const timer = coalesceMs > 0 ? setTimeout(() => flush(key), coalesceMs) : null
      timer?.unref?.()
      if (timer) slots.set(key, { until: now + coalesceMs, timer, pending: null })
      else slots.delete(key)
      return
    }
    // Dentro da janela: agrupa (fica a mais recente; as anteriores viram contagem).
    slot.pending = { title, body, info, extra: slot.pending ? slot.pending.extra + 1 : 0 }
  }

  const dispose = (): void => {
    for (const slot of slots.values()) if (slot.timer) clearTimeout(slot.timer)
    slots.clear()
    retained.clear()
  }

  return Object.assign(notify, { dispose })
}
