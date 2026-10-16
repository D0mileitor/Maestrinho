import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKUPS_DIR, MAX_BACKUPS, NOTES_DIR, PARTITURAS_DIR, WORKSPACE_FILE, WORKSPACE_META_DIR } from '@shared/constants'
import type { WorkspaceOp } from '@shared/ipc'
import { WorkspaceDocSchema, type TerminalNodeData, type WorkspaceDoc } from '@shared/schemas'
import {
  WorkspaceStore,
  emptyDoc,
  ensureMetaDir,
  findValidBackup,
  loadWorkspaceDoc,
  metaDirOf,
  restoreWorkspaceBackup,
  type OpSource
} from './WorkspaceStore'

let dir = ''
let meta = ''
let wsFile = ''
let backupsDir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-ws-'))
  meta = path.join(dir, WORKSPACE_META_DIR)
  wsFile = path.join(meta, WORKSPACE_FILE)
  backupsDir = path.join(meta, BACKUPS_DIR)
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function terminal(id: string, name = id): TerminalNodeData {
  return {
    id,
    kind: 'terminal',
    name,
    presetId: 'shell',
    cwd: '',
    autoStart: true,
    position: { x: 0, y: 0 },
    size: { w: 400, h: 300 }
  }
}

function validDoc(name = 'Projeto', nodes: TerminalNodeData[] = []): WorkspaceDoc {
  return WorkspaceDocSchema.parse({ version: 1, id: 'ws-teste', name, nodes })
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}

const listBackups = (): string[] => (fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).sort() : [])

