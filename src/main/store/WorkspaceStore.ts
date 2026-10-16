import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import {
  APP_NAME,
  BACKUPS_DIR,
  MAX_BACKUPS,
  NOTES_DIR,
  PARTITURAS_DIR,
  WORKSPACE_FILE,
  WORKSPACE_META_DIR
} from '@shared/constants'
import { newId } from '@shared/ids'
import type { WorkspaceOp } from '@shared/ipc'
import { WorkspaceDocSchema, type WorkspaceDoc } from '@shared/schemas'
import { applyWorkspaceOps } from '@shared/workspaceOps'
import { DebouncedWriter } from './atomicWrite'
import { log } from '../util/log'

/** Intervalo mínimo entre backups automáticos durante o uso. */
const BACKUP_INTERVAL_MS = 10 * 60 * 1000

export type OpSource = 'renderer' | 'main'

export interface LoadOutcome {
  doc: WorkspaceDoc | null
  error?: string
  backups: string[]
}

export function metaDirOf(dir: string): string {
  return path.join(dir, WORKSPACE_META_DIR)
}

export function emptyDoc(dir: string): WorkspaceDoc {
  return WorkspaceDocSchema.parse({
    version: 1,
    id: newId('ws'),
    name: path.basename(dir) || 'workspace',
    nodes: [],
    edges: []
  })
}

async function listBackups(metaDir: string): Promise<string[]> {
  try {
    const files = await fsp.readdir(path.join(metaDir, BACKUPS_DIR))
    return files.filter((f) => /^workspace-.*\.json$/.test(f)).sort().reverse()
  } catch {
    return []
  }
}

function parseDoc(text: string): { doc?: WorkspaceDoc; error?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { error: `JSON inválido: ${err instanceof Error ? err.message : String(err)}` }
  }
  const parsed = WorkspaceDocSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { error: `estrutura inválida em ${issue?.path.join('.') || '(raiz)'}: ${issue?.message ?? ''}` }
  }
  return { doc: parsed.data }
}

/** Lê workspace.json; arquivo ausente gera documento novo. */
export async function loadWorkspaceDoc(dir: string): Promise<LoadOutcome> {
  const metaDir = metaDirOf(dir)
  const file = path.join(metaDir, WORKSPACE_FILE)
  let text: string
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { doc: emptyDoc(dir), backups: [] }
    return { doc: null, error: `não foi possível ler ${WORKSPACE_FILE}`, backups: await listBackups(metaDir) }
  }
  const { doc, error } = parseDoc(text)
  if (doc) return { doc, backups: [] }
  return { doc: null, error, backups: await listBackups(metaDir) }
}

/** Primeiro backup válido (do mais recente para o mais antigo). */
export async function findValidBackup(dir: string): Promise<{ name: string; doc: WorkspaceDoc } | null> {
  const metaDir = metaDirOf(dir)
  for (const name of await listBackups(metaDir)) {
    try {
      const text = await fsp.readFile(path.join(metaDir, BACKUPS_DIR, name), 'utf8')
      const { doc } = parseDoc(text)
      if (doc) return { name, doc }
    } catch {
      // tenta o próximo
    }
  }
  return null
}

/** Garante a estrutura .maestrinho/ (e um .gitignore para arquivos locais). */
export async function ensureMetaDir(dir: string): Promise<void> {
  const metaDir = metaDirOf(dir)
  await fsp.mkdir(path.join(metaDir, NOTES_DIR), { recursive: true })
  await fsp.mkdir(path.join(metaDir, PARTITURAS_DIR), { recursive: true })
  await fsp.mkdir(path.join(metaDir, BACKUPS_DIR), { recursive: true })
  const gitignore = path.join(metaDir, '.gitignore')
  if (!fs.existsSync(gitignore)) {
    await fsp.writeFile(gitignore, `# Gerado pelo ${APP_NAME}: arquivos locais que não precisam ir para o git\nbackups/\nrun/\n`, 'utf8')
  }
}

