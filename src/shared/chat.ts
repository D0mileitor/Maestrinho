/**
 * Chat ligado a um terminal: o histórico que o Claude Code grava (JSONL da sessão) vira itens de
 * conversa, e a tela do terminal é inspecionada para achar perguntas com opções (permissões).
 * Lógica pura: o processo principal lê o arquivo e o renderer desenha.
 */

export interface ChatImage {
  /** data: URL (miniatura) — preenchido pelo processo principal. */
  src?: string
  mediaType?: string
  /** Base64 original (só entre o parser e o processo principal; nunca vai ao renderer). */
  data?: string
}

export type ChatItem =
  | { kind: 'user'; key: string; at: string; text: string; images: ChatImage[] }
  | { kind: 'orq'; key: string; at: string; from: string; text: string }
  | { kind: 'assistant'; key: string; at: string; text: string }
  | {
      kind: 'tool'
      key: string
      at: string
      name: string
      title: string
      /** Comando, caminho, padrão — o que identifica a chamada. */
      detail?: string
      diff?: { del: string[]; add: string[] }
      todos?: { text: string; status: string }[]
      result?: string
      error?: boolean
      done: boolean
    }
  | { kind: 'note'; key: string; at: string; text: string }
  | {
      /**
       * Ajudante (sub-agente do Claude Code): `call` é o pedido, no ponto da conversa em que o agente o
       * chamou (vira ✓ quando ele termina); `report` é a resposta dele, quando chega.
       */
      kind: 'helper'
      key: string
      at: string
      role: 'call' | 'report'
      /** Semente do rosto: o id da chamada (o escritório usa o mesmo, então é o mesmo estagiário). */
      seed: string
      /** Id do sub-agente no Claude Code (vem no resultado da chamada ou no relatório). */
      agentId?: string
      /** Tarefa que o agente deu ao ajudante ("Map Edi triage and parameters"). */
      title: string
      /** Tipo do ajudante (Explore, Plan, general-purpose…). */
      type?: string
      status: 'running' | 'done' | 'error'
      /** Resposta final do ajudante (Markdown). */
      report?: string
      usage?: { tokens?: number; tools?: number; ms?: number }
      endedAt?: string
    }

type ToolItem = Extract<ChatItem, { kind: 'tool' }>
export type HelperItem = Extract<ChatItem, { kind: 'helper' }>
/**
 * Estado do leitor do histórico: chamadas de ferramenta e de ajudantes já vistas (o resultado chega
 * depois, noutra linha). Guarda também apelidos "agente:<id>" que apontam para a chamada do ajudante.
 */
export type ParseState = Map<string, ToolItem | HelperItem>

/** Atualização incremental: itens novos ou substituídos (mesma chave). */
/** Modelo, esforço e modo de permissão da sessão (os da última resposta/mensagem). */
export interface ChatMeta {
  /** Id do modelo (ex.: claude-opus-5-5). */
  model?: string
  /** low | medium | high | xhigh | max */
  effort?: string
  /** default | acceptEdits | plan | auto | bypassPermissions */
  permissionMode?: string
}

export interface ChatUpdate {
  id: string
  items: ChatItem[]
  /** A sessão mudou (nova conversa): o renderer descarta o que tinha. */
  reset?: boolean
  /** O chat passou a ler o histórico deste agente (o terminal ganhou a sessão depois que o chat abriu). */
  agent?: ChatAgent
  /** O agente terminou a resposta (stop_reason end_turn). */
  turnEnded?: boolean
  meta?: ChatMeta
}

/** Agente cujo histórico o chat sabe ler. */
export type ChatAgent = 'claude' | 'codex'

export interface ChatSnapshot {
  /** transcript = histórico da sessão (Claude Code, Codex); screen = só a tela do terminal (shell...). */
  mode: 'transcript' | 'screen'
  agent: ChatAgent | null
  items: ChatItem[]
  /** Itens omitidos no começo (conversa longa). */
  omitted: number
  meta: ChatMeta
}

const MAX_RESULT_CHARS = 4000
const MAX_RESULT_LINES = 60
const MAX_DIFF_LINES = 40
const ORQ_MESSAGE = /^\[Mensagem de "([^"]+)" via [^\]]+\]\s*([\s\S]*?)(?:\n\(Para responder:[^\n]*\))?\s*$/

interface ContentBlock {
  type?: string
  text?: string
  name?: string
  id?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
  source?: { type?: string; media_type?: string; data?: string }
}

interface TranscriptEntry {
  type?: string
  uuid?: string
  timestamp?: string
  isMeta?: boolean
  isSidechain?: boolean
  isCompactSummary?: boolean
  isVisibleInTranscriptOnly?: boolean
  message?: { role?: string; content?: unknown; stop_reason?: string | null; model?: string }
  effort?: string
  permissionMode?: string
}

export interface ParseResult {
  items: ChatItem[]
  turnEnded: boolean
  meta?: ChatMeta
}

/** Modelo e esforço vêm nas respostas do agente; o modo de permissão, nas mensagens do usuário. */
function entryMeta(entry: TranscriptEntry): ChatMeta | undefined {
  if (entry.isSidechain) return undefined
  const meta: ChatMeta = {}
  if (entry.type === 'assistant') {
    const model = entry.message?.model
    if (typeof model === 'string' && model && !model.startsWith('<')) meta.model = model
    if (typeof entry.effort === 'string' && entry.effort) meta.effort = entry.effort
  }
  if (entry.type === 'user' && typeof entry.permissionMode === 'string' && entry.permissionMode) meta.permissionMode = entry.permissionMode
  return Object.keys(meta).length > 0 ? meta : undefined
}

