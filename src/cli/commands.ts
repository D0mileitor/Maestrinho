import { ApiRequestSchemas, type ApiMethod, type ApiResults, type SendResult, type WaitResult } from '@shared/api'
import { hookInfoFromPayload } from '@shared/agentEvents'
import { APP_NAME, CLI_NAME } from '@shared/constants'
import type { FlagName, ParsedArgs } from './args'
import { ApiClient, WAIT_GRACE_MS, requestIssueError, sessionFromEnv, type Env } from './client'
import { CliError, EXIT, isCliError, oneLine, usageError, type HintScope } from './errors'
import {
  cleanBlock,
  fmtDuration,
  formatNoteList,
  formatPeers,
  formatRead,
  formatRecruit,
  formatReply,
  formatRoleList,
  formatWhoami,
  formatBoardCard,
  formatBoardList,
  formatBoardShow
} from './format'
import type { HelpTopic } from './help'
import {
  cleanMessage,
  emptySourceError,
  loadText,
  planText,
  refArg,
  withTrailingNewline,
  type TextPlan
} from './input'
import type { CliIo } from './io'
import { parseResult } from './results'

/** Espera total padrão de `send --wait`. */
export const DEFAULT_WAIT_TIMEOUT_MS = 600_000
/** Long-poll de cada chamada `wait` (o servidor segura a requisição até isso). */
export const POLL_MS = 20_000
/** Intervalo mínimo entre polls, caso o servidor responda "ainda não" imediatamente. */
export const MIN_POLL_GAP_MS = 250
/** Tempo máximo do pedido de cancelamento da espera (menor que a saída forçada após Ctrl+C em orq.ts). */
const CANCEL_TIMEOUT_MS = 2_000
const MAX_WAIT_TIMEOUT_MS = 7 * 24 * 3_600_000

const c = CLI_NAME

/** Contexto de execução de um comando. */
export interface Ctx {
  readonly io: CliIo
  readonly json: boolean
  /** Cliente da API (lê ORQ_PORT/ORQ_TOKEN na primeira chamada; fora do app lança erro de uso). */
  client(): ApiClient
  /** Escreve uma linha (ou bloco) na saída padrão. */
  print(text: string): void
  /** Resultado de um comando: JSON cru com --json; senão o texto, se o formato bater com o protocolo. */
  show<M extends ApiMethod>(method: M, raw: unknown, human: (r: ApiResults[M]) => string): void
  /** Validação estrita (para resultados de que o fluxo depende, ex.: messageId). */
  parse<M extends ApiMethod>(method: M, raw: unknown): ApiResults[M]
}

export function createCtx(io: CliIo, env: Env, json: boolean): Ctx {
  let client: ApiClient | undefined
  const print = (text: string): void => io.out(text.endsWith('\n') ? text : `${text}\n`)
  return {
    io,
    json,
    client: () => (client ??= new ApiClient(sessionFromEnv(env))),
    print,
    show(method, raw, human) {
      if (json) {
        print(JSON.stringify(raw ?? {}))
        return
      }
      const parsed = parseResult(method, raw)
      if (parsed.ok) {
        print(human(parsed.value))
        return
      }
      // O protocolo divergiu (versões diferentes?): melhor mostrar o dado cru do que falhar.
      io.err(`${c}: aviso: a resposta de "${method}" veio num formato inesperado (campo ${parsed.path}); mostrando o JSON.\n`)
      print(JSON.stringify(raw ?? {}))
    },
    parse(method, raw) {
      const parsed = parseResult(method, raw)
      if (!parsed.ok) {
        throw new CliError('bad_response', `resposta inesperada do ${APP_NAME} para "${method}" (campo ${parsed.path}).`)
      }
      return parsed.value
    }
  }
}

export interface CommandDef {
  /** Como o usuário digita: "send", "note write"... */
  name: string
  topic: HelpTopic
  /** Opções aceitas além das globais (--json, --help, --version). */
  flags: readonly FlagName[]
  /** Grupo para as dicas de erro. */
  scope: HintScope
  run(ctx: Ctx, args: ParsedArgs, pos: readonly string[]): Promise<number>
}

// ------------------------------------------------------------------ validação de argumentos

