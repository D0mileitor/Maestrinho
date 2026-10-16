import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { AGENTS_MD_BEGIN, AGENTS_MD_END } from '@shared/constants'
import { log } from '../util/log'
import { dirKey, errCode, readJsonFile, writeFileAtomicSync } from './fsutil'

/**
 * Seção do app no AGENTS.md (lido por Codex, OpenCode e outros agentes) do diretório de trabalho.
 *
 * REGRA ABSOLUTA: nada fora dos marcadores AGENTS_MD_BEGIN/END é alterado ou apagado. O arquivo é
 * editado como bytes (cada byte vira um caractere "latin1"), então o conteúdo do usuário — inclusive
 * BOM, CRLF, ausência de quebra final ou bytes que não sejam UTF-8 — volta exatamente igual quando a
 * seção sai. Marcadores malformados/desbalanceados = não mexe em nada (só registra um aviso).
 *
 * Contagem de referências por terminal em cada pasta, persistida num registro JSON (escrita
 * atômica) para que um crash possa ser limpo no próximo início (`cleanupOrphans`).
 */

export const AGENTS_MD_FILE = 'AGENTS.md'

/** Acima disso o arquivo não é tocado (não é um AGENTS.md razoável). */
const MAX_FILE_BYTES = 4 * 1024 * 1024

const EntrySchema = z.object({
  /** Diretório de trabalho como recebido (diagnóstico). */
  dir: z.string().min(1).max(4096),
  /** Arquivo efetivamente editado (destino real, se AGENTS.md for um link simbólico). */
  file: z.string().min(1).max(4096),
  terminals: z.array(z.string().min(1).max(64)).max(1000),
  /** O arquivo não existia: foi criado pelo app (pode ser apagado se ficar vazio). */
  createdFile: z.boolean(),
  /** Quebras de linha que o app inseriu antes da seção; null = desconhecido (seção já existia). */
  separator: z
    .string()
    .max(8)
    .regex(/^[\r\n]*$/)
    .nullable()
})
type Entry = z.infer<typeof EntrySchema>

const RegistrySchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string().max(4096), EntrySchema)
})

// ------------------------------------------------------------------ edição pura (strings de bytes)

/** Texto -> "string de bytes" UTF-8 (um caractere por byte). */
export function toBytes(text: string): string {
  return Buffer.from(text, 'utf8').toString('latin1')
}

const BEGIN_B = toBytes(AGENTS_MD_BEGIN)
const END_B = toBytes(AGENTS_MD_END)

export type SectionScan =
  | { kind: 'none' }
  | { kind: 'malformed'; reason: string }
  | {
      kind: 'one'
      /** Início da linha do marcador de abertura. */
      begin: number
      /** Logo após a quebra de linha do marcador de abertura. */
      innerStart: number
      /** Início da linha do marcador de fechamento. */
      end: number
      /** Logo após a quebra de linha do marcador de fechamento (ou fim do arquivo). */
      after: number
      eol: '\n' | '\r\n'
    }

function findAll(s: string, needle: string): number[] {
  const out: number[] = []
  for (let i = s.indexOf(needle); i !== -1; i = s.indexOf(needle, i + needle.length)) out.push(i)
  return out
}

/** Posição logo após a quebra de linha, se o resto da linha a partir de `i` for vazio; -1 caso contrário. */
function restOfLineEnd(s: string, i: number): number {
  let j = i
  while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++
  if (j === s.length) return j
  if (s[j] === '\n') return j + 1
  if (s[j] === '\r') return s[j + 1] === '\n' ? j + 2 : j + 1
  return -1
}

function atLineStart(s: string, i: number): boolean {
  return i === 0 || s[i - 1] === '\n'
}

/** Localiza a seção do app. Exige exatamente um par de marcadores, em linhas próprias e na ordem certa. */
export function scanSection(content: string): SectionScan {
  const begins = findAll(content, BEGIN_B)
  const ends = findAll(content, END_B)
  if (begins.length === 0 && ends.length === 0) return { kind: 'none' }
  if (begins.length !== 1 || ends.length !== 1) {
    return { kind: 'malformed', reason: 'marcadores duplicados ou desbalanceados' }
  }
  const begin = begins[0]!
  const end = ends[0]!
  if (end < begin) return { kind: 'malformed', reason: 'marcador de fim antes do de início' }
  if (!atLineStart(content, begin) || !atLineStart(content, end)) {
    return { kind: 'malformed', reason: 'marcador fora do início da linha' }
  }
  const innerStart = restOfLineEnd(content, begin + BEGIN_B.length)
  const after = restOfLineEnd(content, end + END_B.length)
  if (innerStart === -1 || after === -1 || innerStart > end) {
    return { kind: 'malformed', reason: 'texto na mesma linha de um marcador' }
  }
  const eol = content.slice(Math.max(begin, innerStart - 2), innerStart) === '\r\n' ? '\r\n' : '\n'
  return { kind: 'one', begin, innerStart, end, after, eol }
}

