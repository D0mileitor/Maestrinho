import { CLI_NAME } from '@shared/constants'
import { usageError } from './errors'

/**
 * Parser de argumentos do `orq` (sem dependências).
 *  - opções podem aparecer em qualquer posição: `orq send revisor --wait "texto"`;
 *  - `--opcao=valor` e `--opcao valor`;
 *  - `--` encerra as opções (o resto é texto, mesmo que comece com "-");
 *  - `-` sozinho é um argumento comum (marcador de "ler do stdin").
 * Opções desconhecidas e problemas de sintaxe são acumulados e só reportados depois que o comando
 * é identificado, para a mensagem listar as opções válidas daquele comando.
 */

export type FlagType = 'boolean' | 'string' | 'list'

export interface FlagDef {
  type: FlagType
  /** Atalho de uma letra (ex.: "h" para -h). */
  short?: string
  /** Marcador do valor exibido na ajuda/erros (ex.: "<segundos>"). */
  value?: string
}

export const FLAGS = {
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
  wait: { type: 'boolean' },
  create: { type: 'boolean' },
  timeout: { type: 'string', value: '<segundos>' },
  lines: { type: 'string', value: '<N>' },
  file: { type: 'string', value: '<caminho>' },
  'if-revision': { type: 'string', value: '<R>' },
  title: { type: 'string', value: '<título>' },
  name: { type: 'string', value: '<nome>' },
  agent: { type: 'string', value: '<preset>' },
  role: { type: 'string', value: '<papel>' },
  note: { type: 'list', value: '<nota>' },
  floor: { type: 'string', value: '<floor>' },
  portal: { type: 'string', value: '<portal>' },
  instructions: { type: 'string', value: '<texto|->' },
  column: { type: 'string', value: '<coluna>' },
  ticket: { type: 'string', value: '<número>' },
  desc: { type: 'string', value: '<texto|->' },
  assign: { type: 'string', value: '<terminal>' },
  comment: { type: 'string', value: '<texto>' },
  mine: { type: 'boolean' },
  all: { type: 'boolean' }
} as const satisfies Record<string, FlagDef>

export type FlagName = keyof typeof FLAGS

/** Opções aceitas por todos os comandos. */
export const GLOBAL_FLAGS: readonly FlagName[] = ['json', 'help', 'version']

const FLAG_DEFS: Readonly<Record<string, FlagDef>> = FLAGS

function isFlagName(name: string): name is FlagName {
  return Object.prototype.hasOwnProperty.call(FLAG_DEFS, name)
}

const SHORT: ReadonlyMap<string, FlagName> = new Map(
  (Object.keys(FLAGS) as FlagName[]).flatMap((name): [string, FlagName][] => {
    const def: FlagDef = FLAGS[name]
    return def.short ? [[def.short, name]] : []
  })
)

export class ParsedArgs {
  constructor(
    readonly positionals: readonly string[],
    private readonly values: ReadonlyMap<FlagName, readonly string[]>,
    /** Opções desconhecidas, como digitadas (ex.: "--foo", "-x"). */
    readonly unknown: readonly string[],
    /** Problemas de sintaxe já descritos em pt-BR (ex.: opção sem valor). */
    readonly errors: readonly string[]
  ) {}

  has(name: FlagName): boolean {
    return this.values.has(name)
  }

  bool(name: FlagName): boolean {
    const v = this.values.get(name)
    return v !== undefined && v[v.length - 1] === 'true'
  }

  /** Último valor de uma opção de texto. */
  str(name: FlagName): string | undefined {
    const v = this.values.get(name)
    return v === undefined ? undefined : v[v.length - 1]
  }

  /** Todos os valores (opções repetíveis, ex.: --note). */
  list(name: FlagName): string[] {
    return [...(this.values.get(name) ?? [])]
  }

  count(name: FlagName): number {
    return this.values.get(name)?.length ?? 0
  }

  /** Opções reconhecidas que apareceram, na ordem da primeira ocorrência. */
  used(): FlagName[] {
    return [...this.values.keys()]
  }
}

