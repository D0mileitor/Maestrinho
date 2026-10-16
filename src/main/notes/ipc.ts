import { z } from 'zod'
import { ApiError } from '@shared/api'
import type { NoteInfo } from '@shared/ipc'
import { handle, type EventBus } from '../ipc/registry'
import { DirReq, NoteCreateReq, NoteFileReq, NoteWriteReq } from '../ipc/schemas'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import type { WorkspaceStore } from '../store/WorkspaceStore'
import type { NotesService } from './NotesService'

/**
 * IPC das notas (renderer <-> main): notes:list/read/write/create, só para workspaces abertos, e
 * repasse dos eventos do serviço (note:changed / notes:listChanged) para a janela.
 */

/**
 * `notes:write` aceita, além do contrato, a revisão em que o editor se baseou (`ifRevision`, 16 hex):
 * se o arquivo mudou por fora nesse meio-tempo, a escrita falha com "[precondition] ..." em vez de
 * sobrescrever a alteração do agente.
 */
export const NoteWriteIpcReq = NoteWriteReq.extend({
  ifRevision: z
    .string()
    .regex(/^[0-9a-f]{16}$/i, 'revisão inválida')
    .optional()
})
type NoteWriteIpcPayload = z.infer<typeof NoteWriteIpcReq>

export interface NotesIpcDeps {
  notes: NotesService
  workspaces: WorkspaceManager
  bus: EventBus
}

/**
 * Erro transportado pelo IPC. O Electron só repassa `toString()` do erro ao renderer, então o código
 * da API vai no início da mensagem ("[not_found] a nota ... não existe") para o renderer distinguir
 * "arquivo ausente" e "conflito" de outros erros.
 */
export function toIpcError(err: unknown): Error {
  if (err instanceof ApiError) return new Error(`[${err.code}] ${err.message}`)
  return err instanceof Error ? err : new Error(String(err))
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toIpcError(err)
  }
}

/** Registra os handlers IPC das notas e o repasse dos eventos. Devolve a função que desliga o repasse. */
export function registerNotesIpc(deps: NotesIpcDeps): () => void {
  const { notes, workspaces, bus } = deps

  const live = (dir: string): WorkspaceStore => {
    const ws = workspaces.get(dir)
    if (!ws) throw new ApiError('unavailable', 'o workspace não está aberto')
    return ws
  }

  handle('notes:list', DirReq, ({ dir }) =>
    guarded(async () => {
      const ws = live(dir)
      const entries = await notes.list(ws.dir)
      return entries.map((e): NoteInfo => ({ file: e.file, size: e.size, mtimeMs: e.mtimeMs }))
    })
  )

  handle('notes:read', NoteFileReq, ({ dir, file }) =>
    guarded(async () => {
      const ws = live(dir)
      return (await notes.read(ws.dir, file)).content
    })
  )

  handle('notes:write', NoteWriteIpcReq, (req) =>
    guarded(async () => {
      // O payload foi validado por NoteWriteIpcReq (o tipo do contrato não declara ifRevision).
      const { dir, file, content, ifRevision } = req as NoteWriteIpcPayload
      const ws = live(dir)
      await notes.write(ws.dir, file, content, ifRevision)
    })
  )

  handle('notes:create', NoteCreateReq, ({ dir, file, content }) =>
    guarded(async () => {
      const ws = live(dir)
      return notes.create(ws.dir, file, content ?? '')
    })
  )

  // Eventos do serviço (escritas pela API/IPC e alterações externas) -> janela, só de workspaces abertos.
  const onChanged = (dir: string, file: string): void => {
    const ws = workspaces.get(dir)
    if (ws) bus.emit('note:changed', { dir: ws.dir, file })
  }
  const onListChanged = (dir: string): void => {
    const ws = workspaces.get(dir)
    if (ws) bus.emit('notes:listChanged', { dir: ws.dir })
  }
  notes.on('changed', onChanged)
  notes.on('listChanged', onListChanged)
  return () => {
    notes.off('changed', onChanged)
    notes.off('listChanged', onListChanged)
  }
}

/**
 * Liga o watcher de notas ao ciclo de vida dos workspaces: observa ao abrir (inclusive os que já
 * estão abertos) e para ao fechar. Devolve a função que desfaz a ligação (não fecha os watchers;
 * use notes.closeAll() no encerramento).
 */
export function bindNotesWatcher(notes: NotesService, workspaces: WorkspaceManager): () => void {
  const onOpened = (ws: WorkspaceStore): void => {
    void notes.watch(ws.dir)
  }
  const onClosing = (ws: WorkspaceStore): void => {
    void notes.unwatch(ws.dir)
  }
  workspaces.on('opened', onOpened)
  workspaces.on('closing', onClosing)
  for (const ws of workspaces.all()) void notes.watch(ws.dir)
  return () => {
    workspaces.off('opened', onOpened)
    workspaces.off('closing', onClosing)
  }
}