/** Quebra de linha predominante do arquivo (LF quando não há nenhuma). */
export function detectEol(content: string): '\n' | '\r\n' {
  let crlf = 0
  let lf = 0
  for (let i = content.indexOf('\n'); i !== -1; i = content.indexOf('\n', i + 1)) {
    if (i > 0 && content[i - 1] === '\r') crlf++
    else lf++
  }
  return crlf > lf ? '\r\n' : '\n'
}

function isBlank(s: string): boolean {
  return /^[ \t\r\n]*$/.test(s)
}

/** Remove os marcadores do texto da seção (eles só podem aparecer como delimitadores) e normaliza LF. */
export function normalizeSectionText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(AGENTS_MD_BEGIN)
    .join('')
    .split(AGENTS_MD_END)
    .join('')
    .replace(/^\n+|\n+$/g, '')
}

function innerBytes(text: string, eol: string): string {
  const body = toBytes(normalizeSectionText(text))
  return eol === '\n' ? body : body.replace(/\n/g, eol)
}

/** Bloco completo (marcadores + texto + quebra final) com a quebra de linha indicada. */
export function sectionBlock(text: string, eol: '\n' | '\r\n'): string {
  return BEGIN_B + eol + innerBytes(text, eol) + eol + END_B + eol
}

/**
 * Acrescenta a seção ao fim do conteúdo, separada por uma linha em branco. Devolve o separador
 * inserido (necessário para desfazer exatamente).
 */
export function insertSection(content: string, text: string): { content: string; separator: string } {
  const eol = detectEol(content)
  let separator = ''
  if (content.length > 0) separator = content.endsWith('\n') ? eol : eol + eol
  return { content: content + separator + sectionBlock(text, eol), separator }
}

/** Troca apenas o miolo da seção existente (os marcadores e tudo fora deles ficam como estão). */
export function replaceSection(content: string, scan: Extract<SectionScan, { kind: 'one' }>, text: string): string {
  return content.slice(0, scan.innerStart) + innerBytes(text, scan.eol) + scan.eol + content.slice(scan.end)
}

/**
 * Remove a seção (dos marcadores até a quebra de linha do marcador final). O separador que o app
 * inseriu só sai se ainda estiver lá, intacto, e se não houver conteúdo depois da seção.
 */
export function removeSection(
  content: string,
  scan: Extract<SectionScan, { kind: 'one' }>,
  separator: string | null
): string {
  let before = content.slice(0, scan.begin)
  const after = content.slice(scan.after)
  if (separator && isBlank(after) && before.endsWith(separator)) before = before.slice(0, before.length - separator.length)
  return before + after
}

// ------------------------------------------------------------------ arquivo

interface FileState {
  exists: boolean
  /** Conteúdo como string de bytes. */
  content: string
  mode?: number
  /** Motivo para não tocar no arquivo. */
  refused?: string
}

function readFileState(file: string): FileState {
  let st: fs.Stats
  try {
    st = fs.statSync(file)
  } catch (err) {
    if (errCode(err) === 'ENOENT') return { exists: false, content: '' }
    throw err
  }
  if (!st.isFile()) return { exists: true, content: '', refused: 'não é um arquivo comum' }
  if (st.size > MAX_FILE_BYTES) return { exists: true, content: '', refused: 'arquivo grande demais' }
  try {
    fs.accessSync(file, fs.constants.W_OK)
  } catch {
    return { exists: true, content: '', refused: 'arquivo somente leitura' }
  }
  const buf = fs.readFileSync(file)
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    return { exists: true, content: '', refused: 'codificação UTF-16 não suportada' }
  }
  if (buf.includes(0)) return { exists: true, content: '', refused: 'conteúdo binário' }
  return { exists: true, content: buf.toString('latin1'), mode: st.mode & 0o7777 }
}

/** Arquivo a editar: se AGENTS.md for um link simbólico, edita o destino (o link continua link). */
function resolveTarget(file: string): string | null {
  let lst: fs.Stats
  try {
    lst = fs.lstatSync(file)
  } catch (err) {
    if (errCode(err) === 'ENOENT') return file
    throw err
  }
  if (!lst.isSymbolicLink()) return file
  try {
    return fs.realpathSync(file)
  } catch {
    return null // link quebrado: não cria arquivos no destino de um link
  }
}

function writeBytes(file: string, content: string, mode?: number): void {
  writeFileAtomicSync(file, Buffer.from(content, 'latin1'), mode)
}

// ------------------------------------------------------------------ gerenciador

export class AgentsMdManager {
  private entries: Record<string, Entry>
  /** Pares "chave|terminal" adquiridos por este processo (os demais vieram de uma sessão anterior). */
  private readonly live = new Set<string>()

  constructor(private readonly registryFile: string) {
    this.entries = readJsonFile(registryFile, RegistrySchema)?.entries ?? {}
  }