/** Nome curto do modelo: claude-opus-5-5 → "Opus 5.5"; claude-3-5-sonnet-20241022 → "Sonnet 3.5". */
export function modelLabel(id: string): string {
  const longContext = /\[1m\]/i.test(id)
  const base = id.replace(/\[[^\]]*\]/g, '').replace(/-\d{8}$/, '')
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
  let label = base
  if (/^gpt-/i.test(base)) return `GPT-${base.slice(4)}`
  const modern = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(base)
  const legacy = /^claude-(\d+)(?:-(\d+))?-([a-z]+)$/.exec(base)
  if (modern) label = `${cap(modern[1]!)} ${modern[2]}${modern[3] ? `.${modern[3]}` : ''}`
  else if (legacy) label = `${cap(legacy[3]!)} ${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ''}`
  return longContext ? `${label} (1M)` : label
}

/**
 * Modo de permissão pela linha de status do Claude Code no terminal (vale na hora, inclusive depois
 * de Shift+Tab). null quando a linha não está visível.
 */
export function modeFromScreen(screen: string): string | null {
  const tail = screen.split('\n').slice(-8).join('\n')
  if (/auto mode on/i.test(tail)) return 'auto'
  if (/accept edits on/i.test(tail)) return 'acceptEdits'
  if (/plan mode on/i.test(tail)) return 'plan'
  if (/bypass permissions on/i.test(tail)) return 'bypassPermissions'
  if (/\? for shortcuts/i.test(tail)) return 'default'
  return null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function truncate(text: string): string {
  let out = text
  const lines = out.split('\n')
  if (lines.length > MAX_RESULT_LINES) out = lines.slice(0, MAX_RESULT_LINES).join('\n') + `\n… (+${lines.length - MAX_RESULT_LINES} linhas)`
  if (out.length > MAX_RESULT_CHARS) out = out.slice(0, MAX_RESULT_CHARS) + '\n… (resultado cortado)'
  return out
}

function lines(text: string): string[] {
  const all = text.replace(/\r\n/g, '\n').split('\n')
  return all.length > MAX_DIFF_LINES ? [...all.slice(0, MAX_DIFF_LINES), `… (+${all.length - MAX_DIFF_LINES} linhas)`] : all
}

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

/**
 * O Claude Code grava o texto que chega colado (o chat e o orq entregam assim) entre marcas
 * `<pasted_content id="…">`. O agente lê normalmente; na conversa só o conteúdo interessa.
 */
export function stripPasteTags(text: string): string {
  return text.replace(/<pasted_content(?:\s+id="[^"]*")?>\n?/g, '').replace(/\n?<\/pasted_content(?:\s+id="[^"]*")?>/g, '')
}

/** Texto de um tool_result (string ou lista de blocos). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b: ContentBlock) => (b?.type === 'text' ? str(b.text) : b?.type === 'image' ? '[imagem]' : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** Título e detalhes legíveis de uma chamada de ferramenta. */
export function describeTool(name: string, input: Record<string, unknown> = {}): Omit<Extract<ChatItem, { kind: 'tool' }>, 'kind' | 'key' | 'at' | 'done'> {
  const file = str(input['file_path']) || str(input['path']) || str(input['notebook_path'])
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return { name, title: str(input['description']) || 'Executou um comando', detail: str(input['command']) }
    case 'Read':
      return { name, title: `Leu ${baseName(file)}`, detail: file }
    case 'Write':
      return { name, title: `Escreveu ${baseName(file)}`, detail: file, diff: { del: [], add: lines(str(input['content'])) } }
    case 'Edit':
      return {
        name,
        title: `Editou ${baseName(file)}`,
        detail: file,
        diff: { del: lines(str(input['old_string'])), add: lines(str(input['new_string'])) }
      }
    case 'MultiEdit':
      return { name, title: `Editou ${baseName(file)}`, detail: file }
    case 'Grep':
      return { name, title: `Pesquisou "${str(input['pattern'])}"`, detail: str(input['path']) || undefined }
    case 'Glob':
      return { name, title: `Procurou arquivos ${str(input['pattern'])}`, detail: str(input['path']) || undefined }
    case 'Task':
    case 'Agent':
      return { name, title: `Agente: ${str(input['description']) || 'subtarefa'}`, detail: str(input['prompt']).slice(0, 600) || undefined }
    case 'Skill':
      return { name, title: `Usou a skill ${str(input['skill']) || str(input['name'])}` }
    case 'WebFetch':
      return { name, title: 'Abriu uma página', detail: str(input['url']) }
    case 'WebSearch':
      return { name, title: `Pesquisou na web "${str(input['query'])}"` }
    case 'AskUserQuestion': {
      const qs = Array.isArray(input['questions']) ? (input['questions'] as Record<string, unknown>[]) : []
      const detail = qs
        .map((q) => {
          const opts = Array.isArray(q['options']) ? (q['options'] as Record<string, unknown>[]).map((o) => `  • ${str(o['label'])}`) : []
          return [str(q['question']), ...opts].join('\n')
        })
        .join('\n\n')
      const first = str(qs[0]?.['question'])
      return { name, title: qs.length > 1 ? `Fez ${qs.length} perguntas` : first ? `Perguntou: ${first}` : 'Fez uma pergunta', detail: detail || undefined }
    }
    case 'TodoWrite': {
      const todos = Array.isArray(input['todos'])
        ? (input['todos'] as Record<string, unknown>[]).map((t) => ({ text: str(t['content']) || str(t['activeForm']), status: str(t['status']) }))
        : []
      return { name, title: 'Atualizou a lista de tarefas', todos }
    }
    default: {
      const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name)
      if (mcp) {
        const server = mcp[1]!.replace(/^plugin_[^_]+_/, '')
        const action = mcp[2]!.replace(/^browser_/, '').replace(/_/g, ' ')
        const target = str(input['url']) || str(input['element']) || str(input['text'])
        return { name, title: `${server}: ${action}`, detail: target || undefined }
      }
      return { name, title: name }
    }
  }
}

