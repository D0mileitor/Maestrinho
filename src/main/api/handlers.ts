import {
  ApiError,
  MANAGER_METHODS,
  type ApiMethod,
  type ApiParsedRequest,
  type ApiResults,
  type BoardCardSummary,
  type PeerTerminal
} from '@shared/api'
import { APP_NAME, CLI_NAME } from '@shared/constants'
import { newId, uniqueName } from '@shared/ids'
import type { WorkspaceOp } from '@shared/ipc'
import { pickHandles, placeRecruit } from '@shared/layout'
import { claudeHookSignal } from '@shared/agentEvents'
import {
  BoardError,
  addCard,
  cardsOf,
  commentCard,
  moveCard,
  resolveCard,
  resolveColumn,
  updateCard,
  type BoardCard,
  type BoardFile
} from '@shared/board'
import {
  RoleSchema,
  TerminalNameSchema,
  TerminalNodeSchema,
  type AgentPreset,
  type CanvasEdge,
  type NoteNodeData,
  type PortalNodeData,
  type Role,
  type TerminalNodeData,
  type WorkspaceDoc
} from '@shared/schemas'
import type { WorkspaceStore } from '../store/WorkspaceStore'
import { metaDirOf } from '../store/WorkspaceStore'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { log } from '../util/log'
import {
  areConnected,
  connectedNotes,
  connectedPortals,
  portalLabel,
  resolvePortalRef,
  connectedTerminals,
  findEdge,
  matchNotes,
  matchTerminals,
  normalizeName,
  resolveNoteRef,
  resolveTerminalRef,
  terminalNodes
} from './graph'
import { MessageService, connectionMissingMessage, type MessageServiceOptions } from './messages'
import { RateLimiter } from './RateLimiter'
import type { ApiDeps } from './types'
import { PT_BR_ERRORS, isApiMethod, parseApiRequest } from './validation'

/**
 * Handlers da API local. Todas as regras de permissão são aplicadas aqui, no servidor — o CLI
 * nunca é confiável: a identidade vem do token (callerId) e cada ação é validada contra o grafo de
 * conexões do workspace e as flags do terminal (ex.: gerente).
 */

/** Tamanho padrão de um terminal recrutado (igual ao do renderer, ver canvas/bridge.ts). */
export const RECRUIT_DEFAULT_SIZE = { w: 600, h: 420 } as const
export const MAX_RECRUITS_PER_MANAGER = 12

/** Palavras que, em `role set`, removem o papel do terminal. */
const CLEAR_ROLE_WORDS = new Set(['nenhum', 'nenhuma', 'none', '-'])
/** Nomes aceitos em `--floor` para o andar principal. */
const MAIN_FLOOR_WORDS = new Set(['principal', 'terreo', 'main', 'base'])

export interface ApiHandlersOptions {
  messages?: MessageServiceOptions
  /** Máximo de recrutas vivos por gerente (padrão 12). */
  maxRecruits?: number
  /** Limite de recrutamentos por gerente (padrão 20 por minuto). */
  recruitLimiter?: RateLimiter
}

export interface ApiHandlers {
  /** Valida e executa um método em nome do terminal `callerId` (autenticado pelo token). */
  dispatch(callerId: string, method: ApiMethod, body: unknown, signal?: AbortSignal): Promise<unknown>
  readonly messages: MessageService
  /** Encerra timers e esperas pendentes (saída do app). */
  dispose(): void
}

interface Caller {
  ws: WorkspaceStore
  node: TerminalNodeData
}

type Handler<M extends ApiMethod> = (
  caller: Caller,
  req: ApiParsedRequest<M>,
  signal: AbortSignal | undefined
) => Promise<ApiResults[M]> | ApiResults[M]

type HandlerTable = { [M in ApiMethod]: Handler<M> }

const MANAGER_SET: ReadonlySet<ApiMethod> = new Set(MANAGER_METHODS)

/** "role.set" -> "orq role set" (para mensagens). */
function commandLabel(method: ApiMethod): string {
  return `${CLI_NAME} ${method.replace('.', ' ')}`
}

function quoteList(items: string[]): string {
  return items.map((s) => `"${s}"`).join(', ')
}

/** Remove caracteres de controle (mantém quebras de linha quando `keepNewlines`). */
function cleanText(text: string, keepNewlines: boolean): string {
  const noCtl = keepNewlines
    ? text.replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, ' ')
    : text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
  return keepNewlines ? noCtl.trim() : noCtl.replace(/\s+/g, ' ').trim()
}

