import { EventEmitter } from 'node:events'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { parseBoard, type BoardFile } from '@shared/board'
import { writeFileAtomic } from '../store/atomicWrite'
import { metaDirOf } from '../store/WorkspaceStore'
import { log } from '../util/log'

export const BOARD_FILE = 'quadro.json'

function key(dir: string): string {
  const abs = path.resolve(dir)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

/**
 * Quadro de chamados de cada workspace (.maestrinho/quadro.json). O processo principal é o único que
 * grava: pedidos da interface (IPC) e dos agentes (`orq board`) passam por `mutate`, em fila por
 * workspace, e cada mudança é avisada à interface.
 */
export class BoardService extends EventEmitter<{ changed: [string, BoardFile] }> {
  private readonly boards = new Map<string, BoardFile>()
  private readonly chains = new Map<string, Promise<unknown>>()

  fileOf(dir: string): string {
    return path.join(metaDirOf(dir), BOARD_FILE)
  }

  async get(dir: string): Promise<BoardFile> {
    const k = key(dir)
    const cached = this.boards.get(k)
    if (cached) return cached
    let raw: unknown
    try {
      raw = JSON.parse(await fsp.readFile(this.fileOf(dir), 'utf8'))
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code
      if (code !== 'ENOENT') log.warn('quadro.json ilegível; usando o quadro padrão', { error: err instanceof Error ? err.name : 'erro' })
    }
    const board = parseBoard(raw)
    this.boards.set(k, board)
    return board
  }

  /** Aplica uma mudança (em fila por workspace), grava e avisa. `fn` pode lançar BoardError. */
  mutate<T>(dir: string, fn: (board: BoardFile) => { board: BoardFile; result: T }): Promise<T> {
    const k = key(dir)
    const run = async (): Promise<T> => {
      const current = await this.get(dir)
      const { board, result } = fn(current)
      if (board !== current) {
        this.boards.set(k, board)
        await writeFileAtomic(this.fileOf(dir), `${JSON.stringify(board, null, 2)}\n`)
        this.emit('changed', dir, board)
      }
      return result
    }
    const prev = this.chains.get(k) ?? Promise.resolve()
    const next = prev.then(run, run)
    this.chains.set(
      k,
      next.catch(() => undefined)
    )
    return next
  }

  /** Esquece o cache de um workspace fechado. */
  unload(dir: string): void {
    this.boards.delete(key(dir))
    this.chains.delete(key(dir))
  }
}
