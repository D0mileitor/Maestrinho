import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { newId, uniqueName } from '@shared/ids'
import type { PartituraImportReport, WorkspaceOp } from '@shared/ipc'
import { PartituraSchema, type CanvasEdge, type CanvasNode, type Partitura, type Role } from '@shared/schemas'
import { writeFileAtomic } from '../store/atomicWrite'
import type { ConfigStore } from '../store/ConfigStore'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import type { WorkspaceStore } from '../store/WorkspaceStore'
import type { NotesApi } from '../notes/types'
import { branchSlug } from '../floors/git'

export interface PartituraDeps {
  workspaces: WorkspaceManager
  config: ConfigStore
  notes: NotesApi
  applyMainOps(ws: WorkspaceStore, ops: WorkspaceOp[]): void
}

export interface PartituraSummary {
  file: string
  name: string
  createdAt: string
  nodes: number
}

export type ImportReport = PartituraImportReport

const FILE_RE = /^[a-z0-9][a-z0-9-]*\.json$/

/**
 * Partituras: grupos de nós (terminais com papéis, notas, portais, formas e as conexões internas)
 * salvos como JSON em .maestrinho/partituras e reinseridos em qualquer workspace.
 *
 * Segurança: a partitura guarda o *id do preset*, nunca uma linha de comando. Ao importar, o
 * comando vem sempre dos presets locais desta máquina; um arquivo recebido de terceiros não
 * consegue executar comandos arbitrários.
 */
export class PartituraService {
  constructor(private readonly deps: PartituraDeps) {}

  private ws(dir: string): WorkspaceStore {
    const ws = this.deps.workspaces.get(dir)
    if (!ws) throw new Error('workspace não está aberto')
    return ws
  }