/**
 * Converte uma linha do JSONL da sessão em itens. `tools` guarda as chamadas já vistas (o resultado
 * chega depois, numa entrada do usuário) para devolver o item atualizado.
 */
export function parseTranscriptLine(line: string, tools: ParseState): ParseResult {
  let entry: TranscriptEntry
  try {
    entry = JSON.parse(line) as TranscriptEntry
  } catch {
    return { items: [], turnEnded: false }
  }
  if (!entry || typeof entry !== 'object') return { items: [], turnEnded: false }
  const meta = entryMeta(entry)
  const result = parseEntry(entry, tools)
  return meta ? { ...result, meta } : result
}

const HANDBACK = /<agent-message from="([^"]+)">\n?([\s\S]*?)<\/agent-message>/

/**
 * Relatório que um ajudante entregou ao agente ("Another Claude session sent a message:
 * <agent-message from=…>"): tira o aviso do começo e o recuo de 2 espaços que o Claude Code põe em cada linha.
 */
export function parseHandback(text: string): { agentId: string; report: string } | null {
  const m = HANDBACK.exec(text)
  if (!m) return null
  let body = m[2]!
  const marker = body.indexOf('The report follows:')
  if (marker >= 0) body = body.slice(body.indexOf('\n', marker) + 1)
  else if (/^\s*\[Subagent hand-back\]/.test(body)) body = body.slice(body.indexOf('\n') + 1)
  const report = body
    .split('\n')
    .map((l) => (l.startsWith('  ') ? l.slice(2) : l))
    .join('\n')
    .trim()
  return { agentId: m[1]!, report }
}

export interface TaskNotification {
  taskId: string
  toolUseId?: string
  /** completed, failed, killed… */
  status: string
  summary: string
  usage?: { tokens?: number; tools?: number; ms?: number }
}

/** Avisos de tarefa em segundo plano que o Claude Code entrega ao agente (`<task-notification>…`). */
export function parseTaskNotifications(text: string): TaskNotification[] {
  const out: TaskNotification[] = []
  for (const m of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const tag = (name: string): string => (new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(m[1]!)?.[1] ?? '').trim()
    const num = (name: string): number | undefined => {
      const v = tag(name)
      return v && Number.isFinite(Number(v)) ? Number(v) : undefined
    }
    const usage = { tokens: num('subagent_tokens'), tools: num('tool_uses'), ms: num('duration_ms') }
    out.push({
      taskId: tag('task-id'),
      ...(tag('tool-use-id') ? { toolUseId: tag('tool-use-id') } : {}),
      status: tag('status'),
      summary: tag('summary'),
      ...(usage.tokens !== undefined || usage.tools !== undefined || usage.ms !== undefined ? { usage } : {})
    })
  }
  return out
}

/** Resultado de um ajudante em primeiro plano, sem as linhas técnicas do fim (id para retomar, uso). */
function cleanReport(text: string): string {
  return text
    .replace(/<usage>[\s\S]*?<\/usage>/g, '')
    .split('\n')
    .filter((l) => !/^\s*agentId:\s*\S+/.test(l))
    .join('\n')
    .trim()
}

/** A chamada do ajudante (pelo id da chamada ou pelo id do sub-agente), na versão mais recente. */
function findHelperCall(state: ParseState, toolUseId: string | undefined, agentId: string | undefined): HelperItem | undefined {
  const byTool = toolUseId ? state.get(toolUseId) : undefined
  if (byTool?.kind === 'helper') return byTool
  const alias = agentId ? state.get(`agente:${agentId}`) : undefined
  const current = alias ? state.get(alias.key) : undefined
  return current?.kind === 'helper' ? current : undefined
}

function saveHelper(state: ParseState, item: HelperItem): HelperItem {
  state.set(item.key, item)
  if (item.role === 'call' && item.agentId) state.set(`agente:${item.agentId}`, item)
  return item
}

/** Relatório de um ajudante: a chamada vira ✓ e entra a resposta dele, com o mesmo rosto. */
function helperReport(state: ParseState, agentId: string, report: string, at: string): ChatItem[] {
  const call = findHelperCall(state, undefined, agentId)
  const items: ChatItem[] = []
  if (call && call.status === 'running') items.push(saveHelper(state, { ...call, status: 'done', endedAt: at }))
  const key = `relatorio:${agentId}`
  const prev = state.get(key)
  const item: HelperItem = {
    kind: 'helper',
    key,
    at: prev?.kind === 'helper' ? prev.at : at,
    role: 'report',
    seed: call?.seed ?? agentId,
    agentId,
    title: call?.title ?? 'Ajudante',
    ...(call?.type ? { type: call.type } : {}),
    status: 'done',
    report,
    ...(prev?.kind === 'helper' && prev.usage ? { usage: prev.usage } : {}),
    endedAt: at
  }
  items.push(saveHelper(state, item))
  return items
}