  /**
   * Garante que <cwd>/AGENTS.md tenha a seção do app com `sectionText` e conta o terminal.
   * Devolve false se não foi possível (nesse caso nada foi alterado).
   */
  acquire(cwd: string, terminalId: string, sectionText: string): boolean {
    const key = dirKey(cwd)
    const prev = this.entries[key]
    const alive = (prev?.terminals ?? []).filter((t) => t !== terminalId && this.live.has(liveKey(key, t)))
    try {
      const file = prev?.file ?? resolveTarget(path.join(cwd, AGENTS_MD_FILE))
      if (!file) {
        log.warn('AGENTS.md é um link quebrado; a seção do app não será adicionada', { terminal: terminalId })
        return false
      }
      const state = readFileState(file)
      if (state.refused) {
        log.warn('AGENTS.md não será alterado', { terminal: terminalId, reason: state.refused })
        return false
      }
      let next: string | null
      let createdFile = prev?.createdFile ?? false
      let separator: string | null = prev?.separator ?? null
      if (!state.exists) {
        next = sectionBlock(sectionText, '\n')
        createdFile = true
        separator = ''
      } else {
        const scan = scanSection(state.content)
        if (scan.kind === 'malformed') {
          log.warn('AGENTS.md com marcadores do app malformados; nada foi alterado', { terminal: terminalId, reason: scan.reason })
          return false
        }
        if (scan.kind === 'none') {
          const res = insertSection(state.content, sectionText)
          next = res.content
          separator = res.separator
        } else {
          const replaced = replaceSection(state.content, scan, sectionText)
          next = replaced === state.content ? null : replaced
        }
      }
      // Registro antes do arquivo: um crash entre os dois ainda deixa como limpar a seção.
      this.entries[key] = { dir: cwd, file, terminals: [...alive, terminalId], createdFile, separator }
      this.persist()
      if (next !== null) {
        try {
          writeBytes(file, next, state.mode)
        } catch (err) {
          this.restoreEntry(key, prev)
          throw err
        }
      }
      this.live.add(liveKey(key, terminalId))
      return true
    } catch (err) {
      log.warn('falha ao atualizar AGENTS.md', { terminal: terminalId, code: errCode(err) })
      return false
    }
  }

  /** Libera o terminal; o último da pasta remove a seção (e o arquivo, se foi criado pelo app e ficou vazio). */
  release(cwd: string, terminalId: string): void {
    let key = dirKey(cwd)
    if (!this.live.has(liveKey(key, terminalId))) {
      // A pasta pode ter mudado de caminho real (ou sumido): procura pelo terminal. Terminal que não
      // adquiriu a seção (ex.: outro agente na mesma pasta) não mexe em nada.
      const found = Object.keys(this.entries).find((k) => this.live.has(liveKey(k, terminalId)))
      if (!found) return
      key = found
    }
    const entry = this.entries[key]
    this.live.delete(liveKey(key, terminalId))
    if (!entry) return
    const alive = entry.terminals.filter((t) => t !== terminalId && this.live.has(liveKey(key, t)))
    if (alive.length > 0) {
      entry.terminals = alive
      this.persist()
      return
    }
    this.removeFrom(entry)
    delete this.entries[key]
    this.persist()
  }

  /**
   * No início do app: remove as seções deixadas por uma sessão anterior que não encerrou direito e
   * zera o registro. Terminais adquiridos por este processo são preservados.
   */
  cleanupOrphans(): void {
    for (const [key, entry] of Object.entries(this.entries)) {
      const alive = entry.terminals.filter((t) => this.live.has(liveKey(key, t)))
      if (alive.length > 0) {
        entry.terminals = alive
        continue
      }
      this.removeFrom(entry)
      delete this.entries[key]
    }
    this.persist()
  }

  /** Diretórios com seção ativa (diagnóstico e testes). */
  activeDirs(): string[] {
    return Object.values(this.entries).map((e) => e.dir)
  }

  private removeFrom(entry: Entry): void {
    try {
      const state = readFileState(entry.file)
      if (!state.exists) return
      if (state.refused) {
        log.warn('AGENTS.md não será alterado', { reason: state.refused })
        return
      }
      const scan = scanSection(state.content)
      if (scan.kind === 'none') return
      if (scan.kind === 'malformed') {
        log.warn('AGENTS.md com marcadores do app malformados; a seção não foi removida', { reason: scan.reason })
        return
      }
      const next = removeSection(state.content, scan, entry.separator)
      if (entry.createdFile && isBlank(next)) {
        fs.unlinkSync(entry.file)
        return
      }
      writeBytes(entry.file, next, state.mode)
    } catch (err) {
      log.warn('falha ao remover a seção do AGENTS.md', { code: errCode(err) })
    }
  }

  /** Desfaz a entrada gravada antes de uma escrita que falhou. */
  private restoreEntry(key: string, prev: Entry | undefined): void {
    if (prev) this.entries[key] = prev
    else delete this.entries[key]
    this.persist()
  }

  private persist(): void {
    try {
      writeFileAtomicSync(this.registryFile, JSON.stringify({ version: 1, entries: this.entries }, null, 2))
    } catch (err) {
      log.warn('falha ao salvar o registro do AGENTS.md', { code: errCode(err) })
    }
  }
}

function liveKey(key: string, terminalId: string): string {
  return `${key}|${terminalId}`
}
