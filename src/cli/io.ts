import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as tty from 'node:tty'
import { z } from 'zod'
import { CliError, TOO_LARGE_TEXT_HINT } from './errors'

/**
 * Entrada/saída do CLI, injetada em `run()` para que a lógica seja testável sem criar processos.
 * A implementação real (`nodeIo`) fica aqui; os testes montam a sua.
 */
export interface CliIo {
  /** Escreve na saída padrão (texto já com as quebras de linha). */
  out(text: string): void
  /** Escreve na saída de erro. */
  err(text: string): void
  /** Lê todo o stdin (até `maxBytes`; acima disso rejeita com too_large). */
  readStdin(maxBytes: number): Promise<Buffer>
  /** Lê um arquivo inteiro (até `maxBytes`). */
  readFile(file: string, maxBytes: number): Promise<Buffer>
  readonly stdinIsTTY: boolean
  readonly stdoutIsTTY: boolean
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** Cancelamento (Ctrl+C / SIGTERM). */
  readonly signal?: AbortSignal
  /** Versão do app (para `orq --version`). */
  version(): string
}

export function interruptedError(): CliError {
  return new CliError('interrupted', 'interrompido.')
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(interruptedError())
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(interruptedError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Erro de entrada grande demais (código 7). */
export function tooLargeInput(what: string, maxBytes: number): CliError {
  return new CliError(
    'too_large',
    `${what} passa do limite de ${Math.floor(maxBytes / (1024 * 1024))} MB que o CLI aceita.`,
    TOO_LARGE_TEXT_HINT
  )
}

/**
 * No Windows, Ctrl+Z seguido de Enter num console é o "fim de arquivo" convencional. Devolve os
 * bytes antes do Ctrl+Z (e se ele apareceu). Busca o byte 0x1a direto: ele nunca aparece dentro
 * de um caractere UTF-8 de vários bytes, então não há risco de cortar um caractere ao meio.
 */
export function cutAtCtrlZ(chunk: Buffer): { data: Buffer; eof: boolean } {
  const i = chunk.indexOf(0x1a)
  return i === -1 ? { data: chunk, eof: false } : { data: chunk.subarray(0, i), eof: true }
}

/** Lê um stream até o fim, com limite de tamanho e cancelamento. */
export function readStream(
  stream: NodeJS.ReadableStream,
  opts: { maxBytes: number; signal?: AbortSignal; what?: string; ctrlZIsEof?: boolean }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (err: Error | null): void => {
      if (done) return
      done = true
      stream.removeListener('data', onData)
      stream.removeListener('end', onEnd)
      stream.removeListener('error', onError)
      opts.signal?.removeEventListener('abort', onAbort)
      stream.pause()
      if (err) reject(err)
      else resolve(Buffer.concat(chunks))
    }
    const onData = (chunk: Buffer | string): void => {
      let buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      let eof = false
      if (opts.ctrlZIsEof) {
        const cut = cutAtCtrlZ(buf)
        buf = cut.data
        eof = cut.eof
      }
      size += buf.length
      if (size > opts.maxBytes) {
        finish(tooLargeInput(opts.what ?? 'o texto do stdin', opts.maxBytes))
        return
      }
      chunks.push(buf)
      if (eof) finish(null)
    }
    const onEnd = (): void => finish(null)
    const onError = (err: Error): void => finish(new CliError('io', `não consegui ler o stdin: ${err.message}`))
    const onAbort = (): void => finish(interruptedError())
    if (opts.signal?.aborted) {
      finish(interruptedError())
      return
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    stream.on('data', onData)
    stream.on('end', onEnd)
    stream.on('error', onError)
    stream.resume()
  })
}

/**
 * Decodifica texto de stdin/arquivo: UTF-8 (com ou sem BOM), UTF-16 com BOM (padrão do
 * `Out-File`/`>` no Windows PowerShell 5.1) e, se não for UTF-8 válido, Windows-1252 (arquivos
 * "ANSI" antigos). Normaliza CRLF para LF.
 */
export function decodeText(buf: Uint8Array): string {
  let text: string
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = Buffer.from(buf.subarray(2)).toString('utf16le')
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const body = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1)))
    text = body.swap16().toString('utf16le')
  } else {
    try {
      // ignoreBOM=false (padrão): o BOM UTF-8, se houver, é descartado.
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    } catch {
      text = decodeAnsi(buf)
    }
  }
  return text.replace(/\r\n/g, '\n')
}