function noExtra(pos: readonly string[], label: string): void {
  if (pos.length > 0) throw usageError(`argumento inesperado "${pos[0]}" em "${c} ${label}".`)
}

function required(value: string | undefined, message: string, hint?: string): string {
  const v = value === undefined ? '' : refArg(value)
  if (v === '') throw usageError(message, hint)
  return v
}

/** Valor opcional de opção: vazio conta como ausente (ex.: --role "$PAPEL" com variável vazia). */
function optional(args: ParsedArgs, name: FlagName): string | undefined {
  const v = args.str(name)?.trim()
  return v ? v : undefined
}

/** "--timeout": segundos (300), com unidade (90s, 5m, 1h) ou 0 = sem limite. Devolve ms. */
export function parseTimeout(raw: string): number {
  const m = /^(\d+(?:[.,]\d+)?)\s*(s|seg|m|min|h)?$/i.exec(raw.trim())
  if (!m) {
    throw usageError(
      `valor inválido para --timeout: "${raw}".`,
      'use segundos (ex.: 300) ou uma unidade: 90s, 5m, 1h; 0 = sem limite.'
    )
  }
  const n = Number(m[1]!.replace(',', '.'))
  const unit = (m[2] ?? 's').toLowerCase()
  const factor = unit === 'h' ? 3_600_000 : unit === 'm' || unit === 'min' ? 60_000 : 1000
  const ms = Math.round(n * factor)
  if (ms > MAX_WAIT_TIMEOUT_MS) throw usageError('--timeout grande demais (máximo 7 dias).')
  return ms
}

/** "--lines": inteiro; a faixa válida vem do schema do protocolo (`wait`/`read`). */
export function parseLines(raw: string, method: 'wait' | 'read'): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw usageError(`valor inválido para --lines: "${raw}" (use um número inteiro, ex.: 100).`)
  }
  const lines = Number(raw.trim())
  const sample = method === 'wait' ? { messageId: 'x', lines } : { peer: 'x', lines }
  const checked = ApiRequestSchemas[method].safeParse(sample)
  const issue = checked.success ? undefined : checked.error.issues[0]
  if (issue) throw requestIssueError(method, issue, sample)
  return lines
}

/** Texto de stdin/arquivo para notas: vazio é erro (evita apagar a nota por engano). */
async function noteContent(
  ctx: Ctx,
  plan: TextPlan,
  subject: string,
  example: string,
  allowEmptyArgs: boolean
): Promise<string> {
  const text = await loadText(plan, ctx.io)
  if (plan.kind === 'args') {
    if (text === '' && !allowEmptyArgs) throw emptySourceError(plan, subject, example)
    return withTrailingNewline(text)
  }
  if (text.trim() === '') throw emptySourceError(plan, subject, example)
  return text
}

// ------------------------------------------------------------------ espera da resposta (send --wait)

async function cancelWait(client: ApiClient, messageId: string): Promise<void> {
  try {
    await client.call('wait', { messageId, pollMs: 0, cancel: true }, { timeoutMs: CANCEL_TIMEOUT_MS })
  } catch {
    // melhor esforço: o servidor também deve limpar a espera quando o cliente some
  }
}

/** Long-poll de `wait` até o destino ficar ocioso, encerrar, ou o tempo total acabar. */
async function waitForReply(
  ctx: Ctx,
  client: ApiClient,
  sent: SendResult,
  lines: number | undefined,
  timeoutMs: number
): Promise<WaitResult> {
  const { io } = ctx
  const deadline = timeoutMs > 0 ? io.now() + timeoutMs : Number.POSITIVE_INFINITY
  const base = lines === undefined ? { messageId: sent.messageId } : { messageId: sent.messageId, lines }
  try {
    for (;;) {
      const remaining = deadline - io.now()
      if (remaining <= 0) break
      const pollMs = Math.min(POLL_MS, Math.ceil(remaining))
      const started = io.now()
      const opts = { timeoutMs: pollMs + WAIT_GRACE_MS, signal: io.signal }
      const res = ctx.parse('wait', await client.call('wait', { ...base, pollMs }, opts))
      if (res.done) return res
      // Servidor respondeu "ainda não" sem segurar a requisição: não martela a API.
      const left = deadline - io.now()
      if (io.now() - started < MIN_POLL_GAP_MS && left > 0) await io.sleep(Math.min(MIN_POLL_GAP_MS, left), io.signal)
    }
  } catch (err) {
    // Ctrl+C, resposta inválida...: avisa o app que desistimos (sem conexão não há o que avisar).
    if (!isCliError(err, 'connection')) await cancelWait(client, sent.messageId)
    throw err
  }
  await cancelWait(client, sent.messageId)
  const to = oneLine(sent.to)
  throw new CliError(
    'timeout',
    `tempo esgotado (${fmtDuration(timeoutMs)}) esperando a resposta de "${to}". ` +
      'A mensagem foi entregue; o destino pode ainda estar trabalhando.',
    `veja a tela dele depois com: ${c} read ${to}`
  )
}

