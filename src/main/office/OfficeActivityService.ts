import { detectPendingChoice, parseCodexLine, parseTranscriptLine, type ChatAgent, type ParseResult, type ParseState } from '@shared/chat'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { archiveUse, lastToolName, toolActivity, type OfficeActivity, type OfficeHelper, type OfficeToolKind } from '@shared/office'
import type { AgentPreset, TerminalNodeData } from '@shared/schemas'
import { chatAgentFor, locateClaudeTranscript, locateCodexTranscript, readFrom } from '../chat/transcripts'
import { codexSessionFile } from '../terminals/sessions'

const TICK_MS = 1000
const CODEX_DISCOVERY_MS = 3000
/** Ao começar a observar, só o final do histórico interessa (o estado atual). */
const INITIAL_BYTES = 256 * 1024
const MAX_CHUNK_BYTES = 4 * 1024 * 1024
/** Ajudante que terminou continua na lista por este tempo (o estagiário fecha o banquinho e sai). */
const HELPER_DONE_MS = 20_000
/** Ajudante "rodando" cujo histórico não muda há este tempo foi abandonado (sessão reiniciada, por exemplo). */
const HELPER_STALE_MS = 10 * 60_000
/** Do histórico do ajudante, só o final interessa (a ferramenta mais recente). */
const HELPER_TAIL_BYTES = 16 * 1024
const HELPER_LOOKUP_MS = 3000
const MAX_HELPERS = 12

interface HelperTrack {
  seed: string
  title: string
  type?: string
  agentId?: string
  status: 'running' | 'done' | 'error'
  endedAt?: number
  /** Cache da leitura do histórico do ajudante. */
  size: number
  tool: OfficeToolKind | null
  nextLookup: number
}

export interface OfficeActivityDeps {
  node(id: string): TerminalNodeData | undefined
  presetFor(node: TerminalNodeData): AgentPreset
  resolveCwd(node: TerminalNodeData): string
  startedAt(id: string): number | undefined
  isRunning(id: string): boolean
  /** Últimas linhas físicas da tela (para ver se há uma pergunta esperando o usuário). */
  readScreen(id: string, rows: number): string | null
  /** Históricos em uso pelo chat de OUTROS terminais (o Codex não pode ser atribuído a dois terminais). */
  claimedByChat(exceptId: string): Set<string | null>
  emit(activity: OfficeActivity): void
  env?: Record<string, string | undefined>
}

interface Watcher {
  agent: ChatAgent | null
  identity: string
  file: string | null
  offset: number
  partial: string
  tools: ParseState
  helpers: Map<string, HelperTrack>
  nextDiscovery: number
  last: OfficeActivity
  lastJson: string
}

/**
 * Sinais para o escritório: a ferramenta mais recente no histórico de cada agente (Claude Code e
 * Codex), se a última resposta terminou e se há uma pergunta esperando o usuário na tela. Só roda
 * enquanto a visão do escritório está aberta; emite apenas mudanças. Nada de conteúdo vai ao log.
 */
