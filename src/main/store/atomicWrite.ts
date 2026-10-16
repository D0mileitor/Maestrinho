import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Escrita atômica: grava em arquivo temporário no mesmo diretório e renomeia por cima do destino.
 * No Windows, o rename pode falhar com EPERM/EBUSY quando antivírus ou indexador estão com o arquivo
 * aberto; por isso há novas tentativas com espera crescente.
 */

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])

async function renameWithRetry(from: string, to: string): Promise<void> {
  let delay = 20
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (!RETRYABLE.has(code) || attempt >= 8) throw err
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, 500)
    }
  }
}

export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const dir = path.dirname(file)
  await fsp.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    const handle = await fsp.open(tmp, 'w')
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(tmp, file)
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}

/** Versão síncrona, usada apenas no encerramento do app (flush final). */
export function writeFileAtomicSync(file: string, data: string): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeFileSync(fd, data, 'utf8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, file)
        break
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? ''
        if (!RETRYABLE.has(code) || attempt >= 5) throw err
        const until = Date.now() + 30 * (attempt + 1)
        while (Date.now() < until) {
          // espera ativa curta: só no encerramento
        }
      }
    }
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // ignora
    }
    throw err
  }
}

/** Debounce de escrita com flush explícito. */
export class DebouncedWriter {
  private timer: NodeJS.Timeout | null = null
  private pending: (() => string) | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly delayMs: number,
    private readonly onError: (err: unknown) => void = () => undefined
  ) {}

  schedule(produce: () => string): void {
    this.pending = produce
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.delayMs)
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const produce = this.pending
    this.pending = null
    if (!produce) return this.writing
    const data = produce()
    this.writing = this.writing.then(() => writeFileAtomic(this.file, data)).catch((err) => this.onError(err))
    return this.writing
  }

  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const produce = this.pending
    this.pending = null
    if (!produce) return
    try {
      writeFileAtomicSync(this.file, produce())
    } catch (err) {
      this.onError(err)
    }
  }

  get hasPending(): boolean {
    return this.pending !== null
  }
}