function reportReply(ctx: Ctx, sent: SendResult, res: WaitResult): number {
  const reason = res.reason ?? 'idle'
  const to = res.to || sent.to
  if (ctx.json) {
    ctx.print(JSON.stringify({ ...sent, ...res }))
  } else {
    if (reason !== 'cancelled' || (res.output ?? '').trim() !== '') ctx.print(formatReply(to, res.output, reason))
    if (reason === 'exited') {
      ctx.io.err(`${c}: o processo de "${oneLine(to)}" encerrou antes de ficar ocioso; a resposta pode estar incompleta.\n`)
    }
    if (reason === 'cancelled') ctx.io.err(`${c}: a espera pela resposta de "${oneLine(to)}" foi cancelada no ${APP_NAME}.\n`)
  }
  return reason === 'exited' ? EXIT.unavailable : reason === 'cancelled' ? EXIT.error : EXIT.ok
}

// ------------------------------------------------------------------ comandos básicos

const whoami: CommandDef = {
  name: 'whoami',
  topic: 'whoami',
  flags: [],
  scope: 'other',
  async run(ctx, _args, pos) {
    noExtra(pos, 'whoami')
    ctx.show('whoami', await ctx.client().call('whoami', {}, { signal: ctx.io.signal }), formatWhoami)
    return EXIT.ok
  }
}

const peers: CommandDef = {
  name: 'peers',
  topic: 'peers',
  flags: [],
  scope: 'peer',
  async run(ctx, _args, pos) {
    noExtra(pos, 'peers')
    ctx.show('peers', await ctx.client().call('peers', {}, { signal: ctx.io.signal }), formatPeers)
    return EXIT.ok
  }
}

const send: CommandDef = {
  name: 'send',
  topic: 'send',
  flags: ['wait', 'timeout', 'lines', 'file'],
  scope: 'peer',
  async run(ctx, args, pos) {
    const [peer, ...rest] = pos
    const to = required(
      peer,
      `informe o destino e a mensagem: ${c} send <peer> <mensagem...>`,
      `veja os peers com "${c} peers".`
    )
    const wait = args.bool('wait')
    if (!wait && (args.has('timeout') || args.has('lines'))) {
      const example = `exemplo: ${c} send ${to} "..." --wait --timeout 300`
      throw usageError('--timeout e --lines só valem junto com --wait.', example)
    }
    const timeoutRaw = args.str('timeout')
    const timeoutMs = timeoutRaw === undefined ? DEFAULT_WAIT_TIMEOUT_MS : parseTimeout(timeoutRaw)
    const linesRaw = args.str('lines')
    const lines = linesRaw === undefined ? undefined : parseLines(linesRaw, 'wait')
    const plan = planText(rest, args.str('file'), ctx.io.stdinIsTTY)
    if (!plan) throw usageError('falta a mensagem.', `exemplo: ${c} send ${to} "texto" (ou "-" para ler do stdin)`)

    const client = ctx.client()
    const text = cleanMessage(await loadText(plan, ctx.io))
    if (text === '') throw emptySourceError(plan, 'a mensagem está vazia', `${c} send ${to} "texto"`)
    const body = wait ? { to, text, wait: true } : { to, text }
    const raw = await client.call('send', body, { signal: ctx.io.signal })
    if (!wait) {
      ctx.show('send', raw, (r) => `Mensagem entregue a "${oneLine(r.to)}".`)
      return EXIT.ok
    }
    const sent = ctx.parse('send', raw)
    return reportReply(ctx, sent, await waitForReply(ctx, client, sent, lines, timeoutMs))
  }
}