/**
 * Documento do workspace aberto. O processo principal é a fonte da verdade; o renderer envia
 * operações (aplicadas de forma otimista do lado dele) e recebe as operações originadas no main.
 */
export class WorkspaceStore extends EventEmitter<{ ops: [WorkspaceOp[], OpSource] }> {
  readonly dir: string
  readonly metaDir: string
  private _doc: WorkspaceDoc
  private readonly writer: DebouncedWriter
  private lastBackupAt = 0

  constructor(dir: string, doc: WorkspaceDoc) {
    super()
    this.dir = path.resolve(dir)
    this.metaDir = metaDirOf(this.dir)
    this._doc = doc
    this.writer = new DebouncedWriter(path.join(this.metaDir, WORKSPACE_FILE), 400, (err) =>
      log.error('falha ao salvar workspace', err instanceof Error ? err : undefined)
    )
  }

  get doc(): WorkspaceDoc {
    return this._doc
  }

  get notesDir(): string {
    return path.join(this.metaDir, NOTES_DIR)
  }

  get partiturasDir(): string {
    return path.join(this.metaDir, PARTITURAS_DIR)
  }

  apply(ops: WorkspaceOp[], source: OpSource): void {
    if (ops.length === 0) return
    this._doc = applyWorkspaceOps(this._doc, ops)
    this.scheduleSave()
    this.emit('ops', ops, source)
  }

  /** Substitui o documento inteiro (ex.: restauração de floor). */
  replace(doc: WorkspaceDoc): void {
    this._doc = doc
    this.scheduleSave()
  }

  scheduleSave(): void {
    // O backup lê o arquivo agora, antes da escrita com debounce sobrescrevê-lo.
    void this.maybeBackup()
    this.writer.schedule(() => JSON.stringify(this._doc, null, 2))
  }

  /** Copia o workspace.json atual (antes de sobrescrever) para backups/, no máximo a cada 10 min. */
  private async maybeBackup(): Promise<void> {
    const now = Date.now()
    if (now - this.lastBackupAt < BACKUP_INTERVAL_MS) return
    this.lastBackupAt = now
    const src = path.join(this.metaDir, WORKSPACE_FILE)
    try {
      const text = await fsp.readFile(src, 'utf8')
      if (!parseDoc(text).doc) return // nunca guarda backup de arquivo inválido
      const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
      const backupsDir = path.join(this.metaDir, BACKUPS_DIR)
      await fsp.mkdir(backupsDir, { recursive: true })
      await fsp.writeFile(path.join(backupsDir, `workspace-${stamp}.json`), text, 'utf8')
      const all = await listBackups(this.metaDir)
      for (const old of all.slice(MAX_BACKUPS)) {
        await fsp.rm(path.join(backupsDir, old), { force: true })
      }
    } catch {
      // primeiro save (arquivo ainda não existe) ou falha de IO: ignora
    }
  }

  async flush(): Promise<void> {
    await this.writer.flush()
  }

  flushSync(): void {
    this.writer.flushSync()
  }
}

/** Restaura um backup (ou começa vazio se `backup` for ''), preservando o arquivo corrompido. */
export async function restoreWorkspaceBackup(dir: string, backup: string): Promise<WorkspaceDoc> {
  const metaDir = metaDirOf(dir)
  const file = path.join(metaDir, WORKSPACE_FILE)
  let doc: WorkspaceDoc
  if (backup === '') {
    doc = emptyDoc(dir)
  } else {
    if (!/^workspace-[\w.-]+\.json$/.test(backup)) throw new Error('nome de backup inválido')
    const text = await fsp.readFile(path.join(metaDir, BACKUPS_DIR, backup), 'utf8')
    const parsed = parseDoc(text)
    if (!parsed.doc) throw new Error(`backup inválido: ${parsed.error}`)
    doc = parsed.doc
  }
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await fsp.copyFile(file, path.join(metaDir, `workspace.json.corrompido-${stamp}`))
  }
  await fsp.writeFile(file, JSON.stringify(doc, null, 2), 'utf8')
  return doc
}