/** Avisos de término: o do ajudante atualiza a chamada e a resposta; o de comando em segundo plano vira uma nota. */
function notificationItems(state: ParseState, list: TaskNotification[], at: string, uuid: string): ChatItem[] {
  const items: ChatItem[] = []
  list.forEach((n, i) => {
    const call = findHelperCall(state, n.toolUseId, n.taskId)
    const named = /^Agent "(.+)"/.exec(n.summary)
    if (!call && !named) {
      if (n.summary) items.push({ kind: 'note', key: `${uuid}:${i}`, at, text: `Segundo plano: ${n.summary}` })
      return
    }
    const status: HelperItem['status'] = n.status === 'completed' ? 'done' : 'error'
    if (call) items.push(saveHelper(state, { ...call, agentId: call.agentId ?? n.taskId, status, endedAt: call.endedAt ?? at, ...(n.usage ? { usage: n.usage } : {}) }))
    const key = `relatorio:${n.taskId}`
    const prev = state.get(key)
    // Sem relatório (falhou ou foi interrompido): a resposta do ajudante é só o aviso.
    const report: HelperItem =
      prev?.kind === 'helper'
        ? { ...prev, status: prev.report ? prev.status : status, ...(n.usage ? { usage: n.usage } : {}) }
        : {
            kind: 'helper',
            key,
            at,
            role: 'report',
            seed: call?.seed ?? n.taskId,
            agentId: n.taskId,
            title: call?.title ?? named?.[1] ?? 'Ajudante',
            ...(call?.type ? { type: call.type } : {}),
            status,
            ...(n.usage ? { usage: n.usage } : {}),
            endedAt: at
          }
    items.push(saveHelper(state, report))
  })
  return items
}

