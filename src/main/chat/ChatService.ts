import { nativeImage } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  parseCodexLine,
  parseTranscriptLine,
  type ChatAgent,
  type ChatImage,
  type ChatItem,
  type ChatMeta,
  type ChatSnapshot,
  type ChatUpdate,
  type ParseResult,
  type ParseState
} from '@shared/chat'
import type { AgentPreset, TerminalNodeData } from '@shared/schemas'
import { withAttachedFiles } from '@shared/chatAttachments'
import { checkPdf } from './attachments'
import { chatAgentFor, locateClaudeTranscript, locateCodexTranscript } from './transcripts'
import { codexSessionFile } from '../terminals/sessions'
import { log } from '../util/log'

const POLL_MS = 600
/** O Codex só cria o arquivo da sessão na primeira mensagem: procura de tempos em tempos. */
const CODEX_DISCOVERY_MS = 2500
/** Itens enviados ao abrir o chat (o fim da conversa). */
const MAX_ITEMS = 400
/** Conversas enormes: ao abrir, lê só o final do arquivo. */
const MAX_INITIAL_BYTES = 12 * 1024 * 1024
const THUMB_WIDTH = 360
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp)$/i
const MAX_IMAGE_BYTES = 25 * 1024 * 1024


export interface ChatServiceDeps {
  node(id: string): TerminalNodeData | undefined
  presetFor(node: TerminalNodeData): AgentPreset
  resolveCwd(node: TerminalNodeData): string
  isRunning(id: string): boolean
  /** Início do processo atual do terminal (para achar a sessão do Codex). */
  startedAt(id: string): number | undefined
  inject(id: string, text: string, opts: { inputMode: AgentPreset['inputMode']; submitDelayMs: number; isShell: boolean; submit?: boolean }): Promise<void>
  writeRaw(id: string, data: string): boolean
  emit(update: ChatUpdate): void
  env?: Record<string, string | undefined>
}

interface Subscription {
  agent: ChatAgent
  /** Claude: id da sessão do nó; Codex: início do processo (muda ao reiniciar). */
  identity: string
  /** Codex: id da conversa conhecido na última leitura (trocar ou esquecer = outra conversa). */
  codexId: string
  file: string | null
  offset: number
  partial: string
  tools: ParseState
  meta: ChatMeta
  nextDiscovery: number
  timer: NodeJS.Timeout
}

export { chatAgentFor } from './transcripts'

/**
 * Chat ligado a um terminal. Acompanha o histórico que o agente grava — Claude Code em
 * `~/.claude/projects/<cwd>/<sessão>.jsonl`, Codex em `~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl` — e
 * devolve itens de conversa; as mensagens do chat são digitadas no próprio terminal (o mesmo caminho do
 * orq). O terminal continua igual: o chat é uma segunda visão dele. Nenhum conteúdo vai para o log.
 */
export class ChatService {
  private readonly subs = new Map<string, Subscription>()
  /** Claude ainda sem sessão quando o chat abriu: espera o id aparecer para ler o histórico. */
  private readonly waiting = new Map<string, NodeJS.Timeout>()

  constructor(private readonly deps: ChatServiceDeps) {}

  open(id: string): ChatSnapshot {
    this.close(id)
    const node = this.deps.node(id)
    if (!node) throw new Error('terminal não encontrado')
    const agent = chatAgentFor(this.deps.presetFor(node), node)
    if (!agent) {
      // Terminal recém-criado (ex.: time importado com o chat aberto): o id da sessão do Claude chega quando
      // o processo inicia. Até lá o chat mostra a tela; depois passa sozinho para o histórico.
      if (this.deps.presetFor(node).sessionStore === 'claude') this.waitForSession(id)
      return { mode: 'screen', agent: null, items: [], omitted: 0, meta: {} }
    }
    const sub: Subscription = {
      agent,
      identity: this.identityOf(agent, id, node),
      codexId: node.sessionId ?? '',
      file: null,
      offset: 0,
      partial: '',
      tools: new Map(),
      meta: {},
      nextDiscovery: 0,
      timer: setInterval(() => this.poll(id), POLL_MS)
    }
    this.subs.set(id, sub)
    const { items, omitted } = this.readInitial(id, sub, node)
    return { mode: 'transcript', agent, items, omitted, meta: { ...sub.meta } }
  }

  /** Históricos em uso pelos chats de outros terminais (para o escritório não confundir sessões do Codex). */
  claimedFiles(exceptId: string): Set<string | null> {
    return new Set([...this.subs.entries()].filter(([id]) => id !== exceptId).map(([, s]) => s.file))
  }

  /** O chat está ligado a este terminal agora? */
  isOpen(id: string): boolean {
    return this.subs.has(id) || this.waiting.has(id)
  }

