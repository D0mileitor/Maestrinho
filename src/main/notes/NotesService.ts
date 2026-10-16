import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { ApiError } from '@shared/api'
import { NOTES_DIR, WORKSPACE_META_DIR } from '@shared/constants'
import { NoteFileSchema } from '@shared/schemas'
import { writeFileAtomic } from '../store/atomicWrite'
import { log } from '../util/log'
import type { NoteContent, NoteEntry, NotesApi } from './types'

/**
 * Serviço de notas: arquivos Markdown em `<workspace>/.maestrinho/notes` (um nível de subpasta).
 *
 * - Segurança de caminho: só nomes relativos que ficam dentro da pasta de notas (sem "..", sem
 *   caminhos absolutos/unidades, sem nomes reservados do Windows, sem links que levem para fora).
 * - Escritas atômicas (arquivo temporário + rename) e serializadas por arquivo.
 * - Revisão = 16 primeiros hex do SHA-256 do conteúdo (UTF-8, sem BOM); `ifRevision` divergente
 *   gera ApiError('precondition') com a revisão atual na mensagem.
 * - Watcher (chokidar) por workspace: emite `changed` quando o conteúdo muda por fora (editor,
 *   agente escrevendo direto no arquivo, salvamento atômico unlink+add) e `listChanged` quando notas
 *   surgem/somem. O eco das escritas do próprio serviço é suprimido comparando a revisão em disco
 *   com a última gravada; essas escritas (API `orq note ...`, IPC do editor) emitem `changed` /
 *   `listChanged` na hora, sem esperar o watcher.
 */

/** Tamanho máximo de uma nota em bytes (UTF-8). */
export const NOTE_MAX_BYTES = 5 * 1024 * 1024
/** Tamanho máximo do nome relativo da nota (igual ao NoteFileSchema). */
export const NOTE_FILE_MAX_LENGTH = 200
export const DEFAULT_NOTE_NAME = 'nota.md'

const MAX_UNIQUE_ATTEMPTS = 1000
const DEFAULT_DEBOUNCE_MS = 100
const DEFAULT_MAX_WAIT_MS = 600
/** Intervalo para religar o watcher quando a pasta de notas é apagada e recriada. */
const REARM_INTERVAL_MS = 1000
/** Segurança: não esperar para sempre pelo "ready" do chokidar. */
const READY_TIMEOUT_MS = 10_000
const MB = 1024 * 1024

const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin'

// ------------------------------------------------------------------ helpers puros

/** Revisão de uma nota: 16 primeiros caracteres hex do SHA-256 do conteúdo em UTF-8. */
export function noteRevision(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16)
}

/** Remove o BOM UTF-8 inicial (U+FEFF), se houver. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Pasta das notas de um workspace. */
export function notesDirOf(dir: string): string {
  return path.join(path.resolve(dir), WORKSPACE_META_DIR, NOTES_DIR)
}

/** Nomes de dispositivo do Windows (valem com qualquer extensão: "nul.md", "com1.txt.md"). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i
const ALLOWED_CHARS = /^[\p{L}\p{N} ._/-]+$/u

function segmentProblem(segment: string, isFolder: boolean): string | null {
  if (segment.length === 0) return 'o caminho tem partes vazias'
  if (segment === '.' || segment === '..') return '"." e ".." não são permitidos no caminho'
  if (segment.startsWith('.')) return 'as partes do caminho não podem começar com "."'
  if (segment.startsWith(' ')) return 'as partes do caminho não podem começar com espaço'
  if (/[. ]$/.test(segment)) return 'as partes do caminho não podem terminar com "." ou espaço'
  const stem = segment.split('.')[0]!.trimEnd()
  if (WINDOWS_RESERVED.test(stem)) return `"${stem}" é um nome reservado do Windows`
  if (isFolder && /\.md$/i.test(segment)) return 'o nome da subpasta não pode terminar em ".md"'
  return null
}

/**
 * Motivo pelo qual `file` não é um nome de nota aceitável (ou null se for válido). O nome precisa
 * ser relativo à pasta de notas, usar "/" como separador, ter no máximo uma subpasta e terminar
 * em ".md". Tudo o que passa aqui também passa no NoteFileSchema (usado pelos nós do canvas).
 */
