import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Log do app em arquivo rotativo no diretório userData/logs.
 * REGRA: nunca registrar conteúdo de prompts, mensagens entre agentes ou saída de terminal —
 * apenas metadados (ids, tamanhos, códigos de erro).
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const MAX_BYTES = 1024 * 1024
const MAX_FILES = 5

let logDir: string | null = null
let stream: fs.WriteStream | null = null
let written = 0

function filePath(index: number): string {
  return path.join(logDir!, index === 0 ? 'main.log' : `main.${index}.log`)
}

function rotate(): void {
  stream?.end()
  stream = null
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    const from = filePath(i - 1)
    const to = filePath(i)
    try {
      if (fs.existsSync(from)) fs.renameSync(from, to)
    } catch {
      // ignora falhas de rotação
    }
  }
  open()
}

function open(): void {
  if (!logDir) return
  const file = filePath(0)
  try {
    written = fs.existsSync(file) ? fs.statSync(file).size : 0
  } catch {
    written = 0
  }
  stream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' })
  stream.on('error', () => {
    stream = null
  })
}

export function initLog(dir: string): void {
  logDir = dir
  fs.mkdirSync(dir, { recursive: true })
  open()
}

function serialize(meta: unknown): string {
  if (meta === undefined) return ''
  if (meta instanceof Error) return ` ${meta.name}: ${meta.message}`
  try {
    return ' ' + JSON.stringify(meta)
  } catch {
    return ''
  }
}

function write(level: Level, msg: string, meta?: unknown): void {
  const line = `${new Date().toISOString()} [${level}] ${msg}${serialize(meta)}\n`
  if (process.env.NODE_ENV !== 'production' && level !== 'debug') {
    ;(level === 'error' ? console.error : console.log)(line.trimEnd())
  }
  if (!stream) return
  if (written + line.length > MAX_BYTES) rotate()
  stream?.write(line)
  written += Buffer.byteLength(line)
}

export const log = {
  debug: (msg: string, meta?: unknown) => write('debug', msg, meta),
  info: (msg: string, meta?: unknown) => write('info', msg, meta),
  warn: (msg: string, meta?: unknown) => write('warn', msg, meta),
  error: (msg: string, meta?: unknown) => write('error', msg, meta)
}