function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase()
  if (['', 'true', '1', 'yes', 'sim', 's', 'y'].includes(v)) return true
  if (['false', '0', 'no', 'nao', 'não', 'n'].includes(v)) return false
  return null
}

/** Token com cara de opção curta: "-x" (letra). "-", "-5" e "-1.5" são argumentos comuns. */
function looksShort(token: string): boolean {
  return /^-[A-Za-z]/.test(token)
}

/** Um valor de opção não pode ser outra opção longa (ex.: `--timeout --wait`). */
function looksLong(token: string): boolean {
  return token.startsWith('--') && token.length > 2
}

export function parseArgv(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const values = new Map<FlagName, string[]>()
  const unknown: string[] = []
  const errors: string[] = []
  const push = (name: FlagName, value: string): void => {
    const list = values.get(name)
    if (list) list.push(value)
    else values.set(name, [value])
  }

  let onlyPositionals = false
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (onlyPositionals) {
      positionals.push(token)
      continue
    }
    if (token === '--') {
      onlyPositionals = true
      continue
    }

    let name: string
    let inline: string | undefined
    let display: string
    if (looksLong(token)) {
      const eq = token.indexOf('=')
      name = eq === -1 ? token.slice(2) : token.slice(2, eq)
      inline = eq === -1 ? undefined : token.slice(eq + 1)
      display = `--${name}`
      if (!isFlagName(name)) {
        unknown.push(display)
        continue
      }
    } else if (looksShort(token)) {
      const long = token.length === 2 ? SHORT.get(token.slice(1)) : undefined
      if (!long) {
        unknown.push(token)
        continue
      }
      name = long
      display = token
    } else {
      positionals.push(token)
      continue
    }

    const flag = name as FlagName
    const def: FlagDef = FLAGS[flag]
    if (def.type === 'boolean') {
      if (inline === undefined) {
        push(flag, 'true')
      } else {
        const b = parseBool(inline)
        if (b === null) errors.push(`a opção ${display} não aceita o valor "${inline}" (use ${display} sozinha).`)
        else push(flag, String(b))
      }
      continue
    }

    let value = inline
    if (value === undefined) {
      const next = argv[i + 1]
      if (next === undefined || looksLong(next)) {
        errors.push(
          `a opção ${display} precisa de um valor: ${display} ${def.value ?? '<valor>'}` +
            ` (para um valor que começa com "-", use ${display}=<valor>).`
        )
        continue
      }
      value = next
      i++
    }
    push(flag, value)
  }

  return new ParsedArgs(positionals, values, unknown, errors)
}

/** "--timeout <segundos>", "--wait"... (para mensagens e ajuda). */
export function flagUsage(name: FlagName): string {
  const def: FlagDef = FLAGS[name]
  return def.value ? `--${name} ${def.value}` : `--${name}`
}

/**
 * Confere as opções usadas contra as aceitas pelo comando e lança erro de uso (código 2) com a
 * lista das válidas. `label` é o comando como o usuário digita (ex.: "note write").
 */
export function checkFlags(args: ParsedArgs, allowed: readonly FlagName[], label: string): void {
  const cmd = `${CLI_NAME} ${label}`
  const valid = [...allowed, 'json' as const].map(flagUsage).join(', ')
  const validHint = `opções válidas para "${cmd}": ${valid}.`
  const first = args.errors[0]
  if (first !== undefined) throw usageError(first, validHint)
  const unk = args.unknown[0]
  if (unk !== undefined) {
    throw usageError(
      `opção desconhecida "${unk}" em "${cmd}".`,
      `${validHint} Se isso faz parte do texto, ponha o texto entre aspas ou use "--" antes dele.`
    )
  }
  for (const name of args.used()) {
    if (GLOBAL_FLAGS.includes(name)) continue
    if (!allowed.includes(name)) throw usageError(`a opção --${name} não vale para "${cmd}".`, validHint)
    const def: FlagDef = FLAGS[name]
    if (def.type === 'string' && args.count(name) > 1) {
      throw usageError(`a opção --${name} foi informada mais de uma vez.`, validHint)
    }
  }
}