  async list(dir: string): Promise<PartituraSummary[]> {
    const ws = this.ws(dir)
    let files: string[]
    try {
      files = (await fsp.readdir(ws.partiturasDir)).filter((f) => FILE_RE.test(f))
    } catch {
      return []
    }
    const out: PartituraSummary[] = []
    for (const file of files) {
      try {
        const p = PartituraSchema.parse(JSON.parse(await fsp.readFile(path.join(ws.partiturasDir, file), 'utf8')))
        out.push({ file, name: p.name, createdAt: p.createdAt, nodes: p.nodes.length })
      } catch {
        // arquivo inválido: ignorado na listagem
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async read(dir: string, file: string): Promise<Partitura> {
    const ws = this.ws(dir)
    if (!FILE_RE.test(file)) throw new Error('nome de partitura inválido')
    return PartituraSchema.parse(JSON.parse(await fsp.readFile(path.join(ws.partiturasDir, file), 'utf8')))
  }

  /** Monta a partitura a partir dos nós selecionados (posições relativas ao canto do grupo). */
  async build(ws: WorkspaceStore, name: string, nodeIds: string[]): Promise<Partitura> {
    const ids = new Set(nodeIds)
    const nodes = ws.doc.nodes.filter((n) => ids.has(n.id))
    if (nodes.length === 0) throw new Error('selecione ao menos um nó')
    const minX = Math.min(...nodes.map((n) => n.position.x))
    const minY = Math.min(...nodes.map((n) => n.position.y))
    const rel: CanvasNode[] = nodes.map((n) => {
      const copy = { ...n, position: { x: n.position.x - minX, y: n.position.y - minY } } as CanvasNode
      delete (copy as { floorId?: string }).floorId
      if (copy.kind === 'terminal') {
        // Caminhos absolutos não viajam; recrutador só se também estiver na seleção.
        if (path.isAbsolute(copy.cwd)) copy.cwd = ''
        if (copy.recruitedBy && !ids.has(copy.recruitedBy)) delete copy.recruitedBy
        // A conversa é deste terminal: uma cópia inserida começa a própria (nunca retoma a do original).
        delete copy.sessionId
        delete copy.hibernated
      }
      return copy
    })
    const edges = ws.doc.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    const roleIds = new Set(nodes.flatMap((n) => (n.kind === 'terminal' && n.roleId ? [n.roleId] : [])))
    const roles = [...roleIds].map((id) => this.deps.config.role(id)).filter((r): r is Role => Boolean(r))
    const notes: Record<string, string> = {}
    for (const n of nodes) {
      if (n.kind !== 'note' || notes[n.file] !== undefined) continue
      try {
        notes[n.file] = (await this.deps.notes.read(ws.dir, n.file)).content
      } catch {
        notes[n.file] = ''
      }
    }
    return PartituraSchema.parse({ version: 1, name, createdAt: new Date().toISOString(), nodes: rel, edges, roles, notes })
  }

  async save(dir: string, name: string, nodeIds: string[]): Promise<string> {
    const ws = this.ws(dir)
    const partitura = await this.build(ws, name.trim() || 'partitura', nodeIds)
    await fsp.mkdir(ws.partiturasDir, { recursive: true })
    const base = branchSlug(partitura.name)
    let file = `${base}.json`
    for (let i = 2; fs.existsSync(path.join(ws.partiturasDir, file)); i++) file = `${base}-${i}.json`
    await writeFileAtomic(path.join(ws.partiturasDir, file), JSON.stringify(partitura, null, 2))
    return file
  }

  /** Copia um arquivo de partitura externo para a biblioteca do workspace (validando antes). */
  async adoptFile(dir: string, sourcePath: string): Promise<string> {
    const stat = await fsp.stat(sourcePath)
    if (stat.size > 20 * 1024 * 1024) throw new Error('arquivo de partitura grande demais')
    return this.adoptData(dir, PartituraSchema.parse(JSON.parse(await fsp.readFile(sourcePath, 'utf8'))))
  }

  /** Guarda uma partitura já validada (ex.: baixada do Hub) na biblioteca do workspace. */
  async adoptData(dir: string, partitura: Partitura): Promise<string> {
    const ws = this.ws(dir)
    await fsp.mkdir(ws.partiturasDir, { recursive: true })
    const base = branchSlug(partitura.name)
    let file = `${base}.json`
    for (let i = 2; fs.existsSync(path.join(ws.partiturasDir, file)); i++) file = `${base}-${i}.json`
    await writeFileAtomic(path.join(ws.partiturasDir, file), JSON.stringify(partitura, null, 2))
    return file
  }

  async remove(dir: string, file: string): Promise<void> {
    const ws = this.ws(dir)
    if (!FILE_RE.test(file)) throw new Error('nome de partitura inválido')
    await fsp.rm(path.join(ws.partiturasDir, file), { force: true })
  }

  async exportTo(dir: string, file: string, destPath: string): Promise<void> {
    const p = await this.read(dir, file)
    await writeFileAtomic(destPath, JSON.stringify(p, null, 2))
  }

  /** Insere a partitura no canvas (ids novos, nomes únicos, papéis e notas resolvidos). */
  async insert(dir: string, file: string, position: { x: number; y: number }): Promise<ImportReport> {
    return this.insertData(dir, await this.read(dir, file), position)
  }

  /**
   * Insere uma partitura já validada. `presetMap`: troca de preset escolhida na importação de um time
   * (id no arquivo -> id local).
   */
  async insertData(
    dir: string,
    p: Partitura,
    position: { x: number; y: number },
    presetMap: Map<string, string> = new Map(),
    /** Notas que já existem no workspace e devem ser usadas como estão (sem criar cópia com o modelo). */
    reuseNotes: ReadonlySet<string> = new Set()
  ): Promise<ImportReport> {
    const ws = this.ws(dir)
    const report: ImportReport = { nodes: 0, edges: 0, rolesAdded: [], notesCreated: [], presetFallbacks: [], insertedIds: [] }

    // Papéis: mesmo id → local; mesmo nome → local; senão adiciona.
    const roleMap = new Map<string, string>()
    for (const r of p.roles) {
      const byId = this.deps.config.role(r.id)
      const byName = this.deps.config.findRole(r.name)
      if (byId) roleMap.set(r.id, byId.id)
      else if (byName) roleMap.set(r.id, byName.id)
      else {
        const id = newId('r')
        this.deps.config.saveRole({ ...r, id, builtin: false })
        roleMap.set(r.id, id)
        report.rolesAdded.push(r.name)
      }
    }

    // Notas: reaproveita arquivo com o mesmo conteúdo; senão cria com nome único.
    const noteMap = new Map<string, string>()
    for (const [fileName, content] of Object.entries(p.notes)) {
      let target = fileName
      if (await this.deps.notes.exists(ws.dir, fileName)) {
        const cur = await this.deps.notes.read(ws.dir, fileName).catch(() => null)
        // Sua nota com o mesmo nome fica como está e o time novo passa a usá-la.
        const reuse = Boolean(cur) && reuseNotes.has(fileName)
        if ((!cur || cur.content !== content) && !reuse) {
          target = await this.deps.notes.create(ws.dir, fileName, content)
          report.notesCreated.push(target)
        }
      } else {
        target = await this.deps.notes.create(ws.dir, fileName, content)
        report.notesCreated.push(target)
      }
      noteMap.set(fileName, target)
    }

    const idMap = new Map<string, string>()
    const takenNames = ws.doc.nodes.flatMap((n) => (n.kind === 'terminal' ? [n.name] : []))
    const floorId = ws.doc.activeFloorId
    const nodes: CanvasNode[] = []
    for (const n of p.nodes) {
      const id = newId(n.kind === 'terminal' ? 't' : n.kind === 'note' ? 'n' : n.kind === 'portal' ? 'w' : 's')
      idMap.set(n.id, id)
      const base = { ...n, id, position: { x: Math.round(position.x + n.position.x), y: Math.round(position.y + n.position.y) }, floorId }
      if (base.kind === 'terminal') {
        const name = uniqueName(base.name, takenNames)
        takenNames.push(name)
        let presetId = presetMap.get(base.presetId) ?? base.presetId
        if (!this.deps.config.preset(presetId)) {
          report.presetFallbacks.push(`${name} (${presetId})`)
          presetId = 'shell'
        }
        const roleId = base.roleId ? (roleMap.get(base.roleId) ?? (this.deps.config.role(base.roleId) ? base.roleId : undefined)) : undefined
        const terminal = { ...base, name, presetId, roleId }
        // Sessão e hibernação são do terminal de origem (arquivos antigos ou de terceiros podem trazer).
        delete terminal.sessionId
        delete terminal.hibernated
        nodes.push(terminal)
      } else if (base.kind === 'note') {
        nodes.push({ ...base, file: noteMap.get(base.file) ?? base.file })
      } else {
        nodes.push(base)
      }
    }
    // Recrutador remapeado (só existe se também veio na partitura).
    for (const n of nodes) {
      if (n.kind === 'terminal' && n.recruitedBy) n.recruitedBy = idMap.get(n.recruitedBy)
    }
    const edges: CanvasEdge[] = p.edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => ({ ...e, id: newId('e'), source: idMap.get(e.source)!, target: idMap.get(e.target)! }))

    const ops: WorkspaceOp[] = [{ op: 'addNodes', nodes }]
    if (edges.length) ops.push({ op: 'addEdges', edges })
    this.deps.applyMainOps(ws, ops)
    report.nodes = nodes.length
    report.edges = edges.length
    report.insertedIds = nodes.map((n) => n.id)
    return report
  }
}