  private waitForSession(id: string): void {
    const timer = setInterval(() => {
      const node = this.deps.node(id)
      if (!node) return this.close(id)
      if (!chatAgentFor(this.deps.presetFor(node), node)) return
      const snap = this.open(id)
      if (snap.agent) this.deps.emit({ id, items: snap.items, reset: true, meta: snap.meta, agent: snap.agent })
    }, POLL_MS)
    this.waiting.set(id, timer)
  }

  close(id: string): void {
    const wait = this.waiting.get(id)
    if (wait) {
      clearInterval(wait)
      this.waiting.delete(id)
    }
    const sub = this.subs.get(id)
    if (!sub) return
    clearInterval(sub.timer)
    this.subs.delete(id)
  }

  dispose(): void {
    for (const id of [...this.subs.keys(), ...this.waiting.keys()]) this.close(id)
  }

  /**
   * Digita no terminal: cada imagem como um caminho colado (o agente anexa), depois o texto e Enter.
   * PDFs vão no texto, como caminhos: o agente abre o arquivo.
   */
  async send(id: string, text: string, images: string[], docs: string[] = []): Promise<void> {
    const node = this.deps.node(id)
    if (!node) throw new Error('terminal não encontrado')
    if (!this.deps.isRunning(id)) throw new Error(`"${node.name}" não está em execução`)
    const preset = this.deps.presetFor(node)
    const files = images.map((p) => checkImage(p))
    const pdfs = docs.map((p) => checkPdf(p))
    const opts = { inputMode: preset.inputMode, isShell: preset.isShell }
    for (const file of files) {
      await this.deps.inject(id, file, { ...opts, submitDelayMs: 0, submit: false })
      // O agente lê o arquivo e troca o caminho por [Image #N] antes do próximo texto.
      await sleep(350)
    }
    const body = withAttachedFiles(text, pdfs)
    if (body) await this.deps.inject(id, body, { ...opts, submitDelayMs: preset.submitDelayMs })
    else if (files.length) {
      await sleep(200)
      this.deps.writeRaw(id, '\r')
    }
  }

  // ------------------------------------------------------------------ localizar o histórico

  private identityOf(agent: ChatAgent, id: string, node: TerminalNodeData): string {
    return agent === 'claude' ? (node.sessionId ?? '') : String(this.deps.startedAt(id) ?? 0)
  }

  private get env(): Record<string, string | undefined> {
    return this.deps.env ?? process.env
  }

  private locate(id: string, sub: Subscription, node: TerminalNodeData): string | null {
    if (sub.file && fs.existsSync(sub.file)) return sub.file
    sub.file = sub.agent === 'claude' ? this.locateClaude(node, sub.identity) : this.locateCodex(id, sub, node)
    return sub.file
  }

  private locateClaude(node: TerminalNodeData, sessionId: string): string | null {
    return locateClaudeTranscript(this.deps.resolveCwd(node), sessionId, this.env)
  }

  /** Codex: procura de tempos em tempos (o arquivo só aparece na primeira mensagem). */
  private locateCodex(id: string, sub: Subscription, node: TerminalNodeData): string | null {
    // Sessão já conhecida (inclusive retomada, que continua no arquivo antigo): pelo id.
    const known = node.sessionId ? codexSessionFile(node.sessionId, this.env) : null
    if (known) return known
    // Processo não iniciado nesta execução do app (ex.: hibernado): não há conversa nova para descobrir.
    if (!Number(sub.identity)) return null
    const now = Date.now()
    if (now < sub.nextDiscovery) return null
    sub.nextDiscovery = now + CODEX_DISCOVERY_MS
    const claimed = new Set([...this.subs.entries()].filter(([other]) => other !== id).map(([, s]) => s.file))
    return locateCodexTranscript(this.deps.resolveCwd(node), Number(sub.identity) || 0, claimed, this.env, now)
  }

  // ------------------------------------------------------------------ leitura

  private parser(sub: Subscription): (line: string, tools: ParseState) => ParseResult {
    return sub.agent === 'claude' ? parseTranscriptLine : parseCodexLine
  }

  private readInitial(id: string, sub: Subscription, node: TerminalNodeData): { items: ChatItem[]; omitted: number } {
    const file = this.locate(id, sub, node)
    if (!file) return { items: [], omitted: 0 }
    let fd: number | null = null
    try {
      const size = fs.statSync(file).size
      const start = Math.max(0, size - MAX_INITIAL_BYTES)
      fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(size - start)
      fs.readSync(fd, buf, 0, buf.length, start)
      sub.offset = size
      let text = buf.toString('utf8')
      // Começou no meio do arquivo: descarta a linha cortada.
      if (start > 0) text = text.slice(text.indexOf('\n') + 1)
      const { items } = this.parseChunk(sub, text, true)
      const omitted = Math.max(0, items.length - MAX_ITEMS) + (start > 0 ? 1 : 0)
      return { items: withThumbnails(items.slice(-MAX_ITEMS)), omitted }
    } catch (err) {
      log.warn('chat: não foi possível ler o histórico da sessão', err instanceof Error ? { error: err.name } : undefined)
      return { items: [], omitted: 0 }
    } finally {
      if (fd !== null) fs.closeSync(fd)
    }
  }