export function noteFileProblem(file: string): string | null {
  if (typeof file !== 'string' || file.length === 0) return 'informe o nome da nota (ex.: "spec.md")'
  if (file.length > NOTE_FILE_MAX_LENGTH) return `nome longo demais (máximo ${NOTE_FILE_MAX_LENGTH} caracteres)`
  if (file.includes('\0')) return 'caractere nulo não é permitido'
  if (file.includes('\\')) return 'use "/" para separar a subpasta (ex.: "planos/sprint.md")'
  if (file.startsWith('/') || /^[a-zA-Z]:/.test(file)) {
    return 'use um caminho relativo à pasta de notas (ex.: "spec.md"), não um caminho absoluto'
  }
  if (file.includes(':')) return '":" não é permitido no nome'
  const segments = file.split('/')
  for (let i = 0; i < segments.length; i++) {
    const problem = segmentProblem(segments[i]!, i < segments.length - 1)
    if (problem) return problem
  }
  if (file.includes('..')) return '".." não é permitido no nome'
  if (segments.length > 2) return 'no máximo um nível de subpasta (ex.: "planos/sprint.md")'
  if (!file.endsWith('.md')) return 'o nome precisa terminar em ".md"'
  if (!ALLOWED_CHARS.test(file)) return 'use apenas letras, números, espaço, ".", "_", "-" e "/" no nome'
  if (!NoteFileSchema.safeParse(file).success) return 'nome de nota inválido'
  return null
}

/** Normaliza (NFC) e valida o nome de uma nota; lança ApiError('bad_request') se for inválido. */
export function normalizeNoteFile(file: string): string {
  const normalized = typeof file === 'string' ? file.normalize('NFC') : ''
  const problem = noteFileProblem(normalized)
  if (problem) throw new ApiError('bad_request', `nome de nota inválido: ${problem}`)
  return normalized
}

/**
 * Nome desejado para uma nota nova: apara espaços, normaliza (NFC) e garante a extensão ".md"
 * (minúscula). Vazio vira "nota.md". Não valida — use normalizeNoteFile depois.
 */
export function desiredNoteName(desired: string): string {
  const name = (typeof desired === 'string' ? desired : '').normalize('NFC').trim()
  if (!name) return DEFAULT_NOTE_NAME
  return /\.md$/i.test(name) ? `${name.slice(0, -3)}.md` : `${name}.md`
}

/**
 * Caminho absoluto de uma nota, garantindo (pelo caminho) que fica dentro da pasta de notas.
 * A verificação contra links simbólicos/junções é feita nas operações (realpath).
 */
export function resolveNotePath(dir: string, file: string): { notesDir: string; abs: string; file: string } {
  assertWorkspaceDir(dir)
  const normalized = normalizeNoteFile(file)
  const notesDir = notesDirOf(dir)
  const abs = path.resolve(notesDir, ...normalized.split('/'))
  const rel = path.relative(notesDir, abs)
  if (!rel || !isInside(notesDir, abs) || rel.split(path.sep).join('/') !== normalized) {
    throw new ApiError('bad_request', 'nome de nota inválido: o caminho sai da pasta de notas')
  }
  return { notesDir, abs, file: normalized }
}

function assertWorkspaceDir(dir: string): void {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    throw new ApiError('bad_request', 'diretório do workspace inválido')
  }
}

function isInside(base: string, target: string): boolean {
  const rel = path.relative(base, target)
  if (rel === '') return true
  if (path.isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith(`..${path.sep}`)
}

function dirKey(dir: string): string {
  const abs = path.resolve(dir)
  return CASE_INSENSITIVE_FS ? abs.toLowerCase() : abs
}

function fileKey(file: string): string {
  return CASE_INSENSITIVE_FS ? file.toLowerCase() : file
}

function lockKey(abs: string): string {
  return CASE_INSENSITIVE_FS ? abs.toLowerCase() : abs
}

function errCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : ''
}

/** Converte erros de sistema de arquivos em ApiError (mensagem só com o código do erro). */
function fsError(err: unknown, action: string): ApiError {
  if (err instanceof ApiError) return err
  const code = errCode(err)
  if (code === 'EACCES' || code === 'EPERM') return new ApiError('forbidden', `sem permissão para ${action} (${code})`)
  return new ApiError('internal', `não foi possível ${action}${code ? ` (${code})` : ''}`)
}

function assertSize(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > NOTE_MAX_BYTES) {
    throw new ApiError('too_large', `a nota passaria do limite de ${NOTE_MAX_BYTES / MB} MB`)
  }
}

