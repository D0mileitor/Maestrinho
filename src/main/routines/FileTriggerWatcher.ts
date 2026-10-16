import * as path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { log } from '../util/log'

/** Juntar as mudanças antes de disparar (um "salvar tudo" vira um disparo só). */
const DEBOUNCE_MS = 2000
/** Pastas que nunca interessam a uma rotina (dependências, git, saída de build, dados do app). */
const IGNORED = /(^|[\\/])(node_modules|\.git|\.maestrinho|\.claude|dist|build|out|\.next|target|coverage|\.venv|venv|__pycache__)([\\/]|$)/

/** O caminho (relativo ao workspace) está numa pasta ignorada pelos gatilhos? */
export function ignoredByTriggers(relative: string): boolean {
  return IGNORED.test(relative)
}

interface Watched {
  watcher: FSWatcher
  pending: Set<string>
  timer: NodeJS.Timeout | null
}

/**
 * Observa os arquivos de um workspace só enquanto ele tem rotina ativa com gatilho "arquivos mudaram"
 * (sem rotina assim, nada é observado). Entrega os caminhos relativos, com "/".
 */
export class FileTriggerWatcher {
  private readonly watched = new Map<string, Watched>()

  constructor(private readonly onFiles: (dir: string, files: string[]) => void) {}

  sync(dir: string, active: boolean): void {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir
    const current = this.watched.get(key)
    if (active && !current) {
      const watcher = watch(dir, {
        ignoreInitial: true,
        ignored: (p: string) => ignoredByTriggers(path.relative(dir, p))
      })
      const w: Watched = { watcher, pending: new Set(), timer: null }
      const touched = (p: string): void => {
        const rel = path.relative(dir, p).split(path.sep).join('/')
        if (!rel || rel.startsWith('..')) return
        w.pending.add(rel)
        if (w.timer) clearTimeout(w.timer)
        w.timer = setTimeout(() => {
          w.timer = null
          const files = [...w.pending]
          w.pending.clear()
          this.onFiles(dir, files)
        }, DEBOUNCE_MS)
      }
      watcher.on('add', touched).on('change', touched).on('unlink', touched)
      watcher.on('error', (err) => log.warn('gatilhos: erro ao observar arquivos', err instanceof Error ? err : undefined))
      this.watched.set(key, w)
    } else if (!active && current) {
      this.stop(key, current)
    }
  }

  private stop(key: string, w: Watched): void {
    if (w.timer) clearTimeout(w.timer)
    void w.watcher.close()
    this.watched.delete(key)
  }

  stopAll(): void {
    for (const [key, w] of this.watched) this.stop(key, w)
  }
}