  /** Converte linhas do histórico em itens, mantendo a ordem e a última versão de cada chave. */
  private parseChunk(sub: Subscription, text: string, complete: boolean): { items: ChatItem[]; turnEnded: boolean; metaChanged: boolean } {
    const data = sub.partial + text
    const parts = data.split('\n')
    sub.partial = complete ? '' : (parts.pop() ?? '')
    const parse = this.parser(sub)
    const order: string[] = []
    const byKey = new Map<string, ChatItem>()
    let turnEnded = false
    const before = JSON.stringify(sub.meta)
    for (const line of parts) {
      if (!line.trim()) continue
      const r = parse(line, sub.tools)
      if (r.turnEnded) turnEnded = true
      if (r.meta) sub.meta = { ...sub.meta, ...r.meta }
      for (const item of r.items) {
        if (!byKey.has(item.key)) order.push(item.key)
        byKey.set(item.key, item)
      }
    }
    return { items: order.map((k) => byKey.get(k)!), turnEnded, metaChanged: JSON.stringify(sub.meta) !== before }
  }

  private restart(id: string, sub: Subscription, node: TerminalNodeData): void {
    sub.file = null
    sub.offset = 0
    sub.partial = ''
    sub.tools.clear()
    sub.meta = {}
    sub.nextDiscovery = 0
    const { items } = this.readInitial(id, sub, node)
    this.deps.emit({ id, items, reset: true, meta: { ...sub.meta } })
  }

  private poll(id: string): void {
    const sub = this.subs.get(id)
    if (!sub) return
    const node = this.deps.node(id)
    if (!node) return this.close(id)
    // Nova conversa (Claude: outra sessão; Codex: processo reiniciado): recomeça do histórico novo.
    const identity = this.identityOf(sub.agent, id, node)
    if (identity && identity !== sub.identity) {
      sub.identity = identity
      sub.codexId = node.sessionId ?? ''
      return this.restart(id, sub, node)
    }
    if (sub.agent === 'codex') {
      // Conversa esquecida ou trocada sem reiniciar o processo (ex.: "nova tarefa" num terminal hibernado).
      const codexId = node.sessionId ?? ''
      const forgotten = sub.codexId !== '' && codexId !== sub.codexId
      sub.codexId = codexId
      if (forgotten) return this.restart(id, sub, node)
    }
    const hadFile = sub.file !== null
    const file = this.locate(id, sub, node)
    if (!file) return
    if (!hadFile) {
      // Histórico apareceu agora (primeira mensagem do Codex): manda tudo de uma vez.
      sub.offset = 0
      return this.restart(id, sub, node)
    }
    let size: number
    try {
      size = fs.statSync(file).size
    } catch {
      return
    }
    if (size < sub.offset) return this.restart(id, sub, node)
    if (size === sub.offset) return
    let fd: number | null = null
    try {
      fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(size - sub.offset)
      fs.readSync(fd, buf, 0, buf.length, sub.offset)
      sub.offset = size
      const { items, turnEnded, metaChanged } = this.parseChunk(sub, buf.toString('utf8'), false)
      if (items.length || turnEnded || metaChanged) {
        this.deps.emit({ id, items: withThumbnails(items), turnEnded, ...(metaChanged ? { meta: { ...sub.meta } } : {}) })
      }
    } catch {
      // arquivo em uso: tenta no próximo ciclo
    } finally {
      if (fd !== null) fs.closeSync(fd)
    }
  }
}

/** Troca o base64 das imagens por uma miniatura (o original não vai ao renderer). */
function withThumbnails(items: ChatItem[]): ChatItem[] {
  return items.map((item) => {
    if (item.kind !== 'user' || item.images.length === 0) return item
    const images: ChatImage[] = item.images.map((img) => {
      if (!img.data) return img
      try {
        const image = nativeImage.createFromBuffer(Buffer.from(img.data, 'base64'))
        if (image.isEmpty()) return {}
        const { width } = image.getSize()
        const thumb = width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image
        return { src: thumb.toDataURL() }
      } catch {
        return {}
      }
    })
    return { ...item, images }
  })
}

function checkImage(p: string): string {
  if (!path.isAbsolute(p) || !IMAGE_FILE.test(p)) throw new Error('anexo inválido: use imagens (png, jpg, gif, webp ou bmp)')
  const st = fs.statSync(p, { throwIfNoEntry: false })
  if (!st?.isFile()) throw new Error(`imagem não encontrada: ${path.basename(p)}`)
  if (st.size > MAX_IMAGE_BYTES) throw new Error(`imagem grande demais: ${path.basename(p)}`)
  return p
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