/** Estimativa de colunas/linhas do xterm para o tamanho do nó (o renderer corrige ao montar). */
function estimateGrid(size: { w: number; h: number }): { cols: number; rows: number } {
  const cols = Math.max(20, Math.min(400, Math.floor((size.w - 10) / 7.8)))
  const rows = Math.max(5, Math.min(200, Math.floor((size.h - 40) / 17)))
  return { cols, rows }
}

/** Id de papel a partir do nome: "Revisor Sênior" -> "revisor-senior". */
function roleSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 48)
  return slug || 'papel'
}

function uniqueRoleId(base: string, roles: readonly Role[]): string {
  const taken = new Set(roles.map((r) => r.id.toLowerCase()))
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
  return `${base}-${newId()}`
}

function edgeBetween(a: TerminalNodeData | NoteNodeData, b: TerminalNodeData | NoteNodeData): CanvasEdge {
  return { id: newId('e'), source: a.id, target: b.id, ...pickHandles(a, b) }
}

function endpointLabel(n: TerminalNodeData | NoteNodeData): string {
  return n.kind === 'terminal' ? n.name : n.file
}

/** Prints de portal guardados em .maestrinho/prints (os mais antigos saem). */
const MAX_PORTAL_PRINTS = 30

export function createApiHandlers(deps: ApiDeps, opts: ApiHandlersOptions = {}): ApiHandlers {
  const messages = new MessageService(deps, opts.messages)
  const maxRecruits = Math.max(1, opts.maxRecruits ?? MAX_RECRUITS_PER_MANAGER)
  const recruitLimiter = opts.recruitLimiter ?? new RateLimiter({ limit: 20, windowMs: 60_000 })
  const deferred = new Set<NodeJS.Timeout>()

  // ---------------------------------------------------------------- utilitários com acesso às deps

  function resolveCaller(callerId: string): Caller {
    const found = deps.workspaces.nodeById(callerId)
    if (!found || found.node.kind !== 'terminal') {
      throw new ApiError(
        'unauthorized',
        `Este terminal não pertence mais a um workspace aberto no ${APP_NAME} (foi removido do canvas ou o workspace foi fechado).`
      )
    }
    return { ws: found.ws, node: found.node }
  }

  function presetLabel(node: TerminalNodeData): string {
    return deps.terminals.presetFor(node).label
  }

  function peerInfo(node: TerminalNodeData): PeerTerminal {
    const info = deps.ptys.info(node.id)
    const role = node.roleId ? deps.config.role(node.roleId) : undefined
    const peer: PeerTerminal = {
      id: node.id,
      name: node.name,
      role: role?.name ?? null,
      preset: presetLabel(node),
      status: info?.status ?? 'stopped',
      activity: info?.activity ?? 'idle'
    }
    if (info?.badge) peer.badge = info.badge
    // Hibernando: parado para poupar memória, mas recebe mensagens (acorda e retoma a conversa).
    if (node.hibernated) peer.badge = 'hibernando — acorda ao receber mensagem'
    if (info?.waitingOn) peer.waitingOn = info.waitingOn
    if (node.manager) peer.manager = true
    return peer
  }

  /** Terminal conectado diretamente ao chamador (nunca ele mesmo). */
  function connectedPeer(c: Caller, ref: string, selfMessage: string): TerminalNodeData {
    const peer = resolveTerminalRef(c.ws.doc, ref, { from: c.node.id })
    if (peer.id === c.node.id) throw new ApiError('bad_request', selfMessage)
    if (!areConnected(c.ws.doc, c.node.id, peer.id)) {
      throw new ApiError('forbidden', connectionMissingMessage(c.node.name, peer.name))
    }
    return peer
  }

  function noteNotConnectedMessage(file: string, terminal: string): string {
    return (
      `A nota "${file}" não está conectada a "${terminal}" no canvas. ` +
      'Peça ao usuário para conectar a nota a este terminal.'
    )
  }

  /** Nota conectada diretamente ao chamador. */
  function connectedNote(c: Caller, ref: string): NoteNodeData {
    const note = resolveNoteRef(c.ws.doc, ref, { from: c.node.id })
    if (!areConnected(c.ws.doc, c.node.id, note.id)) {
      throw new ApiError('forbidden', noteNotConnectedMessage(note.file, c.node.name))
    }
    return note
  }

  /** Portal conectado e liberado pelo usuário para agentes (botão no próprio portal). */
  function allowedPortal(c: Caller, ref: string | undefined): PortalNodeData {
    const portal = resolvePortalRef(c.ws.doc, c.node.id, c.node.name, ref)
    if (!portal.agentAccess) {
      throw new ApiError(
        'forbidden',
        `O portal "${portalLabel(portal)}" não está liberado para agentes. Peça ao usuário para ligar, no próprio portal, o botão "Agentes conectados podem usar".`
      )
    }
    if (!deps.portals) throw new ApiError('unavailable', 'Portais indisponíveis nesta sessão do app.')
    return portal
  }

  async function portalIo<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new ApiError('unavailable', `Portal: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Mantém só os prints de portal mais recentes da pasta. */
  async function prunePrints(dir: string): Promise<void> {
    try {
      const names = (await fsp.readdir(dir)).filter((n) => /^portal-.*\.png$/.test(n)).sort()
      for (const n of names.slice(0, Math.max(0, names.length - MAX_PORTAL_PRINTS))) await fsp.rm(path.join(dir, n), { force: true })
    } catch {
      // limpeza é opcional
    }
  }

  /** Traduz falhas de disco das notas em erros que o agente entende. */
  async function noteIo<T>(note: NoteNodeData, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (err) {
      if (err instanceof ApiError) throw err
      const code = (err as NodeJS.ErrnoException | null)?.code
      if (code === 'ENOENT') {
        throw new ApiError('not_found', `O arquivo da nota "${note.file}" não existe em disco (foi apagado ou movido?).`)
      }
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        throw new ApiError(
          'conflict',
          `O arquivo da nota "${note.file}" está bloqueado ou sem permissão de acesso (código ${code}). Tente de novo em instantes.`
        )
      }
      throw err
    }
  }

  function findPreset(ref: string): AgentPreset {
    const presets = deps.config.presets
    const r = ref.trim()
    const lower = r.toLowerCase()
    const norm = normalizeName(r)
    const found =
      presets.find((p) => p.id === r) ??
      presets.find((p) => p.id.toLowerCase() === lower) ??
      presets.find((p) => normalizeName(p.label) === norm)
    if (!found) {
      const list = presets.map((p) => `${p.id} ("${p.label}")`).join(', ')
      throw new ApiError('not_found', `Agente "${r}" não encontrado. Agentes (presets) disponíveis: ${list}. Use o id em --agent.`)
    }
    return found
  }

  function defaultPresetFor(manager: TerminalNodeData): AgentPreset {
    return deps.config.preset(manager.presetId) ?? deps.terminals.presetFor(manager)
  }

  function rolesHint(): string {
    const roles = deps.config.roles
    return roles.length > 0
      ? `Papéis disponíveis: ${roles.map((r) => `"${r.name}" (${r.id})`).join(', ')}.`
      : 'Nenhum papel cadastrado.'
  }

  function findRoleOrThrow(ref: string): Role {
    const role = deps.config.findRole(ref.trim())
    if (!role) {
      throw new ApiError(
        'not_found',
        `Papel "${ref.trim()}" não encontrado. ${rolesHint()} ` +
          `Para criar um papel novo use \`${CLI_NAME} role edit <papel> --instructions <texto> --create\`.`
      )
    }
    return role
  }

  function resolveFloor(doc: WorkspaceDoc, ref: string): string | undefined {
    const r = ref.trim()
    const norm = normalizeName(r)
    // Um floor de verdade com esse nome/branch vence os apelidos do andar principal ("main", "base"...).
    const floor =
      doc.floors.find((f) => f.id === r) ??
      doc.floors.find((f) => normalizeName(f.name) === norm) ??
      doc.floors.find((f) => f.branch === r)
    if (floor) return floor.id
    if (MAIN_FLOOR_WORDS.has(norm)) return undefined
    const list = ['"principal" (térreo)', ...doc.floors.map((f) => `"${f.name}" (branch ${f.branch})`)].join(', ')
    throw new ApiError('not_found', `Floor "${r}" não encontrado. Floors disponíveis: ${list}.`)
  }

  /** Reinicia o processo de um terminal (se estiver rodando) para aplicar o papel novo. */
  function restartForRole(c: Caller, target: TerminalNodeData): boolean {
    if (!deps.ptys.has(target.id)) return false
    const run = (): void => {
      try {
        deps.terminals.restart(target.id)
      } catch (err) {
        log.warn('falha ao reiniciar terminal após troca de papel', { id: target.id, error: err instanceof Error ? err.name : 'erro' })
      }
    }
    if (target.id === c.node.id) {
      // O próprio chamador: adia para a resposta HTTP chegar ao CLI antes do processo ser reiniciado.
      const timer = setTimeout(() => {
        deferred.delete(timer)
        run()
      }, 500)
      timer.unref?.()
      deferred.add(timer)
    } else {
      run()
    }
    return true
  }

  /** Extremo de `connect`: terminal ou nota do workspace do gerente. */
  function resolveEndpoint(c: Caller, ref: string): TerminalNodeData | NoteNodeData {
    const doc = c.ws.doc
    const terms = matchTerminals(doc, ref)
    const notes = matchNotes(doc, ref)
    if (terms.length === 1 && notes.length === 0) return terms[0]!
    if (notes.length === 1 && terms.length === 0) return notes[0]!
    const r = ref.trim()
    if (terms.length + notes.length > 1) {
      const options = [...terms.map((t) => `terminal "${t.name}"`), ...notes.map((n) => `nota "${n.file}"`)]
      throw new ApiError(
        'conflict',
        `A referência "${r}" é ambígua: corresponde a ${options.join(', ')}. ` +
          'Use o nome completo do arquivo da nota (com .md) ou o id do nó.'
      )
    }
    const recruits = terminalNodes(doc)
      .filter((t) => t.recruitedBy === c.node.id)
      .map((t) => t.name)
    const myNotes = connectedNotes(doc, c.node.id).map((n) => n.file)
    throw new ApiError(
      'not_found',
      `Nenhum terminal ou nota "${r}" neste workspace. ` +
        `Seus recrutas: ${recruits.length ? quoteList(recruits) : '(nenhum)'}. ` +
        `Notas conectadas a você: ${myNotes.length ? quoteList(myNotes) : '(nenhuma)'}.`
    )
  }

  /** O gerente só pode ligar: ele mesmo, os próprios recrutas e notas já conectadas a ele. */
  function assertManagedEndpoint(c: Caller, n: TerminalNodeData | NoteNodeData): void {
    const manager = c.node
    if (n.id === manager.id) return
    if (n.kind === 'terminal') {
      if (n.recruitedBy === manager.id) return
      throw new ApiError(
        'forbidden',
        `"${n.name}" não é um recruta de "${manager.name}". O gerente só pode conectar a si mesmo, ` +
          'os próprios recrutas e as notas já conectadas a ele.'
      )
    }
    if (areConnected(c.ws.doc, manager.id, n.id)) return
    throw new ApiError(
      'forbidden',
      `A nota "${n.file}" não está conectada a "${manager.name}". Peça ao usuário para conectar a nota ao ` +
        'seu terminal antes de ligá-la aos recrutas.'
    )
  }

  // ---------------------------------------------------------------- quadro de chamados

  function boardService(): NonNullable<typeof deps.board> {
    if (!deps.board) throw new ApiError('internal', 'O quadro de chamados não está disponível nesta versão do app.')
    return deps.board
  }

  /** Erros do quadro viram erros da API (mensagem já em pt-BR para o agente). */
  async function boardCall<T>(run: () => T | Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (err) {
      if (err instanceof BoardError) throw new ApiError(err.code, err.message)
      throw err
    }
  }

  function cardSummary(board: BoardFile, card: BoardCard): BoardCardSummary {
    const col = board.columns.find((x) => x.id === card.column)
    return {
      seq: card.seq,
      title: card.title,
      ticket: card.ticket,
      column: card.column,
      columnName: col?.name ?? card.column,
      assignee: card.assignee,
      note: card.note ?? null,
      updatedAt: card.updatedAt
    }
  }

  /** Mudança no quadro feita por um agente: o autor é o nome do terminal. */
  function boardChange(c: Caller, change: (b: BoardFile, by: string, now: string) => { board: BoardFile; card: BoardCard }): Promise<{ card: BoardCardSummary }> {
    return boardCall(() =>
      boardService().mutate(c.ws.dir, (b) => {
        const r = change(b, c.node.name, new Date().toISOString())
        return { board: r.board, result: { card: cardSummary(r.board, r.card) } }
      })
    )
  }

  // ---------------------------------------------------------------- métodos

  const table: HandlerTable = {
    whoami: ({ ws, node }) => {
      const preset = deps.terminals.presetFor(node)
      const role = node.roleId ? deps.config.role(node.roleId) : undefined
      const floor = node.floorId ? ws.doc.floors.find((f) => f.id === node.floorId) : undefined
      let cwd: string
      try {
        cwd = deps.terminals.resolveCwd(node)
      } catch {
        cwd = ws.dir
      }
      return {
        id: node.id,
        name: node.name,
        role: role ? { id: role.id, name: role.name, instructions: role.instructions } : null,
        manager: node.manager === true,
        preset: { id: preset.id, label: preset.label },
        workspace: { dir: ws.dir, name: ws.doc.name },
        floor: floor ? { id: floor.id, name: floor.name, branch: floor.branch } : null,
        cwd,
        peers: {
          terminals: connectedTerminals(ws.doc, node.id).length,
          notes: connectedNotes(ws.doc, node.id).length
        }
      }
    },

    peers: ({ ws, node }) => {
      const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, 'pt-BR')
      return {
        terminals: connectedTerminals(ws.doc, node.id).sort(byName).map(peerInfo),
        notes: connectedNotes(ws.doc, node.id)
          .sort((a, b) => a.file.localeCompare(b.file, 'pt-BR'))
          .map((n) => ({ id: n.id, file: n.file })),
        portals: connectedPortals(ws.doc, node.id).map((p) => (p.title ? { id: p.id, url: p.url, title: p.title } : { id: p.id, url: p.url }))
      }
    },

    send: async (c, req, signal) => {
      const peer = connectedPeer(
        c,
        req.to,
        `Não é possível enviar mensagem para si mesmo ("${c.node.name}"). Use \`${CLI_NAME} peers\` para ver com quem você pode falar.`
      )
      const { messageId } = await messages.send(c.node, peer, req.text, { wait: req.wait === true, signal })
      return { messageId, to: peer.name, delivered: true }
    },

    wait: (c, req, signal) => messages.wait(c.node.id, req.messageId, req.pollMs, req.lines, req.cancel, signal),

    read: (c, req) => {
      const peer = connectedPeer(
        c,
        req.peer,
        `"${c.node.name}" é o próprio terminal: \`${CLI_NAME} read\` serve para ler a saída de terminais conectados.`
      )
      const info = deps.ptys.info(peer.id)
      const text = deps.ptys.readText(peer.id, req.lines) ?? ''
      deps.emitEdgeActivity({ from: peer.id, to: c.node.id, kind: 'read' })
      return { name: peer.name, text, status: info?.status ?? 'stopped', activity: info?.activity ?? 'idle' }
    },

    'note.list': async ({ ws, node }) => {
      const notes = connectedNotes(ws.doc, node.id)
      if (notes.length === 0) return { notes: [] }
      const entries = await deps.notes.list(ws.dir)
      const exact = new Map(entries.map((e) => [e.file, e]))
      const loose = new Map(entries.map((e) => [e.file.toLowerCase(), e]))
      return {
        notes: notes.map((n) => {
          const e = exact.get(n.file) ?? loose.get(n.file.toLowerCase())
          return { id: n.id, file: n.file, size: e?.size ?? 0, mtimeMs: e?.mtimeMs ?? 0 }
        })
      }
    },

    'portal.read': async (c, req) => {
      const portal = allowedPortal(c, req.portal)
      const page = await portalIo(() => deps.portals!.read(portal.id))
      deps.emitEdgeActivity({ from: portal.id, to: c.node.id, kind: 'read' })
      return { id: portal.id, ...page }
    },

    'portal.print': async (c, req) => {
      const portal = allowedPortal(c, req.portal)
      const dir = path.join(metaDirOf(c.ws.dir), 'prints')
      const slug = portalLabel(portal).normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'portal'
      const file = path.join(dir, `portal-${new Date().toISOString().replace(/[:.]/g, '-')}-${slug}.png`)
      const shot = await portalIo(() => deps.portals!.capture(portal.id, file))
      await prunePrints(dir)
      deps.emitEdgeActivity({ from: portal.id, to: c.node.id, kind: 'read' })
      return { id: portal.id, file, ...shot }
    },

    'portal.open': async (c, req) => {
      const portal = allowedPortal(c, req.portal)
      const page = await portalIo(() => deps.portals!.open(portal.id, req.url))
      if (/^https?:\/\//i.test(page.url)) deps.applyMainOps(c.ws, [{ op: 'updateNode', id: portal.id, patch: { url: page.url } }])
      deps.emitEdgeActivity({ from: c.node.id, to: portal.id, kind: 'send' })
      return { id: portal.id, ...page }
    },

    'note.read': async (c, req) => {
      const note = connectedNote(c, req.note)
      const { content, revision } = await noteIo(note, () => deps.notes.read(c.ws.dir, note.file))
      deps.emitEdgeActivity({ from: note.id, to: c.node.id, kind: 'note' })
      return { id: note.id, file: note.file, content, revision }
    },

    'note.write': async (c, req) => {
      const note = connectedNote(c, req.note)
      const { revision } = await noteIo(note, () => deps.notes.write(c.ws.dir, note.file, req.content, req.ifRevision))
      deps.emitEdgeActivity({ from: c.node.id, to: note.id, kind: 'note' })
      return { id: note.id, file: note.file, revision }
    },

    'note.append': async (c, req) => {
      const note = connectedNote(c, req.note)
      const { revision } = await noteIo(note, () => deps.notes.append(c.ws.dir, note.file, req.content))
      deps.emitEdgeActivity({ from: c.node.id, to: note.id, kind: 'note' })
      return { id: note.id, file: note.file, revision }
    },

    notify: ({ ws, node }, req) => {
      // O título sempre identifica o terminal (um agente não consegue imitar avisos do sistema).
      const extra = req.title ? cleanText(req.title, false) : ''
      const title = extra ? `${node.name}: ${extra}` : node.name
      const body = cleanText(req.text, true) || '(sem texto)'
      deps.notify(title, body, { terminalId: node.id, dir: ws.dir })
      return {}
    },

    status: ({ node }, req) => {
      const text = cleanText(req.text, false)
      deps.ptys.setBadge(node.id, text || undefined)
      return {}
    },

    // ---------------------------------------------------------------- gerente

    recruit: (c, req) => {
      const { ws, node: manager } = c
      const doc = ws.doc
      const nameCheck = TerminalNameSchema.safeParse(req.name.trim(), { error: PT_BR_ERRORS })
      if (!nameCheck.success) {
        throw new ApiError(
          'bad_request',
          `Nome de recruta inválido "${req.name}": ${nameCheck.error.issues[0]?.message ?? 'formato inválido'}. ` +
            'Exemplos válidos: "revisor", "testador-2", "api.backend".'
        )
      }
      const name = nameCheck.data
      const terms = terminalNodes(doc)
      const clash = terms.find((t) => normalizeName(t.name) === normalizeName(name))
      if (clash) {
        const suggestion = uniqueName(name, terms.map((t) => t.name))
        throw new ApiError(
          'conflict',
          `Já existe um terminal chamado "${clash.name}" neste workspace. Escolha outro nome (ex.: "${suggestion}").`
        )
      }
      // Referências resolvem primeiro por id: um nome igual ao id de outro nó desviaria `send`/`read` para ele.
      if (doc.nodes.some((n) => n.id.toLowerCase() === name.toLowerCase())) {
        throw new ApiError(
          'conflict',
          `"${name}" é o id de um nó deste workspace e não pode ser usado como nome de terminal. Escolha outro nome.`
        )
      }
      const mine = terms.filter((t) => t.recruitedBy === manager.id)
      if (mine.length >= maxRecruits) {
        throw new ApiError(
          'conflict',
          `Limite de ${maxRecruits} recrutas por gerente atingido. Dispense algum com \`${CLI_NAME} dismiss <nome>\` antes de recrutar outro.`
        )
      }
      const preset = req.agent?.trim() ? findPreset(req.agent) : defaultPresetFor(manager)
      const role = req.role?.trim() ? findRoleOrThrow(req.role) : undefined
      const notes: NoteNodeData[] = []
      for (const ref of req.notes) {
        const note = resolveNoteRef(doc, ref, { from: manager.id })
        if (!areConnected(doc, manager.id, note.id)) {
          throw new ApiError(
            'forbidden',
            `A nota "${note.file}" não está conectada a "${manager.name}". Só é possível ligar a recrutas notas que ` +
              'já estão conectadas a você; peça ao usuário para conectar a nota ao seu terminal.'
          )
        }
        if (!notes.some((n) => n.id === note.id)) notes.push(note)
      }
      const floorId = req.floor?.trim() ? resolveFloor(doc, req.floor) : manager.floorId
      const pace = recruitLimiter.hit(manager.id)
      if (!pace.allowed) {
        throw new ApiError(
          'rate_limited',
          `Recrutamentos demais em pouco tempo. Aguarde ${Math.ceil(pace.retryAfterMs / 1000)} s antes de recrutar de novo.`
        )
      }

      const sameFloor = doc.nodes.filter((n) => (n.floorId ?? null) === (floorId ?? null))
      const size = { w: RECRUIT_DEFAULT_SIZE.w, h: RECRUIT_DEFAULT_SIZE.h }
      const position = placeRecruit(manager, sameFloor, size)
      const draft: TerminalNodeData = {
        id: newId('t'),
        kind: 'terminal',
        name,
        presetId: preset.id,
        recruitedBy: manager.id,
        cwd: '',
        autoStart: true,
        position,
        size
      }
      if (role) draft.roleId = role.id
      if (floorId) draft.floorId = floorId
      const recruit = TerminalNodeSchema.parse(draft)
      const edges = [edgeBetween(manager, recruit), ...notes.map((n) => edgeBetween(recruit, n))]
      const ops: WorkspaceOp[] = [
        { op: 'addNodes', nodes: [recruit] },
        { op: 'addEdges', edges }
      ]
      deps.applyMainOps(ws, ops)

      // As conexões já existem quando o processo inicia: as instruções do recruta listam gerente e notas.
      const { cols, rows } = estimateGrid(recruit.size)
      try {
        deps.terminals.ensure(recruit.id, cols, rows)
      } catch (err) {
        log.warn('recruta criado, mas o processo não iniciou', { id: recruit.id, error: err instanceof Error ? err.name : 'erro' })
      }
      log.info('recruta criado', {
        manager: manager.id,
        recruit: recruit.id,
        preset: preset.id,
        role: role?.id ?? null,
        notes: notes.length,
        floor: floorId ?? null
      })
      return { id: recruit.id, name, preset: preset.label, role: role?.name ?? null, notes: notes.map((n) => n.file) }
    },

    dismiss: ({ ws, node: manager }, req) => {
      const target = resolveTerminalRef(ws.doc, req.name, { from: manager.id })
      if (target.id === manager.id) throw new ApiError('bad_request', 'Um gerente não pode dispensar a si mesmo.')
      if (target.recruitedBy !== manager.id) {
        throw new ApiError(
          'forbidden',
          `Você só pode dispensar terminais recrutados por você: "${target.name}" não foi recrutado por "${manager.name}".`
        )
      }
      // O efeito colateral de removeNodes (AppContext) encerra o processo do recruta.
      deps.applyMainOps(ws, [{ op: 'removeNodes', ids: [target.id] }])
      log.info('recruta dispensado', { manager: manager.id, recruit: target.id })
      return {}
    },

    'role.list': () => ({
      roles: deps.config.roles.map((r) => ({ id: r.id, name: r.name, instructions: r.instructions }))
    }),

    'role.set': (c, req) => {
      const { ws, node: manager } = c
      const target = resolveTerminalRef(ws.doc, req.name, { from: manager.id })
      if (target.id !== manager.id && target.recruitedBy !== manager.id) {
        throw new ApiError(
          'forbidden',
          `Você só pode trocar o papel dos seus recrutas (ou o seu próprio): "${target.name}" não foi recrutado por "${manager.name}".`
        )
      }
      const clear = CLEAR_ROLE_WORDS.has(normalizeName(req.role))
      const role = clear ? undefined : findRoleOrThrow(req.role)
      if ((target.roleId ?? undefined) === role?.id) return {}
      deps.applyMainOps(ws, [{ op: 'updateNode', id: target.id, patch: { roleId: role?.id } }])
      const restarted = restartForRole(c, target)
      log.info('papel do terminal alterado', { manager: manager.id, target: target.id, role: role?.id ?? null, restarted })
      return {}
    },

    'role.edit': (c, req) => {
      const { ws, node: manager } = c
      const existing = deps.config.findRole(req.role.trim())
      let draft: Role
      if (existing) {
        draft = { ...existing, instructions: req.instructions }
      } else if (req.create) {
        const name = req.role.trim()
        draft = {
          id: uniqueRoleId(roleSlug(name), deps.config.roles),
          name,
          instructions: req.instructions,
          color: '',
          builtin: false
        }
      } else {
        throw new ApiError(
          'not_found',
          `Papel "${req.role.trim()}" não encontrado. ${rolesHint()} Para criá-lo, repita o comando com --create.`
        )
      }
      const valid = RoleSchema.safeParse(draft, { error: PT_BR_ERRORS })
      if (!valid.success) {
        const issue = valid.error.issues[0]
        const field = issue?.path.map(String).join('.') ?? ''
        throw new ApiError('bad_request', `Papel inválido${field ? ` (campo "${field}")` : ''}: ${issue?.message ?? 'formato inválido'}.`)
      }
      const role = valid.data
      deps.config.saveRole(role)
      // Recrutas deste gerente com o papel são reiniciados para receber as instruções novas.
      const restarted: string[] = []
      for (const t of terminalNodes(ws.doc)) {
        if (t.recruitedBy === manager.id && t.roleId === role.id && restartForRole(c, t)) restarted.push(t.name)
      }
      log.info('papel editado pela API', {
        manager: manager.id,
        role: role.id,
        created: !existing,
        chars: role.instructions.length,
        restarted: restarted.length
      })
      return { role: { id: role.id, name: role.name }, restarted }
    },

    connect: (c, req) => {
      const { ws } = c
      const a = resolveEndpoint(c, req.a)
      const b = resolveEndpoint(c, req.b)
      if (a.id === b.id) throw new ApiError('bad_request', `Não é possível conectar "${endpointLabel(a)}" a ele mesmo.`)
      assertManagedEndpoint(c, a)
      assertManagedEndpoint(c, b)
      const existing = findEdge(ws.doc, a.id, b.id)
      if (existing) return { edgeId: existing.id, a: endpointLabel(a), b: endpointLabel(b), existed: true }
      const edge = edgeBetween(a, b)
      deps.applyMainOps(ws, [{ op: 'addEdges', edges: [edge] }])
      log.info('conexão criada pelo gerente', { manager: c.node.id, a: a.id, b: b.id })
      return { edgeId: edge.id, a: endpointLabel(a), b: endpointLabel(b) }
    },

    'board.list': (c, req) =>
      boardCall(async () => {
        const board = await boardService().get(c.ws.dir)
        const last = board.columns[board.columns.length - 1]!.id
        let cols = board.columns
        if (req.column) cols = [resolveColumn(board, req.column)]
        let hiddenDone = 0
        let cards = cols.flatMap((col) => cardsOf(board, col.id))
        if (!req.column && !req.all) {
          hiddenDone = cards.filter((x) => x.column === last).length
          cards = cards.filter((x) => x.column !== last)
        }
        if (req.mine) cards = cards.filter((x) => normalizeName(x.assignee) === normalizeName(c.node.name))
        return {
          columns: board.columns.map((col) => ({ id: col.id, name: col.name, count: board.cards.filter((x) => x.column === col.id).length })),
          cards: cards.map((x) => cardSummary(board, x)),
          hiddenDone
        }
      }),

    'board.show': (c, req) =>
      boardCall(async () => {
        const board = await boardService().get(c.ws.dir)
        const card = resolveCard(board, req.card)
        return { ...cardSummary(board, card), description: card.description, createdBy: card.createdBy, createdAt: card.createdAt, log: card.log }
      }),

    'board.add': (c, req) => boardChange(c, (b, by, now) => addCard(b, req, by, now)),

    'board.move': (c, req) => boardChange(c, (b, by, now) => moveCard(b, req.card, req.column, by, now, { comment: req.comment })),

    'board.update': (c, req) => {
      const { card, ...patch } = req
      return boardChange(c, (b, by, now) => updateCard(b, card, patch, by, now))
    },

    'board.comment': (c, req) => boardChange(c, (b, by, now) => commentCard(b, req.card, req.text, by, now)),

    // Hooks do Claude Code (via `orq hook`): o agente avisa o próprio estado. Só afeta o próprio terminal.
    hook: ({ node }, req) => {
      const signal = claudeHookSignal(req)
      // Um relógio adiantado não pode travar os próximos avisos ("fora de ordem").
      if (signal) deps.ptys.agentSignal(node.id, signal, Math.min(req.at, Date.now()))
      return {}
    }
  }

  return {
    messages,
    async dispatch(callerId, method, body, signal) {
      if (!isApiMethod(method)) throw new ApiError('not_found', `Método desconhecido: "${String(method)}".`)
      const caller = resolveCaller(callerId)
      if (MANAGER_SET.has(method) && caller.node.manager !== true) {
        throw new ApiError(
          'forbidden',
          `Este terminal não está em modo gerente: \`${commandLabel(method)}\` é um comando de gerente ` +
            `(${CLI_NAME} recruit, dismiss, role set, role edit, connect). ` +
            'Peça ao usuário para ativar a opção "Gerente" neste terminal.'
        )
      }
      const req = parseApiRequest(method, body)
      // A tabela é indexada pelo próprio método; o TS não correlaciona união de chaves com união de funções.
      const fn = table[method] as unknown as (c: Caller, r: unknown, s: AbortSignal | undefined) => unknown
      return await fn(caller, req, signal)
    },
    dispose() {
      for (const t of deferred) clearTimeout(t)
      deferred.clear()
      messages.dispose()
    }
  }
}