const read: CommandDef = {
  name: 'read',
  topic: 'read',
  flags: ['lines'],
  scope: 'peer',
  async run(ctx, args, pos) {
    const [peerArg, ...extra] = pos
    const peer = required(peerArg, `informe o peer: ${c} read <peer> [--lines N]`, `veja os peers com "${c} peers".`)
    noExtra(extra, 'read')
    const linesRaw = args.str('lines')
    const body = linesRaw === undefined ? { peer } : { peer, lines: parseLines(linesRaw, 'read') }
    ctx.show('read', await ctx.client().call('read', body, { signal: ctx.io.signal }), formatRead)
    return EXIT.ok
  }
}

const portalRead: CommandDef = {
  name: 'portal read',
  topic: 'portal',
  flags: [],
  scope: 'other',
  async run(ctx, _args, pos) {
    const [portalArg, ...extra] = pos
    noExtra(extra, 'portal read')
    const body = portalArg === undefined ? {} : { portal: refArg(portalArg) }
    const raw = await ctx.client().call('portal.read', body, { signal: ctx.io.signal })
    if (ctx.json) {
      ctx.print(JSON.stringify(raw ?? {}))
      return EXIT.ok
    }
    const r = ctx.parse('portal.read', raw)
    const head = [r.title ? oneLine(r.title) : '', r.url].filter(Boolean).join('\n')
    const cut = r.truncated ? '\n\n(texto cortado: a página passa do limite; use o print para ver o resto)' : ''
    ctx.io.out(withTrailingNewline(`${head}\n\n${cleanBlock(r.text) || '(a página não tem texto)'}${cut}`))
    return EXIT.ok
  }
}

const portalPrint: CommandDef = {
  name: 'portal print',
  topic: 'portal',
  flags: [],
  scope: 'other',
  async run(ctx, _args, pos) {
    const [portalArg, ...extra] = pos
    noExtra(extra, 'portal print')
    const body = portalArg === undefined ? {} : { portal: refArg(portalArg) }
    ctx.show(
      'portal.print',
      await ctx.client().call('portal.print', body, { signal: ctx.io.signal }),
      (r) => `Print de "${oneLine(r.title || r.url)}" (${r.width}×${r.height}) salvo em:\n${r.file}\nAbra o arquivo para ver a imagem.`
    )
    return EXIT.ok
  }
}

const portalOpen: CommandDef = {
  name: 'portal open',
  topic: 'portal',
  flags: ['portal'],
  scope: 'other',
  async run(ctx, args, pos) {
    const [urlArg, ...extra] = pos
    const url = required(urlArg, `informe o endereço: ${c} portal open <url> [--portal <portal>]`, 'use um endereço http:// ou https://.')
    noExtra(extra, 'portal open')
    const portal = args.str('portal')
    const body = portal === undefined ? { url } : { url, portal: refArg(portal) }
    ctx.show('portal.open', await ctx.client().call('portal.open', body, { signal: ctx.io.signal }), (r) =>
      r.title ? `Portal em ${r.url} ("${oneLine(r.title)}").` : `Portal em ${r.url}.`
    )
    return EXIT.ok
  }
}

const noteList: CommandDef = {
  name: 'note list',
  topic: 'note',
  flags: [],
  scope: 'note',
  async run(ctx, _args, pos) {
    noExtra(pos, 'note list')
    const raw = await ctx.client().call('note.list', {}, { signal: ctx.io.signal })
    ctx.show('note.list', raw, (r) => formatNoteList(r, ctx.io.now()))
    return EXIT.ok
  }
}

const noteRead: CommandDef = {
  name: 'note read',
  topic: 'note',
  flags: [],
  scope: 'note',
  async run(ctx, _args, pos) {
    const [noteArg, ...extra] = pos
    const note = required(noteArg, `informe a nota: ${c} note read <nota>`, `veja as notas com "${c} note list".`)
    noExtra(extra, 'note read')
    const raw = await ctx.client().call('note.read', { note }, { signal: ctx.io.signal })
    if (ctx.json) {
      ctx.print(JSON.stringify(raw ?? {}))
      return EXIT.ok
    }
    const r = ctx.parse('note.read', raw)
    // Conteúdo exato (redirecionável para arquivo); num terminal, sem escapes e com quebra final.
    const content = ctx.io.stdoutIsTTY ? withTrailingNewline(cleanBlock(r.content)) : r.content
    if (content === '') ctx.io.err(`(a nota "${oneLine(r.file)}" está vazia)\n`)
    else ctx.io.out(content)
    return EXIT.ok
  }
}