export class OfficeActivityService {
  private readonly watchers = new Map<string, Watcher>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: OfficeActivityDeps) {}

  /** Passa a observar exatamente estes terminais (lista vazia = parar). */
  watch(ids: string[]): void {
    const wanted = new Set(ids)
    for (const id of [...this.watchers.keys()]) if (!wanted.has(id)) this.watchers.delete(id)
    for (const id of wanted) {
      if (this.watchers.has(id)) continue
      const empty: OfficeActivity = { id, tool: null, turnEnded: false, waiting: false, archive: { seq: 0, mode: 'read' } }
      this.watchers.set(id, { agent: null, identity: '', file: null, offset: 0, partial: '', tools: new Map(), helpers: new Map(), nextDiscovery: 0, last: empty, lastJson: '' })
    }
    if (this.watchers.size > 0 && !this.timer) {
      this.timer = setInterval(() => this.tick(), TICK_MS)
      this.tick()
    } else if (this.watchers.size === 0) this.stop()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.watchers.clear()
  }

  private get env(): Record<string, string | undefined> {
    return this.deps.env ?? process.env
  }

  private tick(): void {
    for (const [id, w] of this.watchers) {
      try {
        this.update(id, w)
      } catch {
        // um terminal com problema não derruba os outros
      }
    }
  }

  private update(id: string, w: Watcher): void {
    const node = this.deps.node(id)
    if (!node) return
    const next: OfficeActivity = { ...w.last, id, waiting: false }
    if (this.deps.isRunning(id)) {
      next.waiting = detectPendingChoice(this.deps.readScreen(id, 40) ?? '') !== null
      this.readHistory(id, w, node, next)
      next.helpers = this.helpersOf(w, Date.now())
    } else {
      next.tool = null
      next.turnEnded = true
      next.helpers = []
    }
    const json = JSON.stringify(next)
    if (json !== w.lastJson) {
      w.lastJson = json
      w.last = next
      this.deps.emit(next)
    }
  }

  private readHistory(id: string, w: Watcher, node: TerminalNodeData, out: OfficeActivity): void {
    const agent = chatAgentFor(this.deps.presetFor(node), node)
    const identity = agent === 'claude' ? (node.sessionId ?? '') : String(this.deps.startedAt(id) ?? 0)
    if (agent !== w.agent || identity !== w.identity) {
      // Outro agente ou outra sessão/processo: recomeça.
      w.agent = agent
      w.identity = identity
      w.file = null
      w.offset = 0
      w.partial = ''
      w.tools.clear()
      w.helpers.clear()
      w.nextDiscovery = 0
      out.tool = null
      out.turnEnded = false
    }
    if (!agent) return
    if (!w.file) {
      w.file = this.locate(id, w, node)
      if (!w.file) return
      w.offset = 0
    }
    const initial = w.offset === 0
    const chunk = readFrom(w.file, w.offset, initial ? INITIAL_BYTES : MAX_CHUNK_BYTES)
    if (!chunk || !chunk.text) return
    w.offset = chunk.size
    let text = (chunk.truncated ? '' : w.partial) + chunk.text
    // Começou no meio do arquivo: descarta a linha cortada.
    if (chunk.truncated) text = text.slice(text.indexOf('\n') + 1)
    const parts = text.split('\n')
    w.partial = parts.pop() ?? ''
    const parse: (line: string, tools: ParseState) => ParseResult = agent === 'claude' ? parseTranscriptLine : parseCodexLine
    for (const line of parts) {
      if (!line.trim()) continue
      const r = parse(line, w.tools)
      if (r.turnEnded) out.turnEnded = true
      for (const item of r.items) {
        if (item.kind === 'tool') {
          out.tool = { kind: toolActivity(item.name), detail: item.title, done: item.done }
          // Leu ou gravou o histórico de chamados: o agente vai até o arquivo de gavetas.
          const use = item.done ? null : archiveUse(item.name, (item.detail ?? '') + ' ' + item.title)
          if (use) out.archive = { seq: out.archive.seq + 1, mode: use }
          out.turnEnded = false
        } else if (item.kind === 'helper') {
          const cur = w.helpers.get(item.seed)
          const endedAt = item.status === 'running' ? undefined : (cur?.endedAt ?? (Date.parse(item.endedAt ?? '') || Date.now()))
          w.helpers.set(item.seed, {
            seed: item.seed,
            title: item.title,
            ...(item.type ? { type: item.type } : {}),
            ...((item.agentId ?? cur?.agentId) ? { agentId: item.agentId ?? cur?.agentId } : {}),
            status: item.status,
            ...(endedAt !== undefined ? { endedAt } : {}),
            size: cur?.size ?? -1,
            tool: cur?.tool ?? null,
            nextLookup: cur?.nextLookup ?? 0
          })
        } else if (item.kind === 'user' || item.kind === 'orq') {
          // pedido novo: começa outra resposta
          out.tool = null
          out.turnEnded = false
        }
      }
    }
  }

  /**
   * Ajudantes que o agente chamou (Claude Code): os que estão trabalhando, com o que cada um faz agora, e os
   * que acabaram de terminar. Só lê o final do histórico de cada ajudante, e só quando ele muda.
   */
  private helpersOf(w: Watcher, now: number): OfficeHelper[] {
    if (w.agent !== 'claude' || !w.file || w.helpers.size === 0) return []
    const dir = path.join(path.dirname(w.file), path.basename(w.file, '.jsonl'), 'subagents')
    const out: OfficeHelper[] = []
    for (const h of w.helpers.values()) {
      const base = { seed: h.seed, title: h.title, ...(h.type ? { type: h.type } : {}) }
      if (h.status !== 'running') {
        if (h.endedAt !== undefined && now - h.endedAt < HELPER_DONE_MS) out.push({ ...base, status: 'done', tool: null })
        continue
      }
      if (!h.agentId && now >= h.nextLookup) {
        h.nextLookup = now + HELPER_LOOKUP_MS
        h.agentId = agentIdFromMeta(dir, h.seed)
      }
      if (h.agentId) {
        const file = path.join(dir, `agent-${h.agentId}.jsonl`)
        let stat: fs.Stats | null
        try {
          stat = fs.statSync(file)
        } catch {
          stat = null
        }
        if (stat && now - stat.mtimeMs > HELPER_STALE_MS) continue
        if (stat && stat.size !== h.size) {
          h.size = stat.size
          const tail = readFrom(file, Math.max(0, stat.size - HELPER_TAIL_BYTES), HELPER_TAIL_BYTES)
          const name = tail?.text ? lastToolName(tail.text) : null
          h.tool = name ? toolActivity(name) : 'thinking'
        }
      }
      out.push({ ...base, status: 'running', tool: h.tool })
    }
    return out.slice(-MAX_HELPERS)
  }

  private locate(id: string, w: Watcher, node: TerminalNodeData): string | null {
    const cwd = this.deps.resolveCwd(node)
    if (w.agent === 'claude') return node.sessionId ? locateClaudeTranscript(cwd, node.sessionId, this.env) : null
    // Codex com sessão conhecida (inclusive retomada): pelo id.
    const known = node.sessionId ? codexSessionFile(node.sessionId, this.env) : null
    if (known) return known
    const now = Date.now()
    if (now < w.nextDiscovery) return null
    w.nextDiscovery = now + CODEX_DISCOVERY_MS
    const claimed = this.deps.claimedByChat(id)
    for (const [other, ow] of this.watchers) if (other !== id && ow.file) claimed.add(ow.file)
    return locateCodexTranscript(cwd, Number(w.identity) || 0, claimed, this.env, now)
  }
}

/** Id do ajudante pela chamada (`toolUseId` nos agent-*.meta.json da pasta subagents da sessão). */
function agentIdFromMeta(dir: string, toolUseId: string): string | undefined {
  let names: string[]
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json'))
  } catch {
    return undefined
  }
  for (const name of names) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as { toolUseId?: unknown }
      if (meta.toolUseId === toolUseId) return name.replace(/^agent-/, '').replace(/\.meta\.json$/, '')
    } catch {
      // arquivo sendo escrito: tenta na próxima
    }
  }
  return undefined
}