/** Trunca por pontos de código (sem partir pares substitutos) e remove "." / espaço finais. */
function fitStem(stem: string, max: number): string {
  let out = stem
  if (out.length > max) {
    const chars = Array.from(out)
    while (chars.length > 0 && chars.join('').length > max) chars.pop()
    out = chars.join('')
  }
  out = out.replace(/[. ]+$/, '')
  return out || 'nota'
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Lê uma nota como texto (UTF-8, sem BOM). Devolve null se o arquivo não existir.
 * Antivírus/indexador no Windows podem segurar o arquivo por instantes: há novas tentativas curtas.
 */
async function readNoteText(abs: string): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    let handle: fsp.FileHandle | null = null
    try {
      handle = await fsp.open(abs, 'r')
      const st = await handle.stat()
      if (!st.isFile()) throw new ApiError('bad_request', 'o caminho da nota é uma pasta, não um arquivo')
      if (st.size > NOTE_MAX_BYTES) throw new ApiError('too_large', `a nota passa do limite de ${NOTE_MAX_BYTES / MB} MB`)
      const buf = await handle.readFile()
      return stripBom(buf.toString('utf8'))
    } catch (err) {
      if (err instanceof ApiError) throw err
      const code = errCode(err)
      if (code === 'ENOENT' || code === 'ENOTDIR') return null
      if (code === 'EISDIR') throw new ApiError('bad_request', 'o caminho da nota é uma pasta, não um arquivo')
      if ((code === 'EBUSY' || code === 'EPERM') && attempt < 3) {
        await sleep(30 * (attempt + 1))
        continue
      }
      throw fsError(err, 'ler a nota')
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }
}

// ------------------------------------------------------------------ serviço

export interface NotesServiceEvents {
  /** O conteúdo de uma nota mudou (escrita pelo serviço ou alteração externa vista pelo watcher). */
  changed: [dir: string, file: string]
  /** Notas foram criadas ou removidas no workspace. */
  listChanged: [dir: string]
}

export interface NotesServiceOptions {
  /** Janela (ms) para agrupar eventos do watcher de um mesmo arquivo (padrão 100). */
  debounceMs?: number
  /** Espera máxima (ms) antes de verificar um arquivo que não para de mudar (padrão 600). */
  maxWaitMs?: number
  /** Usa polling no watcher (pastas de rede); padrão false. */
  usePolling?: boolean
}

interface KnownState {
  file: string
  /** Revisão conhecida do conteúdo em disco; null = arquivo não existe. */
  rev: string | null
}

interface PendingCheck {
  file: string
  timer: NodeJS.Timeout
  firstAt: number
  /** O evento indicou criação/remoção (add/unlink). */
  listHint: boolean
}

interface WatchState {
  dir: string
  notesDir: string
  watcher: FSWatcher | null
  /** Última revisão conhecida por arquivo (gravada pelo serviço ou vista pelo watcher). */
  known: Map<string, KnownState>
  /** Notas já lidas/listadas/escritas: verificadas quando a pasta some e volta. */
  seen: Map<string, string>
  /** Contador de escritas próprias por arquivo (uma verificação que cruzou uma escrita é refeita). */
  ownWrites: Map<string, number>
  pending: Map<string, PendingCheck>
  listTimer: NodeJS.Timeout | null
  rearmTimer: NodeJS.Timeout | null
  closed: boolean
  ready: Promise<void>
}

export class NotesService extends EventEmitter<NotesServiceEvents> implements NotesApi {
  private readonly watchers = new Map<string, WatchState>()
  private readonly locks = new Map<string, Promise<void>>()
  private readonly debounceMs: number
  private readonly maxWaitMs: number
  private readonly usePolling: boolean

  constructor(opts: NotesServiceOptions = {}) {
    super()
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS
    this.usePolling = opts.usePolling ?? false
  }

  /** Pasta das notas do workspace. */
  notesDir(dir: string): string {
    return notesDirOf(dir)
  }

  // ---------------------------------------------------------------- leitura