const noteWrite: CommandDef = {
  name: 'note write',
  topic: 'note',
  flags: ['if-revision', 'file'],
  scope: 'note',
  async run(ctx, args, pos) {
    const [noteArg, ...rest] = pos
    const note = required(noteArg, `informe a nota e o texto: ${c} note write <nota> <texto...|->`)
    const ifRevision = args.str('if-revision')?.trim()
    if (ifRevision === '') {
      throw usageError(`a opção --if-revision precisa da revisão (veja "${c} note read ${note} --json").`)
    }
    const example = `${c} note write ${note} "texto"`
    const plan = planText(rest, args.str('file'), ctx.io.stdinIsTTY)
    if (!plan) {
      throw usageError('falta o conteúdo da nota.', `exemplo: ${example} (ou "-" para ler do stdin, ou --file <arquivo>)`)
    }
    const client = ctx.client()
    const content = await noteContent(ctx, plan, 'o conteúdo está vazio', example, true)
    const body = ifRevision === undefined ? { note, content } : { note, content, ifRevision }
    const raw = await client.call('note.write', body, { signal: ctx.io.signal })
    ctx.show('note.write', raw, (r) => `Nota "${oneLine(r.file)}" gravada (revisão ${oneLine(r.revision)}).`)
    return EXIT.ok
  }
}

const noteAppend: CommandDef = {
  name: 'note append',
  topic: 'note',
  flags: ['file'],
  scope: 'note',
  async run(ctx, args, pos) {
    const [noteArg, ...rest] = pos
    const note = required(noteArg, `informe a nota e o texto: ${c} note append <nota> <texto...|->`)
    const example = `${c} note append ${note} "texto"`
    const plan = planText(rest, args.str('file'), ctx.io.stdinIsTTY)
    if (!plan) {
      throw usageError('falta o texto a anexar.', `exemplo: ${example} (ou "-" para ler do stdin, ou --file <arquivo>)`)
    }
    const client = ctx.client()
    const content = await noteContent(ctx, plan, 'o texto está vazio', example, false)
    const raw = await client.call('note.append', { note, content }, { signal: ctx.io.signal })
    ctx.show('note.append', raw, (r) => `Texto anexado à nota "${oneLine(r.file)}" (revisão ${oneLine(r.revision)}).`)
    return EXIT.ok
  }
}

const notify: CommandDef = {
  name: 'notify',
  topic: 'notify',
  flags: ['title'],
  scope: 'other',
  async run(ctx, args, pos) {
    const text = pos.join(' ').trim()
    if (text === '') throw usageError(`falta o texto: ${c} notify <texto...>`)
    const title = optional(args, 'title')
    const raw = await ctx.client().call('notify', title ? { text, title } : { text }, { signal: ctx.io.signal })
    ctx.show('notify', raw, () => 'Notificação enviada.')
    return EXIT.ok
  }
}

const status: CommandDef = {
  name: 'status',
  topic: 'status',
  flags: [],
  scope: 'other',
  async run(ctx, _args, pos) {
    const text = pos.join(' ').trim()
    const raw = await ctx.client().call('status', { text }, { signal: ctx.io.signal })
    ctx.show('status', raw, () => (text === '' ? 'Status removido.' : `Status atualizado: "${oneLine(text)}".`))
    return EXIT.ok
  }
}

// ------------------------------------------------------------------ comandos de gerente

