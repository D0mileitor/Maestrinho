import { APP_NAME, CLI_NAME } from '@shared/constants'
import { checkFlags, parseArgv } from './args'
import type { Env } from './client'
import { COMMANDS, GROUPS, GROUP_ALIASES, createCtx, type CommandDef } from './commands'
import { ApiCallError, EXIT, hintFor, oneLine, toCliError, usageError, type CliError, type HintScope } from './errors'
import { helpText, isHelpTopic, type HelpTopic } from './help'
import type { CliIo } from './io'

const c = CLI_NAME

/** Palavras que agentes costumam tentar (inclusive de outras ferramentas) → comando certo. */
const ALIASES: Readonly<Record<string, string>> = {
  ask: 'send <peer> "<mensagem>" --wait',
  tell: 'send <peer> "<mensagem>"',
  msg: 'send <peer> "<mensagem>"',
  message: 'send <peer> "<mensagem>"',
  list: 'peers',
  ls: 'peers',
  who: 'whoami',
  me: 'whoami',
  cat: 'read <peer>',
  show: 'read <peer>',
  tail: 'read <peer> --lines N',
  notes: 'note list',
  roles: 'role list',
  kill: 'dismiss <nome>',
  hire: 'recruit --name <nome>',
  spawn: 'recruit --name <nome>',
  link: 'connect <a> <b>',
  kanban: 'board list',
  cards: 'board list',
  ticket: 'board add "<título>" --ticket <número>'
}

/** Distância de edição (para "você quis dizer"). */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]!
}

function suggest(word: string, candidates: readonly string[]): string | undefined {
  let best: { name: string; d: number } | undefined
  for (const name of candidates) {
    const d = editDistance(word, name)
    if (d <= 2 && (!best || d < best.d)) best = { name, d }
  }
  return best?.name
}

const TOP_LEVEL = [...new Set([...COMMANDS.keys()].map((k) => k.split(' ')[0]!)), 'help']

function unknownCommand(raw: string): CliError {
  const word = raw.toLowerCase()
  const alias = ALIASES[word]
  const close = suggest(word, TOP_LEVEL)
  const hint = alias
    ? `use: ${c} ${alias}`
    : close
      ? `você quis dizer "${c} ${close}"? Veja todos os comandos com "${c} help".`
      : `veja os comandos com "${c} help".`
  return usageError(`comando desconhecido "${oneLine(raw)}".`, hint)
}

/** Identifica o comando (e subcomando) nos argumentos posicionais. */
export function resolveCommand(positionals: readonly string[]): { def: CommandDef; rest: readonly string[] } {
  const head = positionals[0]!
  const name = GROUP_ALIASES[head.toLowerCase()] ?? head.toLowerCase()
  const group = GROUPS[name]
  if (group) {
    const subRaw = positionals[1]
    if (subRaw === undefined) {
      throw usageError(`falta o subcomando: ${c} ${name} ${group.join('|')}.`, `veja "${c} ${name} --help".`)
    }
    const def = COMMANDS.get(`${name} ${subRaw.toLowerCase()}`)
    if (!def) {
      const close = suggest(subRaw.toLowerCase(), group)
      throw usageError(
        `subcomando desconhecido "${oneLine(subRaw)}" em "${c} ${name}" (use ${group.join(', ')}).`,
        close ? `você quis dizer "${c} ${name} ${close}"?` : `veja "${c} ${name} --help".`
      )
    }
    return { def, rest: positionals.slice(2) }
  }
  const def = COMMANDS.get(head.toLowerCase())
  if (!def) throw unknownCommand(head)
  return { def, rest: positionals.slice(1) }
}

function helpTopicFor(word: string | undefined): HelpTopic | undefined {
  const lower = word?.toLowerCase()
  const w = lower !== undefined ? (GROUP_ALIASES[lower] ?? lower) : undefined
  return w !== undefined && isHelpTopic(w) ? w : undefined
}

/** Escreve o erro no stderr (texto ou JSON) e devolve o código de saída. */
export function reportError(
  err: unknown,
  io: CliIo,
  json: boolean,
  scope: HintScope = 'other',
  command?: string
): number {
  const e = toCliError(err)
  let hint = e.hint ?? (e instanceof ApiCallError ? hintFor(e.code, scope) : undefined)
  if (!hint && e.code === 'usage' && command) hint = `veja "${c} ${command} --help".`
  const message = oneLine(e.message)
  if (json) {
    const error = { code: e.code, message, ...(hint ? { hint: oneLine(hint) } : {}), exitCode: e.exitCode }
    io.err(`${JSON.stringify({ ok: false, error })}\n`)
  } else {
    io.err(`${c}: ${message}\n${hint ? `dica: ${oneLine(hint)}\n` : ''}`)
  }
  return e.exitCode
}

/**
 * Ponto de entrada testável do CLI: interpreta `argv` (sem o executável e o script), executa o
 * comando e devolve o código de saída. Não chama process.exit.
 */
export async function run(argv: readonly string[], env: Env, io: CliIo): Promise<number> {
  const args = parseArgv(argv)
  const json = args.bool('json')
  let def: CommandDef | undefined
  try {
    if (args.bool('version')) {
      io.out(`${c} ${io.version()} (${APP_NAME})\n`)
      return EXIT.ok
    }
    const head = args.positionals[0]
    if (head?.toLowerCase() === 'help') {
      const topicWord = args.positionals[1]
      const topic = helpTopicFor(topicWord)
      if (topicWord !== undefined && !topic) throw unknownCommand(topicWord)
      io.out(`${helpText(topic)}\n`)
      return EXIT.ok
    }
    if (args.bool('help')) {
      io.out(`${helpText(helpTopicFor(head))}\n`)
      return EXIT.ok
    }
    if (head === undefined) {
      const unknown = args.unknown[0]
      const bad = args.errors[0] ?? (unknown !== undefined ? `opção desconhecida "${unknown}".` : undefined)
      if (bad !== undefined) throw usageError(bad, `veja "${c} help".`)
      io.out(`${helpText()}\n`)
      return EXIT.ok
    }
    const resolved = resolveCommand(args.positionals)
    def = resolved.def
    checkFlags(args, def.flags, def.name)
    return await def.run(createCtx(io, env, json), args, resolved.rest)
  } catch (err) {
    return reportError(err, io, json, def?.scope, def?.name)
  }
}