function parseEntry(entry: TranscriptEntry, tools: ParseState): ParseResult {
  const out: ChatItem[] = []
  if (!entry || entry.isSidechain) return { items: out, turnEnded: false }
  const at = str(entry.timestamp)
  const uuid = str(entry.uuid) || `${at}-${Math.random().toString(36).slice(2)}`
  const content = entry.message?.content

  if (entry.type === 'user') {
    if (entry.isCompactSummary) return { items: [{ kind: 'note', key: uuid, at, text: 'A conversa foi resumida para liberar contexto.' }], turnEnded: false }
    if (entry.isMeta || entry.isVisibleInTranscriptOnly) {
      const raw = typeof content === 'string' ? content : Array.isArray(content) ? (content as ContentBlock[]).map((b) => (b?.type === 'text' ? str(b.text) : '')).join('\n') : ''
      const handback = raw.includes('<agent-message') ? parseHandback(raw) : null
      return { items: handback ? helperReport(tools, handback.agentId, handback.report, at) : out, turnEnded: false }
    }
    const blocks: ContentBlock[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? (content as ContentBlock[]) : []
    const texts: string[] = []
    const images: ChatImage[] = []
    for (const b of blocks) {
      if (b?.type === 'tool_result' && b.tool_use_id) {
        const tool = tools.get(b.tool_use_id)
        if (tool?.kind === 'helper') {
          const result = resultText(b.content)
          const agentId = /agentId:\s*([A-Za-z0-9_-]+)/.exec(result)?.[1]
          if (/^\s*Async agent launched/i.test(result)) {
            // Em segundo plano: por enquanto só o id; o relatório e o aviso chegam depois.
            if (agentId && !tool.agentId) out.push(saveHelper(tools, { ...tool, agentId }))
          } else {
            // Em primeiro plano: o resultado já é a resposta.
            const id = agentId ?? tool.agentId
            const call = saveHelper(tools, { ...tool, ...(id ? { agentId: id } : {}), status: b.is_error ? 'error' : 'done', endedAt: at })
            out.push(call)
            const report: HelperItem = {
              kind: 'helper',
              key: `relatorio:${id ?? tool.seed}`,
              at,
              role: 'report',
              seed: tool.seed,
              ...(id ? { agentId: id } : {}),
              title: tool.title,
              ...(tool.type ? { type: tool.type } : {}),
              status: call.status,
              report: cleanReport(result),
              endedAt: at
            }
            out.push(saveHelper(tools, report))
          }
        } else if (tool) {
          const updated = { ...tool, done: true, error: Boolean(b.is_error), result: truncate(resultText(b.content)) }
          tools.set(b.tool_use_id, updated)
          out.push(updated)
        }
      } else if (b?.type === 'text' && b.text) {
        texts.push(b.text)
      } else if (b?.type === 'image' && b.source?.type === 'base64' && b.source.data) {
        images.push({ mediaType: b.source.media_type, data: b.source.data })
      }
    }
    const text = stripPasteTags(texts.join('\n')).trim()
    if (!text && images.length === 0) return { items: out, turnEnded: false }
    // Comandos locais (/usage, /model) e a saída deles: só uma linha discreta.
    const command = /<command-name>([^<]+)<\/command-name>/.exec(text)
    if (command) return { items: [...out, { kind: 'note', key: uuid, at, text: `Comando ${command[1]!.trim()}` }], turnEnded: false }
    if (/^<local-command-(stdout|stderr)>/.test(text) || /^<(bash-input|bash-stdout|bash-stderr)>/.test(text)) return { items: out, turnEnded: false }
    if (/^\[Request interrupted by user/.test(text)) return { items: [...out, { kind: 'note', key: uuid, at, text: 'Interrompido pelo usuário.' }], turnEnded: false }
    if (text.startsWith('<task-notification>')) return { items: [...out, ...notificationItems(tools, parseTaskNotifications(text), at, uuid)], turnEnded: false }
    const orq = ORQ_MESSAGE.exec(text)
    if (orq) return { items: [...out, { kind: 'orq', key: uuid, at, from: orq[1]!, text: orq[2]!.trim() }], turnEnded: false }
    out.push({ kind: 'user', key: uuid, at, text: text.replace(/\[Image #\d+\]\s*/g, '').trim(), images })
    return { items: out, turnEnded: false }
  }

  if (entry.type === 'assistant' && Array.isArray(content)) {
    ;(content as ContentBlock[]).forEach((b, i) => {
      if (b?.type === 'text' && b.text?.trim()) {
        out.push({ kind: 'assistant', key: `${uuid}:${i}`, at, text: b.text.trim() })
      } else if (b?.type === 'tool_use' && b.id && (b.name === 'Agent' || b.name === 'Task')) {
        const input = b.input ?? {}
        const type = str(input['subagent_type'])
        out.push(
          saveHelper(tools, { kind: 'helper', key: b.id, at, role: 'call', seed: b.id, title: str(input['description']) || 'Ajudante', ...(type ? { type } : {}), status: 'running' })
        )
      } else if (b?.type === 'tool_use' && b.id && b.name) {
        const item: Extract<ChatItem, { kind: 'tool' }> = { kind: 'tool', key: b.id, at, done: false, ...describeTool(b.name, b.input ?? {}) }
        tools.set(b.id, item)
        out.push(item)
      }
    })
    return { items: out, turnEnded: entry.message?.stop_reason === 'end_turn' }
  }
  return { items: out, turnEnded: false }
}

// ------------------------------------------------------------------ Codex (~/.codex/sessions/…/rollout-*.jsonl)

interface CodexRecord {
  type?: string
  timestamp?: string
  ordinal?: number
  payload?: Record<string, unknown>
}

/** Contexto que o Codex injeta como mensagem do usuário (instruções, ambiente) — não é conversa. */
const CODEX_CONTEXT = /^\s*(# AGENTS\.md instructions|<environment_context>|<user_instructions>|<permissions instructions|<skills_instructions>|<collaboration_mode>)/

function codexArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return { input: raw }
  }
}

/** Saída de uma ferramenta do Codex: texto, JSON com "output", ou lista de blocos. */
function codexOutput(raw: unknown): string {
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t.startsWith('{')) {
      try {
        const v = JSON.parse(t) as Record<string, unknown>
        if (typeof v['output'] === 'string') return v['output']
      } catch {
        // texto comum
      }
    }
    return raw
  }
  if (Array.isArray(raw)) return raw.map((b: ContentBlock) => (typeof b?.text === 'string' ? b.text : '')).filter(Boolean).join('\n')
  if (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>)['output'] === 'string') return (raw as Record<string, string>)['output']!
  return ''
}

function patchFiles(patch: string): { files: string[]; del: string[]; add: string[] } {
  const files: string[] = []
  const del: string[] = []
  const add: string[] = []
  for (const l of patch.split('\n')) {
    const f = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(l)
    if (f) files.push(f[1]!.trim())
    else if (l.startsWith('+') && !l.startsWith('+++')) add.push(l.slice(1))
    else if (l.startsWith('-') && !l.startsWith('---')) del.push(l.slice(1))
  }
  const cut = (a: string[]): string[] => (a.length > MAX_DIFF_LINES ? [...a.slice(0, MAX_DIFF_LINES), `… (+${a.length - MAX_DIFF_LINES} linhas)`] : a)
  return { files, del: cut(del), add: cut(add) }
}

/** Título e detalhes das ferramentas do Codex (comandos, patch, plano, navegador do Playwright). */
export function describeCodexTool(name: string, args: Record<string, unknown>): Omit<Extract<ChatItem, { kind: 'tool' }>, 'kind' | 'key' | 'at' | 'done'> {
  switch (name) {
    case 'exec_command':
    case 'shell_command':
    case 'shell':
    case 'local_shell': {
      const cmd = Array.isArray(args['command']) ? (args['command'] as unknown[]).map(String).join(' ') : str(args['cmd']) || str(args['command'])
      return { name, title: 'Executou um comando', detail: cmd }
    }
    case 'write_stdin':
      return { name, title: 'Enviou entrada a um comando' }
    case 'apply_patch': {
      const patch = str(args['input']) || str(args['patch'])
      const { files, del, add } = patchFiles(patch)
      const names = files.map(baseName)
      return { name, title: names.length ? `Editou ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` e +${names.length - 3}` : ''}` : 'Editou arquivos', detail: files.join('\n') || undefined, diff: { del, add } }
    }
    case 'update_plan': {
      const plan = Array.isArray(args['plan']) ? (args['plan'] as Record<string, unknown>[]) : []
      return { name, title: 'Atualizou o plano', todos: plan.map((p) => ({ text: str(p['step']), status: str(p['status']) })) }
    }
    case 'view_image':
      return { name, title: `Abriu a imagem ${baseName(str(args['path']))}`, detail: str(args['path']) || undefined }
    case 'web_search':
      return { name, title: `Pesquisou na web "${str(args['query'])}"` }
    default:
      if (/^browser_/.test(name)) {
        const target = str(args['url']) || str(args['element']) || str(args['target']) || str(args['action'])
        return { name, title: `navegador: ${name.slice(8).replace(/_/g, ' ')}`, detail: target || undefined }
      }
      return describeTool(name, args)
  }
}

/** Converte uma linha do histórico do Codex em itens (mesmo formato do Claude Code). */
export function parseCodexLine(line: string, tools: ParseState): ParseResult {
  let rec: CodexRecord
  try {
    rec = JSON.parse(line) as CodexRecord
  } catch {
    return { items: [], turnEnded: false }
  }
  const p = rec?.payload
  if (!rec || typeof rec !== 'object' || !p || typeof p !== 'object') return { items: [], turnEnded: false }
  const at = str(rec.timestamp)
  const fallbackKey = `cx${rec.ordinal ?? ''}-${at}`

  if (rec.type === 'turn_context') {
    const meta: ChatMeta = {}
    if (str(p['model'])) meta.model = str(p['model'])
    if (str(p['effort'])) meta.effort = str(p['effort'])
    if (str(p['approval_policy'])) meta.permissionMode = `codex:${str(p['approval_policy'])}`
    return { items: [], turnEnded: false, meta }
  }
  if (rec.type === 'event_msg') return { items: [], turnEnded: p['type'] === 'task_complete' }
  if (rec.type !== 'response_item') return { items: [], turnEnded: false }

  const type = str(p['type'])
  if (type === 'message') {
    const role = str(p['role'])
    const blocks = Array.isArray(p['content']) ? (p['content'] as Record<string, unknown>[]) : []
    const key = str(p['id']) || fallbackKey
    if (role === 'assistant') {
      const text = blocks.map((b) => (b['type'] === 'output_text' ? str(b['text']) : '')).join('\n').trim()
      return { items: text ? [{ kind: 'assistant', key, at, text }] : [], turnEnded: false }
    }
    if (role !== 'user') return { items: [], turnEnded: false }
    const texts: string[] = []
    const images: ChatImage[] = []
    for (const b of blocks) {
      if (b['type'] === 'input_text' && str(b['text']) && !CODEX_CONTEXT.test(str(b['text']))) texts.push(str(b['text']))
      if (b['type'] === 'input_image') {
        const m = /^data:([^;]+);base64,(.+)$/s.exec(str(b['image_url']))
        if (m) images.push({ mediaType: m[1], data: m[2] })
      }
    }
    const text = stripPasteTags(texts.join('\n')).trim()
    if (!text && images.length === 0) return { items: [], turnEnded: false }
    const orq = ORQ_MESSAGE.exec(text)
    if (orq) return { items: [{ kind: 'orq', key, at, from: orq[1]!, text: orq[2]!.trim() }], turnEnded: false }
    return { items: [{ kind: 'user', key, at, text: text.replace(/\[Image #\d+\]\s*/g, '').trim(), images }], turnEnded: false }
  }
  if (type === 'function_call' || type === 'custom_tool_call') {
    const callId = str(p['call_id']) || str(p['id']) || fallbackKey
    const args = type === 'custom_tool_call' ? { input: p['input'] } : codexArgs(p['arguments'])
    const item: Extract<ChatItem, { kind: 'tool' }> = { kind: 'tool', key: callId, at, done: false, ...describeCodexTool(str(p['name']), args) }
    tools.set(callId, item)
    return { items: [item], turnEnded: false }
  }
  if (type === 'function_call_output' || type === 'custom_tool_call_output') {
    const tool = tools.get(str(p['call_id']))
    if (tool?.kind !== 'tool') return { items: [], turnEnded: false }
    const output = codexOutput(p['output'])
    const exit = /exited with code (-?\d+)/i.exec(output)
    const updated = { ...tool, done: true, error: Boolean(exit && exit[1] !== '0'), result: truncate(output) }
    tools.set(str(p['call_id']), updated)
    return { items: [updated], turnEnded: false }
  }
  return { items: [], turnEnded: false }
}

/** Primeira linha de um histórico do Codex: id, pasta e início da sessão. */
export function codexSessionMeta(firstLine: string): { id: string; cwd: string; startedAt: number } | null {
  try {
    const rec = JSON.parse(firstLine) as CodexRecord
    if (rec.type !== 'session_meta' || !rec.payload) return null
    const cwd = str(rec.payload['cwd'])
    const ts = Date.parse(str(rec.payload['timestamp']) || str(rec.timestamp))
    if (!cwd || !Number.isFinite(ts)) return null
    return { id: str(rec.payload['id']) || str(rec.payload['session_id']), cwd, startedAt: ts }
  } catch {
    return null
  }
}

export interface PendingChoice {
  /** Pergunta (ex.: "Do you want to proceed?"). */
  question: string
  /** Trecho da tela com o contexto da pergunta. */
  excerpt: string
  /** Opções na ordem da tela; `cursor` = a que está selecionada agora. */
  options: {
    label: string
    number?: string
    /** Explicação da opção (linhas recuadas abaixo dela, nas perguntas do AskUserQuestion). */
    detail?: string
    /** Opção de resposta livre ("Type something."): recebe texto em vez de só Enter. */
    input?: boolean
    /** Múltipla escolha: a opção está marcada ([✔]) ou não ([ ]). Ausente = pergunta de escolha única. */
    checked?: boolean
    /** Botão de confirmar da múltipla escolha ("Submit"): Enter nele envia as marcadas. */
    submit?: boolean
  }[]
  cursor: number
  /** O cursor (❯) foi encontrado na tela; senão, `cursor` é só um palpite. */
  cursorKnown: boolean
  /** Abas de um questionário com várias perguntas (ex.: "☒ Momento · ☐ Opcionais · ✓ Submit"). */
  progress?: string
  /** Múltipla escolha: escolher uma opção marca/desmarca; o envio é pelo "Submit". */
  multi?: boolean
}

const CURSOR = /^\s*[❯›▶>]\s+/
const NUMBERED = /^\s*(?:[❯›▶>]\s+)?(\d{1,2})[.)]\s+(.+?)\s*$/
/** Até quantas linhas acima das opções procurar a pergunta (o aviso de confiança na pasta é longo). */
const QUESTION_WINDOW = 12
/** Rodapé de instrução do menu (Claude Code: "Enter to select"; Codex: "enter select · esc back"). */
const FOOTER = /enter (to )?(confirm|select)|esc (to )?(cancel|exit|back)|↑\/↓|arrow keys/i
/** Linha em branco ou só de traços (separador entre opções). */
const SEPARATOR = /^[\s─━═╌┄-]*$/
/** Abas do questionário do Claude Code (AskUserQuestion): "←  ☒ Momento  ☐ Opcionais  ✓ Submit  →". */
const TABS = /[☐☒]/
const FREE_TEXT = /^(type something|other|outro|digite algo|tell claude what to change)\.?$/i
/** Painel de prévia à direita das opções (AskUserQuestion com preview): moldura e conteúdo dela. */
const PREVIEW_COLUMN = /\s{2,}[│┃┌┐└┘├┤┬┴┼╭╮╰╯║╔╗╚╝╠╣].*$/
/** Marcação da múltipla escolha no começo do rótulo: "[ ] CPF", "[✔] Nome". */
const CHECK = /^\[([ xX✔✓×])\]\s+/
/** Botão de confirmar da múltipla escolha. */
const SUBMIT = /^(submit|enviar|confirmar)$/i
/** Atalho no fim do rótulo das aprovações do Codex: "Yes, proceed (y)", "… (esc)". */
const SHORTCUT_END = /\((?:[a-z]|esc|enter|shift\+tab)\)$/i
/** Rodapé do painel de prévia ("Notes: press n to add notes"). */
const PREVIEW_NOTE = /^notes?:|press n to add notes/i
/** Linha só de moldura de caixa (bordas de cima/baixo, laterais vazias). */
const BOX_ONLY = /^[\s─━═╭╮╰╯│┃┌┐└┘├┤┬┴┼-]*$/

/** Texto de uma linha sem a barra/moldura à esquerda (perguntas longas vêm com "│ " na frente). */
function stripBar(line: string): string {
  return line
    .trim()
    .replace(/^[│┃]\s?/, '')
    .replace(/\s?[│┃]$/, '')
    .trim()
}

/** Junta as linhas de um parágrafo quebrado pela largura da tela (quebra de frase vira quebra de linha). */
function joinWrapped(lines: string[]): string {
  let out = ''
  for (const l of lines) {
    if (!out) out = l
    else out += /[.:?!]$/.test(out) ? `\n${l}` : ` ${l}`
  }
  return out
}

/**
 * Pergunta acima das opções: a linha com "?" mais perto delas, junto com o resto do parágrafo (a frase
 * pode ter quebrado em várias linhas ou continuar depois do "?"), cortada no último "?".
 */
function findQuestion(tail: string[], start: number): { text: string; top: number } | null {
  const floor = Math.max(0, start - QUESTION_WINDOW)
  for (let i = start - 1; i >= floor; i--) {
    if (!stripBar(tail[i]!).includes('?')) continue
    let top = i
    while (top - 1 >= floor && stripBar(tail[top - 1]!) && !BOX_ONLY.test(tail[top - 1]!) && !TABS.test(tail[top - 1]!)) top--
    const para = tail
      .slice(top, i + 1)
      .map(stripBar)
      .join(' ')
    // Aprovação do Codex: o "Reason: …?" é a justificativa do modelo; a pergunta é a de cima.
    if (/^Reason:/i.test(para)) {
      const above = findQuestion(tail, top)
      if (above) return above
    }
    let text = para.slice(0, para.lastIndexOf('?') + 1).trim()
    // Parágrafo comprido: fica a última frase (a pergunta em si).
    if (text.length > 160) {
      const cut = Math.max(text.lastIndexOf('. ', text.length - 2), text.lastIndexOf(': ', text.length - 2))
      if (cut > 0) text = text.slice(cut + 2).trim()
    }
    return { text, top }
  }
  return null
}

/** Menu sem pergunta com "?" (ex.: "Update Model Permissions" do Codex): o título curto logo acima das opções. */
function menuTitle(tail: string[], start: number): { text: string; top: number } | null {
  for (let i = start - 1; i >= Math.max(0, start - 4); i--) {
    const text = stripBar(tail[i]!)
    if (!text || BOX_ONLY.test(text) || /^[↑↓]$/.test(text)) continue
    return text.length <= 80 && !NUMBERED.test(tail[i]!) ? { text, top: i } : null
  }
  return null
}

/**
 * Pergunta com opções esperando resposta no fim da tela (permissão do Claude Code, confiança na
 * pasta, perguntas do AskUserQuestion — inclusive múltipla escolha e prévia lado a lado —, saída do modo de
 * plano, aprovações do Codex). Lê as linhas físicas da tela (`PtyManager.readScreen`). Conservador: exige
 * opções numeradas a partir de 1, ou um menu com cursor e rodapé de instrução, para não confundir o campo
 * de digitação com um menu.
 */
export function detectPendingChoice(screen: string): PendingChoice | null {
  const all = screen.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''))
  while (all.length && all[all.length - 1]!.trim() === '') all.pop()
  const tail = all.slice(-40)
  const hasFooter = tail.slice(-6).some((l) => FOOTER.test(l))

  // Bloco de opções mais próximo do fim (até 12 linhas acima).
  let end = -1
  for (let i = tail.length - 1; i >= Math.max(0, tail.length - 12); i--) {
    if (NUMBERED.test(tail[i]!) || (hasFooter && CURSOR.test(tail[i]!))) {
      end = i
      break
    }
  }
  if (end < 0) return null
  // O cursor pode estar numa opção do meio: as opções abaixo dele também fazem parte do menu.
  const optionLike = (l: string): boolean => l.trim() !== '' && !FOOTER.test(l) && (NUMBERED.test(l) || /^\s{2,}\S/.test(l) || CURSOR.test(l))
  while (end + 1 < tail.length && optionLike(tail[end + 1]!)) end++
  let start = end
  for (;;) {
    if (start - 1 >= 0 && optionLike(tail[start - 1]!)) {
      start--
      continue
    }
    // Linhas em branco ou separadores entre opções (o "Chat about this" do AskUserQuestion fica depois de
    // um separador; na múltipla escolha, acima dele vem o "Submit", que não é numerado).
    let k = start - 1
    while (k >= 0 && k >= start - 3 && SEPARATOR.test(tail[k]!)) k--
    if (k >= 0 && k < start - 1 && (NUMBERED.test(tail[k]!) || SUBMIT.test(tail[k]!.trim()))) {
      start = k
      continue
    }
    break
  }
  const block = tail.slice(start, end + 1)
  const options: PendingChoice['options'] = []
  let cursor = 0
  let cursorKnown = false
  const numberedCount = block.filter((l) => NUMBERED.test(l)).length
  if (numberedCount >= 2) {
    for (const l of block) {
      const m = NUMBERED.exec(l)
      if (CURSOR.test(l)) {
        cursor = options.length
        cursorKnown = true
      }
      if (m) {
        let label = m[2]!.replace(PREVIEW_COLUMN, '').trim()
        const check = CHECK.exec(label)
        if (check) label = label.slice(check[0].length).trim()
        // Menu em colunas ("Full Access          Use with caution: …"): a segunda coluna é a explicação.
        const cols = /^(.{1,40}?)\s{2,}(\S.{8,})$/.exec(label)
        const detail = cols ? cols[2]! : undefined
        if (cols) label = cols[1]!.trim()
        options.push({
          number: m[1],
          label,
          ...(detail ? { detail } : {}),
          ...(check ? { checked: check[1] !== ' ' } : {}),
          ...(FREE_TEXT.test(label) ? { input: true } : {})
        })
        continue
      }
      // Linha sem número: botão de confirmar, conteúdo do painel de prévia ou explicação da opção de cima.
      const text = l.replace(PREVIEW_COLUMN, '').replace(CURSOR, '').trim()
      if (!text || SEPARATOR.test(text) || BOX_ONLY.test(text) || PREVIEW_NOTE.test(text)) {
        if (CURSOR.test(l)) cursor = Math.max(0, options.length - 1)
        continue
      }
      if (SUBMIT.test(text)) {
        options.push({ label: text, submit: true })
        continue
      }
      const last = options[options.length - 1]
      if (last && !last.submit) last.detail = last.detail ? `${last.detail} ${text}` : text
    }
    // Rótulo que a TUI quebrou em duas linhas: a continuação termina no atalho da opção ("(p)", "(esc)").
    for (const o of options) {
      if (o.detail && !SHORTCUT_END.test(o.label) && SHORTCUT_END.test(o.detail) && o.detail.length < 80) {
        o.label = `${o.label} ${o.detail}`
        delete o.detail
      }
    }
    // Lista numerada comum (na resposta do agente) não tem cursor nem rodapé de instrução; lista rolada
    // (o "1." subiu para fora da tela) só vale com cursor e rodapé.
    if (!cursorKnown && !hasFooter) return null
    if (options[0]?.number !== '1' && !(cursorKnown && hasFooter)) return null
  } else if (hasFooter) {
    block.forEach((l) => {
      if (CURSOR.test(l)) {
        cursor = options.length
        cursorKnown = true
      }
      const label = l.replace(CURSOR, '').replace(PREVIEW_COLUMN, '').trim()
      if (label && !SEPARATOR.test(l) && !BOX_ONLY.test(label)) options.push({ label, ...(SUBMIT.test(label) ? { submit: true } : {}) })
    })
    if (options.length < 2 || !cursorKnown) return null
  } else {
    return null
  }
  const multi = options.some((o) => o.checked !== undefined)
  const extra = multi ? { multi: true } : {}
  // Questionário com abas: a pergunta é o texto entre as abas e as opções.
  let tabs = start - 1
  while (tabs >= 0 && tabs >= start - QUESTION_WINDOW && !TABS.test(tail[tabs]!)) tabs--
  if (tabs >= 0 && tabs >= start - QUESTION_WINDOW) {
    const text = joinWrapped(
      tail
        .slice(tabs + 1, start)
        .map(stripBar)
        .filter((l) => l && !SEPARATOR.test(l) && !BOX_ONLY.test(l))
    )
    const progress = tail[tabs]!.replace(/[←→─]/g, '').trim().split(/\s{2,}/).join(' · ')
    return { question: text || 'O agente está esperando uma escolha', excerpt: '', options, cursor, cursorKnown, progress, ...extra }
  }
  const found = findQuestion(tail, start) ?? menuTitle(tail, start)
  const question = found?.text || 'O agente está esperando uma escolha'
  const excerptStart = Math.max(0, (found ? found.top : start) - 6)
  const excerpt = tail
    .slice(excerptStart, found ? found.top : start)
    .filter((l) => !BOX_ONLY.test(l) && l.trim() !== question)
    .join('\n')
    .trim()
  return { question, excerpt, options, cursor, cursorKnown, ...extra }
}

/**
 * Sequência de teclas para escolher a opção `index`, uma tecla por passo (o chat envia com uma pequena
 * pausa entre elas): setas a partir do cursor e Enter; numa opção de resposta livre, o texto antes do
 * Enter. Sem cursor conhecido, o número da opção.
 */
export function choiceSteps(choice: PendingChoice, index: number, text?: string): string[] {
  const opt = choice.options[index]
  if (!opt) return []
  if (!choice.cursorKnown) return opt.number ? [opt.number] : []
  const delta = index - choice.cursor
  const arrow = delta > 0 ? '\x1b[B' : '\x1b[A'
  const steps: string[] = Array.from({ length: Math.abs(delta) }, () => arrow)
  const typed = (text ?? '').replace(/\s*\n\s*/g, ' ').trim()
  if (opt.input && typed) steps.push(typed)
  steps.push('\r')
  return steps
}

/** As mesmas teclas de `choiceSteps` juntas numa string. */
export function keysForChoice(choice: PendingChoice, index: number, text?: string): string {
  return choiceSteps(choice, index, text).join('')
}

/** Última resposta escrita do agente num trecho do histórico (Claude Code ou Codex). */
export function lastAssistantText(tail: string, agent: ChatAgent): string {
  const parse = agent === 'claude' ? parseTranscriptLine : parseCodexLine
  const tools: ParseState = new Map()
  let last = ''
  for (const line of tail.split('\n')) {
    if (!line.trim()) continue
    for (const item of parse(line, tools).items) if (item.kind === 'assistant' && item.text.trim()) last = item.text
  }
  return last
}