const recruit: CommandDef = {
  name: 'recruit',
  topic: 'recruit',
  flags: ['name', 'agent', 'role', 'note', 'floor'],
  scope: 'manager',
  async run(ctx, args, pos) {
    // O nome vem de --name ou, como atalho, do único argumento: "orq recruit construtor --role ...".
    const flagName = args.str('name')
    noExtra(flagName === undefined ? pos.slice(1) : pos, 'recruit')
    const name = required(
      flagName ?? pos[0],
      `informe o nome do recruta: ${c} recruit --name <nome> [--agent <preset>] [--role <papel>]`
    )
    const notes = args
      .list('note')
      .map((n) => n.trim())
      .filter((n) => n !== '')
    const agent = optional(args, 'agent')
    const role = optional(args, 'role')
    const floor = optional(args, 'floor')
    const body = {
      name,
      ...(agent ? { agent } : {}),
      ...(role ? { role } : {}),
      ...(notes.length > 0 ? { notes } : {}),
      ...(floor ? { floor } : {})
    }
    ctx.show('recruit', await ctx.client().call('recruit', body, { signal: ctx.io.signal }), formatRecruit)
    return EXIT.ok
  }
}

const dismiss: CommandDef = {
  name: 'dismiss',
  topic: 'dismiss',
  flags: [],
  scope: 'manager',
  async run(ctx, _args, pos) {
    const [nameArg, ...extra] = pos
    const name = required(nameArg, `informe quem dispensar: ${c} dismiss <nome>`)
    noExtra(extra, 'dismiss')
    const raw = await ctx.client().call('dismiss', { name }, { signal: ctx.io.signal })
    ctx.show('dismiss', raw, () => `Recruta "${oneLine(name)}" dispensado (terminal fechado).`)
    return EXIT.ok
  }
}

const roleList: CommandDef = {
  name: 'role list',
  topic: 'role',
  flags: [],
  scope: 'role',
  async run(ctx, _args, pos) {
    noExtra(pos, 'role list')
    ctx.show('role.list', await ctx.client().call('role.list', {}, { signal: ctx.io.signal }), formatRoleList)
    return EXIT.ok
  }
}

const roleSet: CommandDef = {
  name: 'role set',
  topic: 'role',
  flags: [],
  scope: 'manager',
  async run(ctx, _args, pos) {
    const [nameArg, roleArg, ...extra] = pos
    const usage = `${c} role set <nome> <papel>`
    const name = required(nameArg, `informe o terminal e o papel: ${usage}`)
    const role = required(roleArg, `informe o papel: ${usage}`, `veja os papéis com "${c} role list".`)
    noExtra(extra, 'role set')
    const raw = await ctx.client().call('role.set', { name, role }, { signal: ctx.io.signal })
    ctx.show('role.set', raw, () => `Papel de "${oneLine(name)}" agora é "${oneLine(role)}".`)
    return EXIT.ok
  }
}

/** Origem das instruções de `role edit`: --file, "--instructions -" (stdin) ou o texto da opção. */
function instructionsPlan(args: ParsedArgs, usage: string): TextPlan {
  const file = args.str('file')
  const text = args.str('instructions')
  if (file !== undefined && text !== undefined) throw usageError('use --instructions ou --file, não os dois.')
  if (file !== undefined) {
    if (file.trim() === '') throw usageError('a opção --file precisa do caminho de um arquivo.')
    return { kind: 'file', path: file }
  }
  if (text === '-') return { kind: 'stdin', explicit: true }
  if (text !== undefined) return { kind: 'args', text }
  throw usageError(`faltam as instruções: ${usage}`, '"--instructions -" lê do stdin; --file <caminho> lê de um arquivo.')
}

const roleEdit: CommandDef = {
  name: 'role edit',
  topic: 'role',
  flags: ['instructions', 'create', 'file'],
  scope: 'role',
  async run(ctx, args, pos) {
    const [roleArg, ...extra] = pos
    const usage = `${c} role edit <papel> --instructions <texto|-> [--create]`
    const role = required(roleArg, `informe o papel: ${usage}`)
    if (extra.length > 0) {
      throw usageError(`argumento inesperado "${extra[0]}" em "${c} role edit".`, `o texto vai em --instructions: ${usage}`)
    }
    const plan = instructionsPlan(args, usage)
    const client = ctx.client()
    let instructions = await loadText(plan, ctx.io)
    if (plan.kind !== 'args') {
      instructions = instructions.trimEnd()
      if (instructions.trim() === '') {
        throw emptySourceError(plan, 'as instruções estão vazias', `${c} role edit ${role} --instructions "texto"`)
      }
    }
    const body = args.bool('create') ? { role, instructions, create: true } : { role, instructions }
    const raw = await client.call('role.edit', body, { signal: ctx.io.signal })
    ctx.show('role.edit', raw, (r) => `Instruções do papel "${oneLine(r.role.name)}" (id ${oneLine(r.role.id)}) salvas.`)
    return EXIT.ok
  }
}