  async list(dir: string): Promise<NoteEntry[]> {
    assertWorkspaceDir(dir)
    const notesDir = notesDirOf(dir)
    let realBase: string
    try {
      realBase = await fsp.realpath(notesDir)
    } catch {
      return []
    }
    const files: string[] = []
    const root = await fsp.readdir(notesDir, { withFileTypes: true }).catch(() => [])
    for (const ent of root) {
      if (ent.isFile()) {
        if (!noteFileProblem(ent.name)) files.push(ent.name)
      } else if (ent.isDirectory() && !segmentProblem(ent.name, true)) {
        // Subpasta real (links são ignorados): confere que continua dentro da pasta de notas.
        const sub = path.join(notesDir, ent.name)
        const realSub = await fsp.realpath(sub).catch(() => null)
        if (!realSub || !isInside(realBase, realSub)) continue
        const children = await fsp.readdir(sub, { withFileTypes: true }).catch(() => [])
        for (const child of children) {
          const rel = `${ent.name}/${child.name}`
          if (child.isFile() && !noteFileProblem(rel)) files.push(rel)
        }
      }
    }
    const entries = await Promise.all(
      files.map(async (file): Promise<NoteEntry | null> => {
        try {
          const st = await fsp.stat(path.join(notesDir, ...file.split('/')))
          return st.isFile() ? { file, size: st.size, mtimeMs: st.mtimeMs } : null
        } catch {
          return null
        }
      })
    )
    // Ordem natural pelo nome sem ".md": "nota", "nota-2", "nota-10", "planos/sprint".
    const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })
    const stem = (f: string): string => f.slice(0, -'.md'.length)
    const out = entries
      .filter((e): e is NoteEntry => e !== null)
      .sort((a, b) => collator.compare(stem(a.file), stem(b.file)) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    for (const e of out) this.markSeen(dir, e.file)
    return out
  }

  async exists(dir: string, file: string): Promise<boolean> {
    const { abs } = resolveNotePath(dir, file)
    try {
      return (await fsp.stat(abs)).isFile()
    } catch {
      return false
    }
  }

  async read(dir: string, file: string): Promise<NoteContent> {
    const { notesDir, abs, file: name } = resolveNotePath(dir, file)
    this.markSeen(dir, name)
    await this.assertRealInside(notesDir, abs, name, true)
    const content = await readNoteText(abs)
    if (content === null) throw new ApiError('not_found', `a nota "${name}" não existe`)
    return { content, revision: noteRevision(content) }
  }

  // ---------------------------------------------------------------- escrita

  async write(dir: string, file: string, content: string, ifRevision?: string): Promise<{ revision: string }> {
    const { notesDir, abs, file: name } = resolveNotePath(dir, file)
    if (typeof content !== 'string') throw new ApiError('bad_request', 'conteúdo da nota inválido')
    const text = stripBom(content)
    assertSize(text)
    return this.exclusive(lockKey(abs), async () => {
      await this.prepareDir(notesDir, abs, name, true)
      const current = await readNoteText(abs)
      const currentRev = current === null ? null : noteRevision(current)
      if (typeof ifRevision === 'string') {
        const expected = ifRevision.trim().toLowerCase()
        if (currentRev !== expected) {
          const wanted = `revisão esperada ${expected || '(vazia)'}`
          throw new ApiError(
            'precondition',
            currentRev === null
              ? `a nota "${name}" não existe mais (${wanted}, atual: nenhuma)`
              : `a nota "${name}" mudou desde a última leitura (${wanted}, atual ${currentRev}); ` +
                  'leia a nota de novo e reaplique a alteração'
          )
        }
      }
      const revision = noteRevision(text)
      if (current !== null && currentRev === revision) return { revision }
      await this.commit(dir, name, abs, text, revision, current === null)
      return { revision }
    })
  }

  async append(dir: string, file: string, content: string): Promise<{ revision: string }> {
    const { notesDir, abs, file: name } = resolveNotePath(dir, file)
    if (typeof content !== 'string') throw new ApiError('bad_request', 'conteúdo da nota inválido')
    const addition = stripBom(content)
    return this.exclusive(lockKey(abs), async () => {
      await this.prepareDir(notesDir, abs, name, true)
      const current = await readNoteText(abs)
      if (current !== null && addition === '') return { revision: noteRevision(current) }
      const base = current ?? ''
      // Separa do conteúdo anterior com uma quebra de linha (no estilo de quebra do arquivo).
      const sep = base.length > 0 && !base.endsWith('\n') ? (base.includes('\r\n') ? '\r\n' : '\n') : ''
      const text = base + sep + addition
      assertSize(text)
      const revision = noteRevision(text)
      await this.commit(dir, name, abs, text, revision, current === null)
      return { revision }
    })
  }

  async create(dir: string, desired: string, content = ''): Promise<string> {
    const { notesDir, abs, file: normalized } = resolveNotePath(dir, desiredNoteName(desired))
    if (typeof content !== 'string') throw new ApiError('bad_request', 'conteúdo da nota inválido')
    const text = stripBom(content)
    assertSize(text)
    const folder = path.dirname(abs)
    const slash = normalized.lastIndexOf('/')
    const prefix = slash >= 0 ? normalized.slice(0, slash + 1) : ''
    const stem = normalized.slice(prefix.length, -'.md'.length)
    return this.exclusive(`${lockKey(folder)}|create`, async () => {
      // A abertura exclusiva ("wx") nunca segue links; basta conferir a pasta.
      await this.prepareDir(notesDir, abs, normalized, false)
      const existing = await fsp.readdir(folder).catch(() => [] as string[])
      const taken = new Set(existing.map((n) => n.normalize('NFC').toLowerCase()))
      for (let i = 1; i <= MAX_UNIQUE_ATTEMPTS; i++) {
        const suffix = i === 1 ? '' : `-${i}`
        const base = `${fitStem(stem, NOTE_FILE_MAX_LENGTH - prefix.length - suffix.length - '.md'.length)}${suffix}.md`
        if (taken.has(base.toLowerCase())) continue
        taken.add(base.toLowerCase())
        const candidate = prefix + base
        if (noteFileProblem(candidate)) continue
        const target = path.join(folder, base)
        const created = await this.exclusive(lockKey(target), () => this.createExclusive(dir, candidate, target, text))
        if (created) return candidate
      }
      throw new ApiError('conflict', 'não foi possível gerar um nome único para a nota')
    })
  }

  /** Cria a pasta (se preciso) e confere, pelo caminho real, que ela fica dentro da pasta de notas. */
  private async prepareDir(notesDir: string, abs: string, name: string, checkFile: boolean): Promise<void> {
    try {
      await fsp.mkdir(path.dirname(abs), { recursive: true })
    } catch (err) {
      const code = errCode(err)
      if (code === 'EEXIST' || code === 'ENOTDIR') {
        throw new ApiError('conflict', 'já existe um arquivo com o nome da subpasta da nota')
      }
      throw fsError(err, 'criar a pasta da nota')
    }
    await this.assertRealInside(notesDir, abs, name, checkFile)
  }

  /**
   * Defesa extra contra links simbólicos/junções: a pasta da nota (e o arquivo, se for link)
   * precisam continuar dentro da pasta de notas depois de resolvidos.
   */
  private async assertRealInside(notesDir: string, abs: string, name: string, checkFile: boolean): Promise<void> {
    let realBase: string
    try {
      realBase = await fsp.realpath(notesDir)
    } catch (err) {
      if (errCode(err) === 'ENOENT') throw new ApiError('not_found', `a nota "${name}" não existe`)
      throw fsError(err, 'acessar a pasta de notas')
    }
    let realParent: string | null = null
    try {
      realParent = await fsp.realpath(path.dirname(abs))
    } catch (err) {
      const code = errCode(err)
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw fsError(err, 'acessar a pasta da nota')
    }
    if (realParent !== null && !isInside(realBase, realParent)) {
      throw new ApiError('forbidden', 'a nota aponta para fora da pasta de notas (link simbólico ou junção)')
    }
    if (!checkFile) return
    const st = await fsp.lstat(abs).catch(() => null)
    if (!st?.isSymbolicLink()) return
    const realTarget = await fsp.realpath(abs).catch(() => null)
    if (!realTarget || !isInside(realBase, realTarget)) {
      throw new ApiError('forbidden', 'a nota aponta para fora da pasta de notas (link simbólico)')
    }
  }

  /** Grava o conteúdo (atômico) e avisa os ouvintes. A revisão esperada é registrada antes do rename. */
  private async commit(
    dir: string,
    file: string,
    abs: string,
    text: string,
    revision: string,
    created: boolean
  ): Promise<void> {
    const undo = this.expectRevision(dir, file, revision)
    try {
      await writeFileAtomic(abs, text)
    } catch (err) {
      undo()
      log.warn('notas: falha ao gravar', { code: errCode(err), bytes: Buffer.byteLength(text, 'utf8') })
      throw fsError(err, 'gravar a nota')
    }
    const evDir = this.eventDir(dir)
    this.safeEmit('changed', evDir, file)
    if (created) this.safeEmit('listChanged', evDir)
  }

  /** Criação exclusiva (nunca sobrescreve): false se o arquivo já existir. */
  private async createExclusive(dir: string, file: string, abs: string, text: string): Promise<boolean> {
    const undo = this.expectRevision(dir, file, noteRevision(text))
    let handle: fsp.FileHandle
    try {
      handle = await fsp.open(abs, 'wx')
    } catch (err) {
      undo()
      if (errCode(err) === 'EEXIST') return false
      throw fsError(err, 'criar a nota')
    }
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } catch (err) {
      undo()
      await handle.close().catch(() => undefined)
      await fsp.rm(abs, { force: true }).catch(() => undefined)
      throw fsError(err, 'gravar a nota')
    }
    await handle.close()
    const evDir = this.eventDir(dir)
    this.safeEmit('changed', evDir, file)
    this.safeEmit('listChanged', evDir)
    return true
  }

  /**
   * Registra a revisão que o próprio serviço vai gravar, para o watcher ignorar o eco.
   * Devolve a função que desfaz o registro (escrita falhou).
   */
  private expectRevision(dir: string, file: string, revision: string): () => void {
    const state = this.watchers.get(dirKey(dir))
    if (!state) return () => undefined
    const key = fileKey(file)
    state.seen.set(key, file)
    state.ownWrites.set(key, (state.ownWrites.get(key) ?? 0) + 1)
    const prev = state.known.get(key)
    const entry: KnownState = { file, rev: revision }
    state.known.set(key, entry)
    return () => {
      if (state.known.get(key) !== entry) return
      if (prev) state.known.set(key, prev)
      else state.known.delete(key)
    }
  }

  private markSeen(dir: string, file: string): void {
    const state = this.watchers.get(dirKey(dir))
    if (state) state.seen.set(fileKey(file), file)
  }

  /** `dir` usado nos eventos: o mesmo texto passado a watch(), quando observado. */
  private eventDir(dir: string): string {
    return this.watchers.get(dirKey(dir))?.dir ?? path.resolve(dir)
  }

  /** Um ouvinte com erro não pode transformar uma escrita bem-sucedida em falha. */
  private safeEmit<K extends keyof NotesServiceEvents>(event: K, ...args: NotesServiceEvents[K]): void {
    try {
      ;(this.emit as (e: K, ...a: NotesServiceEvents[K]) => boolean)(event, ...args)
    } catch (err) {
      log.warn('notas: ouvinte de evento falhou', { event, error: err instanceof Error ? err.name : 'erro' })
    }
  }

  /** Serializa operações por chave (fila de promessas; a fila nunca fica rejeitada). */
  private async exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.locks.set(key, tail)
    await previous
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(key) === tail) this.locks.delete(key)
    }
  }

  // ---------------------------------------------------------------- watcher

  isWatching(dir: string): boolean {
    return this.watchers.has(dirKey(dir))
  }

  /** Começa a observar a pasta de notas do workspace (idempotente). Resolve quando o watcher está pronto. */
  watch(dir: string): Promise<void> {
    const abs = path.resolve(dir)
    const key = dirKey(abs)
    const existing = this.watchers.get(key)
    if (existing) return existing.ready
    const state: WatchState = {
      dir: abs,
      notesDir: notesDirOf(abs),
      watcher: null,
      known: new Map(),
      seen: new Map(),
      ownWrites: new Map(),
      pending: new Map(),
      listTimer: null,
      rearmTimer: null,
      closed: false,
      ready: Promise.resolve()
    }
    this.watchers.set(key, state)
    state.ready = this.startWatcher(state, true)
    return state.ready
  }

  /** Para de observar o workspace e libera timers e handles. */
  async unwatch(dir: string): Promise<void> {
    const key = dirKey(dir)
    const state = this.watchers.get(key)
    if (!state) return
    this.watchers.delete(key)
    await this.disposeState(state)
  }

  /** Fecha todos os watchers (encerramento do app/testes). */
  async closeAll(): Promise<void> {
    const states = [...this.watchers.values()]
    this.watchers.clear()
    await Promise.all(states.map((s) => this.disposeState(s)))
  }

  private async disposeState(state: WatchState): Promise<void> {
    state.closed = true
    for (const p of state.pending.values()) clearTimeout(p.timer)
    state.pending.clear()
    if (state.listTimer) clearTimeout(state.listTimer)
    state.listTimer = null
    if (state.rearmTimer) clearInterval(state.rearmTimer)
    state.rearmTimer = null
    await state.ready.catch(() => undefined)
    const w = state.watcher
    state.watcher = null
    if (w) await w.close().catch(() => undefined)
  }

  private async startWatcher(state: WatchState, createDir: boolean): Promise<void> {
    if (createDir) {
      try {
        await fsp.mkdir(state.notesDir, { recursive: true })
      } catch (err) {
        log.warn('notas: não foi possível criar a pasta de notas', { code: errCode(err) })
      }
    }
    if (state.closed) return
    await this.seedSeen(state)
    if (state.closed) return
    const notesDir = state.notesDir
    let w: FSWatcher
    try {
      w = chokidarWatch(notesDir, {
        ignoreInitial: true,
        depth: 1,
        usePolling: this.usePolling,
        interval: 250,
        ignored: (p: string, stats?: fs.Stats) => ignoredPath(notesDir, p, stats)
      })
    } catch (err) {
      log.warn('notas: falha ao iniciar o watcher', { code: errCode(err) })
      return
    }
    state.watcher = w
    w.on('all', (event, p) => {
      // Eventos atrasados de um watcher já substituído (pasta apagada e recriada) são descartados.
      if (state.watcher === w) this.onFsEvent(state, event, p)
    })
    w.on('error', (err) => log.warn('notas: erro no watcher', { code: errCode(err) }))
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, READY_TIMEOUT_MS)
      timer.unref()
      w.once('ready', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    if (state.closed && state.watcher === w) {
      state.watcher = null
      await w.close().catch(() => undefined)
    }
  }

  /** Registra as notas que já existem (para avisar a remoção se a pasta inteira sumir). */
  private async seedSeen(state: WatchState): Promise<void> {
    const root = await fsp.readdir(state.notesDir, { withFileTypes: true }).catch(() => [])
    for (const ent of root) {
      if (ent.isFile()) {
        if (!noteFileProblem(ent.name)) state.seen.set(fileKey(ent.name), ent.name)
      } else if (ent.isDirectory() && !segmentProblem(ent.name, true)) {
        const children = await fsp.readdir(path.join(state.notesDir, ent.name), { withFileTypes: true }).catch(() => [])
        for (const child of children) {
          const rel = `${ent.name}/${child.name}`
          if (child.isFile() && !noteFileProblem(rel)) state.seen.set(fileKey(rel), rel)
        }
      }
    }
  }

  private onFsEvent(state: WatchState, event: string, p: string): void {
    if (state.closed) return
    const rel = path.relative(state.notesDir, p)
    if (rel === '') {
      if (event === 'unlinkDir') this.onRootRemoved(state)
      return
    }
    if (!isInside(state.notesDir, p)) return
    if (event === 'unlink' || event === 'unlinkDir') this.checkRootGone(state)
    const file = rel.split(path.sep).join('/')
    if (event === 'add' || event === 'change' || event === 'unlink') {
      if (noteFileProblem(file)) return
      this.scheduleCheck(state, file, event !== 'change')
    } else if (event === 'addDir' || event === 'unlinkDir') {
      this.scheduleList(state)
      if (event === 'unlinkDir') {
        // Notas conhecidas dentro da subpasta removida passam a "não existe".
        const prefix = fileKey(`${file}/`)
        for (const [key, seen] of state.seen) if (key.startsWith(prefix)) this.scheduleCheck(state, seen, true)
      }
    }
  }

  /**
   * Algo foi removido dentro da pasta: confere se a própria pasta sumiu. No Linux (inotify) o chokidar
   * avisa a remoção dos arquivos, mas nem sempre a da raiz observada; sem isso o watcher ficaria preso à
   * pasta antiga e não veria a recriada. Confere de novo logo depois, porque o rm apaga a raiz por último.
   */
  private checkRootGone(state: WatchState): void {
    const w = state.watcher
    const check = (): void => {
      if (state.closed || !w || state.watcher !== w) return
      if (!fs.existsSync(state.notesDir)) this.onRootRemoved(state)
    }
    check()
    setTimeout(check, 250).unref()
  }

  /** A pasta de notas sumiu: fecha o watcher e religa quando ela voltar a existir. */
  private onRootRemoved(state: WatchState): void {
    const w = state.watcher
    state.watcher = null
    if (w) void w.close().catch(() => undefined)
    for (const seen of state.seen.values()) this.scheduleCheck(state, seen, true)
    this.scheduleList(state)
    if (state.rearmTimer || state.closed) return
    const timer = setInterval(() => {
      if (state.closed) {
        clearInterval(timer)
        return
      }
      if (!fs.existsSync(state.notesDir)) return
      clearInterval(timer)
      state.rearmTimer = null
      state.ready = this.startWatcher(state, false).then(() => {
        if (state.closed) return
        // O que mudou enquanto a pasta não existia.
        for (const seen of state.seen.values()) this.scheduleCheck(state, seen, true)
        this.scheduleList(state)
      })
    }, REARM_INTERVAL_MS)
    timer.unref()
    state.rearmTimer = timer
  }

  private scheduleCheck(state: WatchState, file: string, listHint: boolean): void {
    if (state.closed) return
    const key = fileKey(file)
    const now = Date.now()
    const pending = state.pending.get(key)
    if (pending) {
      pending.listHint = pending.listHint || listHint
      // Arquivo que não para de mudar: não adia além da espera máxima.
      if (now - pending.firstAt >= this.maxWaitMs) return
      clearTimeout(pending.timer)
      pending.timer = setTimeout(() => this.runCheck(state, key), this.debounceMs)
      return
    }
    state.pending.set(key, {
      file,
      listHint,
      firstAt: now,
      timer: setTimeout(() => this.runCheck(state, key), this.debounceMs)
    })
  }

  private runCheck(state: WatchState, key: string): void {
    const pending = state.pending.get(key)
    if (!pending) return
    state.pending.delete(key)
    if (state.closed) return
    const abs = path.join(state.notesDir, ...pending.file.split('/'))
    // Escrita própria em andamento: verifica depois que ela terminar.
    if (this.locks.has(lockKey(abs))) {
      this.scheduleCheck(state, pending.file, pending.listHint)
      return
    }
    void this.checkFile(state, pending.file, abs, pending.listHint)
  }

  private async checkFile(state: WatchState, file: string, abs: string, listHint: boolean): Promise<void> {
    const key = fileKey(file)
    const writesBefore = state.ownWrites.get(key) ?? 0
    let rev: string | null
    try {
      const text = await readNoteText(abs)
      rev = text === null ? null : noteRevision(text)
    } catch {
      // Ilegível no momento (grande demais, bloqueado...): avisa assim mesmo; a leitura explica o erro.
      rev = `indisponivel:${Date.now()}`
    }
    if (state.closed) return
    // Uma escrita própria começou durante a leitura: o que lemos pode ser o conteúdo anterior.
    if ((state.ownWrites.get(key) ?? 0) !== writesBefore || this.locks.has(lockKey(abs))) {
      this.scheduleCheck(state, file, listHint)
      return
    }
    state.seen.set(key, file)
    const prev = state.known.get(key)
    if (prev && prev.rev === rev) return
    state.known.set(key, { file, rev })
    this.safeEmit('changed', state.dir, file)
    const existsNow = rev !== null
    const listChanged = prev ? (prev.rev !== null) !== existsNow : listHint
    if (listChanged) this.scheduleList(state)
  }

  private scheduleList(state: WatchState): void {
    if (state.closed) return
    if (state.listTimer) clearTimeout(state.listTimer)
    state.listTimer = setTimeout(() => {
      state.listTimer = null
      if (!state.closed) this.safeEmit('listChanged', state.dir)
    }, this.debounceMs)
  }
}

/** Filtro do watcher: só notas .md até um nível de subpasta; ignora temporários e ocultos. */
function ignoredPath(notesDir: string, p: string, stats?: fs.Stats): boolean {
  const rel = path.relative(notesDir, p)
  if (rel === '') return false
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) return true
  const segments = rel.split(path.sep)
  if (segments.length > 2) return true
  if (segments.some((s) => s.startsWith('.'))) return true
  if (stats?.isFile() && !p.endsWith('.md')) return true
  if (stats?.isDirectory() && segments.length > 1) return true
  return false
}
