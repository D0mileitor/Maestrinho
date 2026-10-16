import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import type { EventChannel, EventMap, InvokeChannel, InvokeMap, SendChannel, SendMap } from '@shared/ipc'
import { isAppUrl } from '../window'
import { log } from '../util/log'

/**
 * Registro tipado de handlers IPC. Todo payload é validado com zod e o remetente precisa ser um
 * frame da própria interface do app (nunca um portal/webview).
 */

function senderAllowed(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  return isAppUrl(url)
}

export class IpcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IpcError'
  }
}

export function handle<K extends InvokeChannel>(
  channel: K,
  schema: z.ZodType<InvokeMap[K]['req']> | null,
  fn: (req: InvokeMap[K]['req'], event: IpcMainInvokeEvent) => Promise<InvokeMap[K]['res']> | InvokeMap[K]['res']
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    if (!senderAllowed(event)) {
      log.warn('IPC recusado: remetente não autorizado', { channel })
      throw new IpcError('remetente não autorizado')
    }
    let req: InvokeMap[K]['req']
    if (schema) {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        log.warn('IPC: payload inválido', { channel, issues: parsed.error.issues.length })
        throw new IpcError(`payload inválido em ${channel}: ${parsed.error.issues[0]?.message ?? ''}`)
      }
      req = parsed.data
    } else {
      req = undefined as InvokeMap[K]['req']
    }
    try {
      return await fn(req, event)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('IPC: erro no handler', { channel, error: msg.slice(0, 300) })
      throw err instanceof Error ? err : new Error(msg)
    }
  })
}

export function on<K extends SendChannel>(
  channel: K,
  schema: z.ZodType<SendMap[K]>,
  fn: (payload: SendMap[K], event: IpcMainEvent) => void
): void {
  ipcMain.on(channel, (event, raw: unknown) => {
    if (!senderAllowed(event)) return
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return
    fn(parsed.data, event)
  })
}

/** Emissor de eventos para a janela principal e as secundárias (ex.: o chat destacado). */
export class EventBus {
  private win: BrowserWindow | null = null
  /** Janelas secundárias e os canais que elas não recebem (ex.: a saída dos terminais, que o chat não usa). */
  private readonly secondary = new Map<BrowserWindow, ReadonlySet<EventChannel>>()

  attach(win: BrowserWindow): void {
    this.win = win
    const detach = (): void => {
      if (this.win === win) this.win = null
    }
    // Para de emitir assim que a janela começa a fechar: o frame pode ser descartado antes de 'closed'.
    win.on('close', detach)
    win.on('closed', detach)
    win.webContents.on('render-process-gone', detach)
    win.webContents.on('destroyed', detach)
  }

  attachSecondary(win: BrowserWindow, exclude: Iterable<EventChannel>): void {
    this.secondary.set(win, new Set(exclude))
    const detach = (): void => {
      this.secondary.delete(win)
    }
    win.on('close', detach)
    win.on('closed', detach)
    win.webContents.on('render-process-gone', detach)
    win.webContents.on('destroyed', detach)
  }

  get window(): BrowserWindow | null {
    return this.win
  }

  emit<K extends EventChannel>(channel: K, payload: EventMap[K]): void {
    send(this.win, channel, payload)
    for (const [win, exclude] of this.secondary) if (!exclude.has(channel)) send(win, channel, payload)
  }

  /** Só para a janela principal (ex.: focar um nó do canvas). */
  emitMain<K extends EventChannel>(channel: K, payload: EventMap[K]): void {
    send(this.win, channel, payload)
  }

  /** Só para uma janela secundária. */
  emitTo<K extends EventChannel>(win: BrowserWindow, channel: K, payload: EventMap[K]): void {
    send(win, channel, payload)
  }
}

function send<K extends EventChannel>(win: BrowserWindow | null, channel: K, payload: EventMap[K]): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  try {
    win.webContents.send(channel, payload)
  } catch {
    // janela sendo descartada
  }
}