const connect: CommandDef = {
  name: 'connect',
  topic: 'connect',
  flags: [],
  scope: 'manager',
  async run(ctx, _args, pos) {
    const [aArg, bArg, ...extra] = pos
    const a = required(aArg, `informe os dois nós: ${c} connect <a> <b>`)
    const b = required(bArg, `informe o segundo nó: ${c} connect <a> <b>`)
    noExtra(extra, 'connect')
    const raw = await ctx.client().call('connect', { a, b }, { signal: ctx.io.signal })
    ctx.show('connect', raw, (r) => `Conexão criada: "${oneLine(r.a)}" ↔ "${oneLine(r.b)}".`)
    return EXIT.ok
  }
}

// ------------------------------------------------------------------ quadro de chamados

/** --desc: texto, "-" (stdin) ou ausente. */
async function descArg(ctx: Ctx, args: ParsedArgs): Promise<string | undefined> {
  const raw = args.str('desc')
  if (raw === undefined) return undefined
  if (raw === '-') return (await loadText({ kind: 'stdin', explicit: true }, ctx.io)).trimEnd()
  return raw
}

function cardArg(value: string | undefined, usage: string): string {
  return required(value, `informe o cartão (#número, número do chamado ou parte do título): ${usage}`, `veja os cartões com "${c} board list".`)
}

const boardList: CommandDef = {
  name: 'board list',
  topic: 'board',
  flags: ['column', 'mine', 'all'],
  scope: 'other',
  async run(ctx, args, pos) {
    noExtra(pos, 'board list')
    const column = optional(args, 'column')
    const body = { ...(column ? { column } : {}), ...(args.bool('mine') ? { mine: true } : {}), ...(args.bool('all') ? { all: true } : {}) }
    ctx.show('board.list', await ctx.client().call('board.list', body, { signal: ctx.io.signal }), formatBoardList)
    return EXIT.ok
  }
}

const boardShow: CommandDef = {
  name: 'board show',
  topic: 'board',
  flags: [],
  scope: 'other',
  async run(ctx, _args, pos) {
    const card = cardArg(pos.join(' ').trim() || undefined, `${c} board show <cartão>`)
    ctx.show('board.show', await ctx.client().call('board.show', { card }, { signal: ctx.io.signal }), formatBoardShow)
    return EXIT.ok
  }
}