/** Windows-1252 (precisa de ICU completo, como no Electron); sem ele, Latin-1. */
function decodeAnsi(buf: Uint8Array): string {
  try {
    return new TextDecoder('windows-1252').decode(buf)
  } catch {
    return Buffer.from(buf).toString('latin1')
  }
}

export interface PathDeps {
  platform: NodeJS.Platform
  exists(file: string): boolean
  /** Converte com o `cygpath -w` do Git Bash/MSYS (null se não houver). */
  cygpath(file: string): string | null
}

/**
 * Caminhos vindos do Git Bash/MSYS no Windows (o shell do Claude Code): os shims desligam a
 * conversão automática de argumentos do MSYS — para "/revisar" não virar caminho —, então
 * "--file /c/proj/a.md" ou "/tmp/a.md" chegam crus ao Node nativo. Se o caminho literal não
 * existir, converte "/<letra>/..." para "<LETRA>:\..." e, para o resto, pergunta ao `cygpath`.
 */
export function resolveInputPath(file: string, deps: PathDeps): string {
  if (deps.platform !== 'win32' || !file.startsWith('/') || deps.exists(file)) return file
  const drive = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(file)
  if (drive) return `${drive[1]!.toUpperCase()}:\\${(drive[2] ?? '').replace(/\//g, '\\')}`
  return deps.cygpath(file) ?? file
}

function cygpathToWindows(file: string): string | null {
  try {
    const out = execFileSync('cygpath', ['-w', file], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const converted = out.trim()
    return converted === '' ? null : converted
  } catch {
    return null
  }
}

const REAL_PATH_DEPS: PathDeps = { platform: process.platform, exists: fs.existsSync, cygpath: cygpathToWindows }

/** Lê um arquivo de entrada (--file) com limite de tamanho; erros citam o caminho como digitado. */
export async function readFileLimited(file: string, maxBytes: number, deps: PathDeps = REAL_PATH_DEPS): Promise<Buffer> {
  const real = resolveInputPath(file, deps)
  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(real)
  } catch (err) {
    throw fileError(err, file)
  }
  if (stat.isDirectory()) throw new CliError('usage', `"${file}" é uma pasta, não um arquivo.`)
  if (stat.size > maxBytes) throw tooLargeInput(`o arquivo "${file}"`, maxBytes)
  try {
    return await fs.promises.readFile(real)
  } catch (err) {
    throw fileError(err, file)
  }
}

export function fileError(err: unknown, file: string): CliError {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') return new CliError('not_found', `arquivo não encontrado: "${file}".`)
  if (code === 'EACCES' || code === 'EPERM') return new CliError('io', `sem permissão para ler "${file}".`)
  const detail = code ?? (err instanceof Error ? err.message : String(err))
  return new CliError('io', `não consegui ler "${file}": ${detail}.`)
}

const PackageJsonSchema = z.object({ version: z.string().max(64) })

/** Lê a versão do package.json do app a partir da pasta do script (out/main → raiz). */
export function readAppVersion(scriptDir: string): string {
  for (const rel of ['../../package.json', '../package.json']) {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(scriptDir, rel), 'utf8'))
      const parsed = PackageJsonSchema.safeParse(raw)
      if (parsed.success) return parsed.data.version
    } catch {
      // tenta o próximo
    }
  }
  return 'desconhecida'
}

/** I/O real do processo. `usedStdin()` diz se o stdin foi lido (para fechá-lo ao sair). */
export function nodeIo(opts: { signal?: AbortSignal; scriptDir: string }): CliIo & { usedStdin(): boolean } {
  let stdinUsed = false
  const stdinIsTTY = tty.isatty(0)
  return {
    out: (text) => {
      process.stdout.write(text)
    },
    err: (text) => {
      process.stderr.write(text)
    },
    readStdin: (maxBytes) => {
      stdinUsed = true
      const ctrlZIsEof = stdinIsTTY && process.platform === 'win32'
      return readStream(process.stdin, { maxBytes, signal: opts.signal, ctrlZIsEof })
    },
    readFile: (file, maxBytes) => readFileLimited(file, maxBytes),
    stdinIsTTY,
    stdoutIsTTY: tty.isatty(1),
    now: () => Date.now(),
    sleep,
    signal: opts.signal,
    version: () => readAppVersion(opts.scriptDir),
    usedStdin: () => stdinUsed
  }
}