describe('metaDirOf / emptyDoc', () => {
  it('a pasta de metadados fica dentro do projeto', () => {
    expect(metaDirOf(dir)).toBe(path.join(dir, WORKSPACE_META_DIR))
    expect(WORKSPACE_META_DIR).toBe('.maestrinho')
  })

  it('documento novo: versão 1, nome da pasta, sem nós/conexões/floors e viewport padrão', () => {
    const doc = emptyDoc(dir)
    expect(doc).toMatchObject({ version: 1, name: path.basename(dir), nodes: [], edges: [], floors: [] })
    expect(doc.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(doc.id).toMatch(/^ws-[0-9a-z]{10}$/)
    expect(emptyDoc(dir).id).not.toBe(doc.id)
  })

  it('na raiz do disco (sem nome de pasta) usa "workspace"', () => {
    expect(emptyDoc(path.parse(dir).root).name).toBe('workspace')
  })
})

describe('loadWorkspaceDoc', () => {
  it('workspace.json ausente: documento novo e nenhum backup', async () => {
    const out = await loadWorkspaceDoc(dir)
    expect(out.error).toBeUndefined()
    expect(out.backups).toEqual([])
    expect(out.doc).toMatchObject({ version: 1, name: path.basename(dir), nodes: [] })
    // Carregar não cria nada no disco.
    expect(fs.existsSync(meta)).toBe(false)
  })

  it('workspace.json válido é carregado (com defaults do schema aplicados)', async () => {
    writeJson(wsFile, { version: 1, id: 'ws-1', name: 'Meu', nodes: [terminal('t1')] })
    const out = await loadWorkspaceDoc(dir)
    expect(out.doc?.name).toBe('Meu')
    expect(out.doc?.nodes.map((n) => n.id)).toEqual(['t1'])
    expect(out.doc?.edges).toEqual([])
    expect(out.doc?.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('JSON corrompido: doc null, erro claro e backups listados do mais novo para o mais antigo', async () => {
    writeJson(wsFile, '{"version": 1, "nodes": [')
    writeJson(path.join(backupsDir, 'workspace-2026-01-01T00-00-00-000Z.json'), validDoc())
    writeJson(path.join(backupsDir, 'workspace-2026-02-01T00-00-00-000Z.json'), validDoc())
    writeJson(path.join(backupsDir, 'anotacoes.txt'), 'não é backup')
    const out = await loadWorkspaceDoc(dir)
    expect(out.doc).toBeNull()
    expect(out.error).toMatch(/^JSON inválido: /)
    expect(out.backups).toEqual(['workspace-2026-02-01T00-00-00-000Z.json', 'workspace-2026-01-01T00-00-00-000Z.json'])
  })

  it('estrutura inválida: doc null e erro com o caminho do campo', async () => {
    writeJson(wsFile, { version: 1, id: 'ws-1', name: 'x', nodes: [{ id: 't1', kind: 'terminal' }] })
    const out = await loadWorkspaceDoc(dir)
    expect(out.doc).toBeNull()
    expect(out.error).toMatch(/^estrutura inválida em nodes\.0/)
    writeJson(wsFile, { version: 2, id: 'ws-1', name: 'x' })
    expect((await loadWorkspaceDoc(dir)).error).toMatch(/^estrutura inválida em version/)
  })

  it('arquivo ilegível (é um diretório): doc null com erro de leitura', async () => {
    fs.mkdirSync(wsFile, { recursive: true })
    const out = await loadWorkspaceDoc(dir)
    expect(out.doc).toBeNull()
    expect(out.error).toBe(`não foi possível ler ${WORKSPACE_FILE}`)
    expect(out.backups).toEqual([])
  })
})

describe('findValidBackup', () => {
  it('pula backups inválidos e devolve o mais novo que é válido', async () => {
    writeJson(path.join(backupsDir, 'workspace-2026-03-01T00-00-00-000Z.json'), '{corrompido')
    writeJson(path.join(backupsDir, 'workspace-2026-02-01T00-00-00-000Z.json'), { version: 1, name: 'sem id' })
    writeJson(path.join(backupsDir, 'workspace-2026-01-15T00-00-00-000Z.json'), validDoc('bom'))
    writeJson(path.join(backupsDir, 'workspace-2026-01-01T00-00-00-000Z.json'), validDoc('antigo'))
    const found = await findValidBackup(dir)
    expect(found?.name).toBe('workspace-2026-01-15T00-00-00-000Z.json')
    expect(found?.doc.name).toBe('bom')
  })

  it('sem backups válidos (ou sem pasta de backups) devolve null', async () => {
    expect(await findValidBackup(dir)).toBeNull()
    writeJson(path.join(backupsDir, 'workspace-2026-01-01T00-00-00-000Z.json'), '[]')
    expect(await findValidBackup(dir)).toBeNull()
  })
})

describe('restoreWorkspaceBackup', () => {
  const backupName = 'workspace-2026-01-15T10-00-00-000Z.json'

  it('restaura o backup e preserva uma cópia do arquivo corrompido', async () => {
    const corrupted = '{"version": 1, "nodes": [ ... corrompido'
    writeJson(wsFile, corrupted)
    writeJson(path.join(backupsDir, backupName), validDoc('restaurado', [terminal('t1')]))
    const doc = await restoreWorkspaceBackup(dir, backupName)
    expect(doc.name).toBe('restaurado')
    expect(WorkspaceDocSchema.parse(JSON.parse(fs.readFileSync(wsFile, 'utf8')))).toEqual(doc)
    const copies = fs.readdirSync(meta).filter((f) => f.startsWith(`${WORKSPACE_FILE}.corrompido-`))
    expect(copies).toHaveLength(1)
    expect(fs.readFileSync(path.join(meta, copies[0]!), 'utf8')).toBe(corrupted)
    expect((await loadWorkspaceDoc(dir)).doc?.name).toBe('restaurado')
  })

  it('backup "" começa um documento vazio, também preservando o corrompido', async () => {
    writeJson(wsFile, 'lixo')
    const doc = await restoreWorkspaceBackup(dir, '')
    expect(doc.nodes).toEqual([])
    expect(doc.name).toBe(path.basename(dir))
    expect(fs.readdirSync(meta).some((f) => f.startsWith(`${WORKSPACE_FILE}.corrompido-`))).toBe(true)
  })

  it('sem workspace.json existente, apenas grava o restaurado (sem cópia)', async () => {
    writeJson(path.join(backupsDir, backupName), validDoc('ok'))
    await restoreWorkspaceBackup(dir, backupName)
    expect(fs.readdirSync(meta).filter((f) => f.includes('corrompido'))).toEqual([])
    expect(JSON.parse(fs.readFileSync(wsFile, 'utf8')).name).toBe('ok')
  })

  it('rejeita nomes de backup fora do padrão (inclusive tentativas de sair da pasta)', async () => {
    writeJson(path.join(meta, 'segredo.json'), validDoc())
    for (const name of ['../segredo.json', 'workspace-../../segredo.json', 'workspace-a/b.json', 'outro.json', 'workspace-x.txt']) {
      await expect(restoreWorkspaceBackup(dir, name), name).rejects.toThrow('nome de backup inválido')
    }
  })

  it('backup com conteúdo inválido é recusado e não altera o workspace.json atual', async () => {
    writeJson(wsFile, 'atual')
    writeJson(path.join(backupsDir, backupName), { version: 1 })
    await expect(restoreWorkspaceBackup(dir, backupName)).rejects.toThrow(/^backup inválido: /)
    expect(fs.readFileSync(wsFile, 'utf8')).toBe('atual')
    expect(fs.readdirSync(meta).filter((f) => f.includes('corrompido'))).toEqual([])
  })
})

describe('ensureMetaDir', () => {
  it('cria notes/, partituras/, backups/ e um .gitignore para arquivos locais', async () => {
    await ensureMetaDir(dir)
    for (const sub of [NOTES_DIR, PARTITURAS_DIR, BACKUPS_DIR]) {
      expect(fs.statSync(path.join(meta, sub)).isDirectory()).toBe(true)
    }
    const gitignore = fs.readFileSync(path.join(meta, '.gitignore'), 'utf8')
    expect(gitignore.split('\n')).toEqual(expect.arrayContaining(['backups/', 'run/']))
  })

  it('é idempotente e não sobrescreve um .gitignore existente do usuário', async () => {
    await ensureMetaDir(dir)
    fs.writeFileSync(path.join(meta, '.gitignore'), '# meu\n*\n')
    fs.writeFileSync(path.join(meta, NOTES_DIR, 'nota.md'), '# minha nota')
    await ensureMetaDir(dir)
    expect(fs.readFileSync(path.join(meta, '.gitignore'), 'utf8')).toBe('# meu\n*\n')
    expect(fs.readFileSync(path.join(meta, NOTES_DIR, 'nota.md'), 'utf8')).toBe('# minha nota')
  })
})

describe('WorkspaceStore', () => {
  const stores: WorkspaceStore[] = []
  const makeStore = (doc: WorkspaceDoc, at = dir): WorkspaceStore => {
    const s = new WorkspaceStore(at, doc)
    stores.push(s)
    return s
  }

  afterEach(async () => {
    // Garante que nenhuma escrita agendada rode depois que a pasta temporária for apagada.
    for (const s of stores.splice(0)) await s.flush()
  })

  it('expõe dir resolvido e as pastas de metadados/notas/partituras', () => {
    const s = makeStore(emptyDoc(dir), path.join(dir, '.', 'sub', '..'))
    expect(s.dir).toBe(path.resolve(dir))
    expect(s.metaDir).toBe(meta)
    expect(s.notesDir).toBe(path.join(meta, NOTES_DIR))
    expect(s.partiturasDir).toBe(path.join(meta, PARTITURAS_DIR))
  })

  it('apply atualiza o documento, emite as ops com a origem e persiste após o flush', async () => {
    const s = makeStore(emptyDoc(dir))
    const events: [WorkspaceOp[], OpSource][] = []
    s.on('ops', (ops, source) => events.push([ops, source]))
    const ops: WorkspaceOp[] = [{ op: 'addNodes', nodes: [terminal('t1', 'construtor')] }, { op: 'setName', name: 'Novo' }]
    s.apply(ops, 'renderer')
    expect(s.doc.name).toBe('Novo')
    expect(events).toEqual([[ops, 'renderer']])
    await s.flush()
    const saved = WorkspaceDocSchema.parse(JSON.parse(fs.readFileSync(wsFile, 'utf8')))
    expect(saved).toEqual(s.doc)
    expect((await loadWorkspaceDoc(dir)).doc).toEqual(s.doc)
  })

  it('a gravação acontece sozinha após o debounce (sem flush explícito)', async () => {
    const s = makeStore(emptyDoc(dir))
    s.apply([{ op: 'setName', name: 'Sozinho' }], 'main')
    expect(fs.existsSync(wsFile)).toBe(false)
    await vi.waitFor(() => expect(JSON.parse(fs.readFileSync(wsFile, 'utf8')).name).toBe('Sozinho'), {
      timeout: 5000,
      interval: 50
    })
  })

  it('várias ops seguidas resultam numa única gravação com o estado final', async () => {
    const s = makeStore(emptyDoc(dir))
    for (let i = 0; i < 20; i++) s.apply([{ op: 'setViewport', viewport: { x: i, y: 0, zoom: 1 } }], 'renderer')
    await s.flush()
    expect(JSON.parse(fs.readFileSync(wsFile, 'utf8')).viewport.x).toBe(19)
    expect(fs.readdirSync(meta).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('lista de ops vazia não emite evento nem grava', async () => {
    const s = makeStore(emptyDoc(dir))
    let emitted = 0
    s.on('ops', () => emitted++)
    s.apply([], 'renderer')
    await s.flush()
    expect(emitted).toBe(0)
    expect(fs.existsSync(wsFile)).toBe(false)
  })

  it('flushSync grava imediatamente (encerramento do app)', () => {
    const s = makeStore(emptyDoc(dir))
    s.apply([{ op: 'setName', name: 'Fechando' }], 'renderer')
    s.flushSync()
    expect(JSON.parse(fs.readFileSync(wsFile, 'utf8')).name).toBe('Fechando')
  })

  it('replace substitui o documento inteiro e agenda a gravação', async () => {
    const s = makeStore(emptyDoc(dir))
    s.replace(validDoc('Substituído', [terminal('t9')]))
    expect(s.doc.name).toBe('Substituído')
    await s.flush()
    expect(JSON.parse(fs.readFileSync(wsFile, 'utf8')).nodes[0].id).toBe('t9')
  })

  it('antes de sobrescrever, guarda backup do workspace.json válido anterior (no máximo um por intervalo)', async () => {
    writeJson(wsFile, validDoc('versão em disco'))
    const loaded = await loadWorkspaceDoc(dir)
    const s = makeStore(loaded.doc!)
    s.apply([{ op: 'setName', name: 'versão nova' }], 'renderer')
    await vi.waitFor(() => expect(listBackups()).toHaveLength(1), { timeout: 5000, interval: 20 })
    const [backup] = listBackups()
    expect(backup).toMatch(/^workspace-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/)
    expect(JSON.parse(fs.readFileSync(path.join(backupsDir, backup!), 'utf8')).name).toBe('versão em disco')
    await s.flush()
    s.apply([{ op: 'setName', name: 'mais nova' }], 'renderer')
    await s.flush()
    await new Promise((r) => setTimeout(r, 100))
    expect(listBackups()).toHaveLength(1)
    expect((await findValidBackup(dir))?.doc.name).toBe('versão em disco')
  })

  it('nunca guarda backup de um workspace.json inválido', async () => {
    writeJson(wsFile, '{inválido')
    const s = makeStore(emptyDoc(dir))
    s.apply([{ op: 'setName', name: 'x' }], 'renderer')
    await s.flush()
    await new Promise((r) => setTimeout(r, 100))
    expect(listBackups()).toEqual([])
  })

  it(`mantém no máximo ${MAX_BACKUPS} backups, removendo os mais antigos`, async () => {
    for (let i = 0; i < 25; i++) {
      writeJson(path.join(backupsDir, `workspace-2020-01-01T00-00-00-000Z-${String(i).padStart(2, '0')}.json`), validDoc())
    }
    writeJson(wsFile, validDoc('atual'))
    const s = makeStore((await loadWorkspaceDoc(dir)).doc!)
    s.apply([{ op: 'setName', name: 'nova' }], 'renderer')
    await vi.waitFor(() => expect(listBackups()).toHaveLength(MAX_BACKUPS), { timeout: 5000, interval: 20 })
    const remaining = listBackups()
    // O backup novo (data atual) fica; os 6 mais antigos (00..05) saem.
    expect(remaining.filter((f) => !f.startsWith('workspace-2020-'))).toHaveLength(1)
    expect(remaining).not.toContain('workspace-2020-01-01T00-00-00-000Z-05.json')
    expect(remaining).toContain('workspace-2020-01-01T00-00-00-000Z-06.json')
  })
})