const boardAdd: CommandDef = {
  name: 'board add',
  topic: 'board',
  flags: ['column', 'ticket', 'note', 'desc', 'assign'],
  scope: 'other',
  async run(ctx, args, pos) {
    const title = pos.join(' ').trim()
    if (!title) throw usageError(`falta o título: ${c} board add "<título>" [--ticket <número>] [--column <coluna>]`)
    const client = ctx.client()
    const description = await descArg(ctx, args)
    const note = args.list('note').pop()?.trim()
    const body = {
      title,
      ...(optional(args, 'column') ? { column: optional(args, 'column') } : {}),
      ...(optional(args, 'ticket') ? { ticket: optional(args, 'ticket') } : {}),
      ...(note ? { note } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(optional(args, 'assign') ? { assignee: optional(args, 'assign') } : {})
    }
    ctx.show('board.add', await client.call('board.add', body, { signal: ctx.io.signal }), (r) => formatBoardCard('criado', r.card))
    return EXIT.ok
  }
}

const boardMove: CommandDef = {
  name: 'board move',
  topic: 'board',
  flags: ['comment'],
  scope: 'other',
  async run(ctx, args, pos) {
    const [cardRaw, ...rest] = pos
    const usage = `${c} board move <cartão> <coluna> [--comment <texto>]`
    const card = cardArg(cardRaw, usage)
    const column = rest.join(' ').trim()
    if (!column) throw usageError(`informe a coluna: ${usage}`, `veja as colunas com "${c} board list".`)
    const comment = optional(args, 'comment')
    const raw = await ctx.client().call('board.move', { card, column, ...(comment ? { comment } : {}) }, { signal: ctx.io.signal })
    ctx.show('board.move', raw, (r) => formatBoardCard('movido', r.card))
    return EXIT.ok
  }
}

const boardUpdate: CommandDef = {
  name: 'board update',
  topic: 'board',
  flags: ['title', 'ticket', 'note', 'desc', 'assign'],
  scope: 'other',
  async run(ctx, args, pos) {
    const usage = `${c} board update <cartão> [--title <t>] [--ticket <n>] [--note <nota>] [--desc <texto|->] [--assign <terminal>]`
    const card = cardArg(pos.join(' ').trim() || undefined, usage)
    const client = ctx.client()
    const description = await descArg(ctx, args)
    const note = args.has('note') ? (args.list('note').pop() ?? '').trim() : undefined
    const patch = {
      ...(args.str('title') !== undefined ? { title: args.str('title')!.trim() } : {}),
      ...(args.str('ticket') !== undefined ? { ticket: args.str('ticket')!.trim() } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(args.str('assign') !== undefined ? { assignee: args.str('assign')!.trim() } : {})
    }
    if (Object.keys(patch).length === 0) throw usageError(`diga o que mudar: ${usage}`)
    const raw = await client.call('board.update', { card, ...patch }, { signal: ctx.io.signal })
    ctx.show('board.update', raw, (r) => formatBoardCard('atualizado', r.card))
    return EXIT.ok
  }
}

const boardComment: CommandDef = {
  name: 'board comment',
  topic: 'board',
  flags: [],
  scope: 'other',
  async run(ctx, _args, pos) {
    const [cardRaw, ...rest] = pos
    const usage = `${c} board comment <cartão> <texto...>`
    const card = cardArg(cardRaw, usage)
    const text = rest.join(' ').trim()
    if (!text) throw usageError(`falta o comentário: ${usage}`)
    const raw = await ctx.client().call('board.comment', { card, text }, { signal: ctx.io.signal })
    ctx.show('board.comment', raw, (r) => formatBoardCard('comentado', r.card))
    return EXIT.ok
  }
}

/** Teto do JSON que o Claude Code manda ao hook (inclui a entrada da ferramenta, que pode ser grande). */
const HOOK_STDIN_MAX_BYTES = 16 * 1024 * 1024
const HOOK_TIMEOUT_MS = 5_000

/**
 * Uso interno: chamado pelos hooks do Claude Code (o app passa `--settings` com eles). Lê o JSON do
 * stdin, repassa só o nome do evento, o tipo de notificação e o nome da ferramenta, e sai em silêncio
 * com código 0 — um hook nunca pode atrapalhar o agente.
 */
const hook: CommandDef = {
  name: 'hook',
  topic: 'hook',
  flags: [],
  scope: 'other',
  async run(ctx) {
    try {
      const at = ctx.io.now()
      const raw = ctx.io.stdinIsTTY ? '' : (await ctx.io.readStdin(HOOK_STDIN_MAX_BYTES)).toString('utf8')
      const info = hookInfoFromPayload(raw)
      if (info) await ctx.client().call('hook', { ...info, at }, { timeoutMs: HOOK_TIMEOUT_MS, signal: ctx.io.signal })
    } catch {
      // fora do app, app fechado, payload grande demais: o agente segue normalmente
    }
    return EXIT.ok
  }
}

const ALL: readonly CommandDef[] = [
  whoami,
  peers,
  send,
  read,
  noteList,
  noteRead,
  noteWrite,
  noteAppend,
  portalRead,
  portalPrint,
  portalOpen,
  notify,
  status,
  recruit,
  dismiss,
  roleList,
  roleSet,
  roleEdit,
  connect,
  boardList,
  boardShow,
  boardAdd,
  boardMove,
  boardUpdate,
  boardComment,
  hook
]

export const COMMANDS: ReadonlyMap<string, CommandDef> = new Map(ALL.map((d) => [d.name, d]))

/** Comandos com subcomando ("note list", "role set"...). */
export const GROUPS: Readonly<Record<string, readonly string[]>> = {
  note: ['list', 'read', 'write', 'append'],
  portal: ['read', 'print', 'open'],
  role: ['list', 'set', 'edit'],
  board: ['list', 'show', 'add', 'move', 'update', 'comment']
}

/** Outros nomes aceitos para grupos (em português). */
export const GROUP_ALIASES: Readonly<Record<string, string>> = { quadro: 'board' }
