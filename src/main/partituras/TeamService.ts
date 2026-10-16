import * as fsp from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { setColumns } from '@shared/board'
import type { PartituraImportReport } from '@shared/ipc'
import { PartituraSchema, type AgentPreset } from '@shared/schemas'
import { TEAM_KIND, TeamFileSchema, adoptPreset, presetStatus, teamPreview, type TeamFile, type TeamPreview } from '@shared/team'
import { writeFileAtomic } from '../store/atomicWrite'
import type { ConfigStore } from '../store/ConfigStore'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import type { NotesApi } from '../notes/types'
import type { BoardService } from '../board/BoardService'
import type { PartituraService } from './PartituraService'
import { log } from '../util/log'

export interface TeamDeps {
  workspaces: WorkspaceManager
  config: ConfigStore
  notes: NotesApi
  partituras: PartituraService
  board: BoardService
}

export interface TeamImportReport extends PartituraImportReport {
  presetsAdded: string[]
  boardApplied: boolean
}

const MAX_FILE = 20 * 1024 * 1024
/** Quanto tempo o arquivo lido fica guardado entre a prévia e a importação. */
const PENDING_TTL_MS = 30 * 60_000

/**
 * Exportar e importar um time pronto (ver @shared/team). A prévia lê o arquivo e guarda o conteúdo
 * aqui (a interface só recebe o resumo e um token); a importação usa o que foi lido, com os presets
 * que você aceitou.
 */
export class TeamService {
  private readonly pending = new Map<string, { team: TeamFile; dir: string; at: number }>()

  constructor(private readonly deps: TeamDeps) {}

  private ws(dir: string): NonNullable<ReturnType<WorkspaceManager['get']>> {
    const ws = this.deps.workspaces.get(dir)
    if (!ws) throw new Error('workspace não está aberto')
    return ws
  }

  /** Monta o time do floor em exibição: todos os nós, funções, presets usados e colunas do quadro. */
  async build(dir: string, opts: { name: string; description: string; includeNotes: boolean }): Promise<TeamFile> {
    const ws = this.ws(dir)
    const floor = ws.doc.activeFloorId ?? null
    const ids = ws.doc.nodes.filter((n) => (n.floorId ?? null) === floor).map((n) => n.id)
    if (ids.length === 0) throw new Error('Não há nada no canvas para exportar.')
    const p = await this.deps.partituras.build(ws, opts.name.trim() || ws.doc.name, ids)
    const notes = opts.includeNotes ? p.notes : Object.fromEntries(Object.keys(p.notes).map((f) => [f, '']))
    const presetIds = [...new Set(p.nodes.flatMap((n) => (n.kind === 'terminal' ? [n.presetId] : [])))]
    const presets = presetIds.map((id) => this.deps.config.preset(id)).filter((x): x is AgentPreset => Boolean(x))
    const board = await this.deps.board.get(ws.dir)
    return TeamFileSchema.parse({ ...p, notes, kind: TEAM_KIND, description: opts.description.trim(), presets, boardColumns: board.columns })
  }

  async exportTo(dir: string, opts: { name: string; description: string; includeNotes: boolean }, dest: string): Promise<void> {
    const team = await this.build(dir, opts)
    await writeFileAtomic(dest, `${JSON.stringify(team, null, 2)}\n`)
    log.info('time exportado', { nodes: team.nodes.length, presets: team.presets.length, notes: Object.keys(team.notes).length })
  }

  /** Lê o arquivo (time ou partitura comum) e devolve o resumo do que a importação fará. */
  async preview(dir: string, source: string): Promise<TeamPreview> {
    const ws = this.ws(dir)
    const st = await fsp.stat(source)
    if (st.size > MAX_FILE) throw new Error('Arquivo grande demais para um time (máximo 20 MB).')
    let raw: unknown
    try {
      raw = JSON.parse(await fsp.readFile(source, 'utf8'))
    } catch {
      throw new Error('O arquivo não é um JSON válido.')
    }
    let team: TeamFile
    const asTeam = TeamFileSchema.safeParse(raw)
    if (asTeam.success) team = asTeam.data
    else {
      // Uma partitura comum também serve (sem presets nem quadro).
      const asPartitura = PartituraSchema.safeParse(raw)
      if (!asPartitura.success) throw new Error('O arquivo não é um time nem uma partitura do Maestrinho.')
      team = TeamFileSchema.parse({ ...asPartitura.data, kind: TEAM_KIND })
    }
    const localNotes = new Map<string, string>()
    for (const file of Object.keys(team.notes)) {
      try {
        if (await this.deps.notes.exists(ws.dir, file)) localNotes.set(file, (await this.deps.notes.read(ws.dir, file)).content)
      } catch {
        // nota ilegível: conta como nova
      }
    }
    this.prune()
    const token = randomBytes(12).toString('hex')
    this.pending.set(token, { team, dir: ws.dir, at: Date.now() })
    const terminalNames = ws.doc.nodes.flatMap((n) => (n.kind === 'terminal' ? [n.name] : []))
    return teamPreview(team, { presets: this.deps.config.presets, roles: this.deps.config.roles, notes: localNotes, terminalNames }, token)
  }

  async import(
    dir: string,
    token: string,
    opts: { acceptPresets: string[]; applyBoard: boolean; position: { x: number; y: number }; reuseNotes?: string[] }
  ): Promise<TeamImportReport> {
    const ws = this.ws(dir)
    const item = this.pending.get(token)
    if (!item || item.dir !== ws.dir) throw new Error('A prévia expirou: abra o arquivo de novo.')
    this.pending.delete(token)
    const { team } = item
    const presetMap = new Map<string, string>()
    const presetsAdded: string[] = []
    for (const p of team.presets) {
      if (!opts.acceptPresets.includes(p.id)) continue
      const local = this.deps.config.preset(p.id)
      if (presetStatus(p, local) === 'igual') continue
      const adopted = adoptPreset(p, this.deps.config.presets.map((x) => x.id))
      this.deps.config.savePreset(adopted)
      presetMap.set(p.id, adopted.id)
      presetsAdded.push(adopted.label)
    }
    const report = await this.deps.partituras.insertData(ws.dir, team, opts.position, presetMap, new Set(opts.reuseNotes ?? []))
    let boardApplied = false
    if (opts.applyBoard && team.boardColumns) {
      const columns = team.boardColumns
      await this.deps.board.mutate(ws.dir, (b) => ({ board: setColumns(b, columns), result: undefined }))
      boardApplied = true
    }
    log.info('time importado', { nodes: report.nodes, presets: presetsAdded.length, board: boardApplied })
    return { ...report, presetsAdded, boardApplied }
  }

  private prune(): void {
    const now = Date.now()
    for (const [k, v] of this.pending) if (now - v.at > PENDING_TTL_MS) this.pending.delete(k)
  }
}
