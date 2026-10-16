import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { z } from 'zod'
import { log } from '../util/log'

/**
 * Utilitários de arquivo síncronos dos gerenciadores de instruções. São chamados no início e no fim
 * de terminais e mexem em poucos bytes, então E/S síncrona é aceitável (e evita corridas entre
 * terminais que iniciam juntos na mesma pasta).
 */

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Pausa síncrona curta sem ocupar a CPU; cai para espera ativa se `Atomics.wait` não estiver disponível. */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    const until = Date.now() + ms
    while (Date.now() < until) {
      // espera ativa (raro)
    }
  }
}

/** Código de erro do Node (ENOENT, EPERM...) ou ''. */
export function errCode(err: unknown): string {
  return (err as NodeJS.ErrnoException | undefined)?.code ?? ''
}

/**
 * Escrita atômica síncrona: grava num temporário no mesmo diretório e renomeia por cima do destino.
 * Um crash no meio nunca deixa o arquivo pela metade. `mode` preserva as permissões do arquivo
 * original em sistemas POSIX. No Windows o rename é repetido algumas vezes (antivírus/indexador).
 */
export function writeFileAtomicSync(file: string, data: Buffer | string, mode?: number): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    const fd = fs.openSync(tmp, 'w', mode ?? 0o666)
    try {
      fs.writeFileSync(fd, data)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    if (mode !== undefined && process.platform !== 'win32') fs.chmodSync(tmp, mode)
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, file)
        return
      } catch (err) {
        if (!RETRYABLE.has(errCode(err)) || attempt >= 6) throw err
        sleepSync(25 * (attempt + 1))
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

/** Lê e valida um JSON; ausente, ilegível ou inválido = null (com aviso no log, sem conteúdo). */
export function readJsonFile<T>(file: string, schema: z.ZodType<T>): T | null {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (errCode(err) !== 'ENOENT') log.warn('registro de instruções ilegível', { file: path.basename(file), code: errCode(err) })
    return null
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    log.warn('registro de instruções com JSON inválido; ignorado', { file: path.basename(file) })
    return null
  }
  const parsed = schema.safeParse(raw)
  if (parsed.success) return parsed.data
  log.warn('registro de instruções inválido; ignorado', { file: path.basename(file), issues: parsed.error.issues.length })
  return null
}

/**
 * Chave estável de um diretório: caminho real (resolve links, junções e nomes curtos 8.3 do Windows)
 * e sem diferenciar maiúsculas no Windows.
 */
export function dirKey(dir: string): string {
  let p = path.resolve(dir)
  try {
    p = fs.realpathSync.native(p)
  } catch {
    // diretório pode não existir mais: usa o caminho resolvido
  }
  return process.platform === 'win32' ? p.toLowerCase() : p
}
