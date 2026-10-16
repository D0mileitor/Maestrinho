import { CLI_NAME } from '@shared/constants'
import { usageError, type CliError } from './errors'
import { decodeText, type CliIo } from './io'

/** Limite local de leitura de stdin/arquivo (o servidor ainda aplica o limite de caracteres do protocolo). */
export const MAX_INPUT_BYTES = 4 * 1024 * 1024

/** De onde vem um texto (mensagem, conteúdo de nota, instruções de papel). */
export type TextPlan =
  | { kind: 'args'; text: string }
  | { kind: 'stdin'; explicit: boolean }
  | { kind: 'file'; path: string }

/**
 * Decide a origem do texto (função pura; não lê nada):
 *  - `--file <caminho>` → arquivo;
 *  - exatamente `-` → stdin;
 *  - nenhum argumento e stdin que não é terminal (pipe, heredoc, redirecionamento) → stdin;
 *  - senão → os argumentos unidos por um espaço.
 * Devolve null quando não há texto algum (nenhum argumento e stdin é o teclado).
 */
export function planText(args: readonly string[], file: string | undefined, stdinIsTTY: boolean): TextPlan | null {
  if (file !== undefined) {
    if (args.length > 0) {
      throw usageError(
        `use só uma origem para o texto: argumentos ou --file (recebi os dois; argumento extra: "${args[0]}").`
      )
    }
    if (file.trim() === '') throw usageError('a opção --file precisa do caminho de um arquivo.')
    return { kind: 'file', path: file }
  }
  if (args.length === 1 && args[0] === '-') return { kind: 'stdin', explicit: true }
  if (args.length === 0) return stdinIsTTY ? null : { kind: 'stdin', explicit: false }
  return { kind: 'args', text: args.join(' ') }
}

/** Depois disso sem o stdin terminar (leitura implícita), avisa no stderr por que o comando não acabou. */
export const STDIN_NOTICE_MS = 5_000

/** Lê o texto conforme o plano (stdin/arquivo decodificados como UTF-8/UTF-16, CRLF → LF). */
export async function loadText(plan: TextPlan, io: CliIo): Promise<string> {
  switch (plan.kind) {
    case 'args':
      return plan.text
    case 'file':
      return decodeText(await io.readFile(plan.path, MAX_INPUT_BYTES))
    case 'stdin': {
      if (plan.explicit && io.stdinIsTTY) {
        io.err('(lendo o texto do teclado; termine com Ctrl+D — no Windows, Ctrl+Z e Enter)\n')
      }
      // Sem texto nos argumentos, o stdin de um pipe é lido; se o ambiente deixar esse pipe aberto
      // sem escrever nada, o comando ficaria parado em silêncio — o aviso explica o motivo.
      const notice = plan.explicit
        ? undefined
        : setTimeout(() => {
            io.err(
              `${CLI_NAME}: aguardando o texto pelo stdin, pois nenhum veio nos argumentos ` +
                '(passe o texto como argumento ou use "-" com pipe/heredoc).\n'
            )
          }, STDIN_NOTICE_MS)
      notice?.unref()
      try {
        return decodeText(await io.readStdin(MAX_INPUT_BYTES))
      } finally {
        clearTimeout(notice)
      }
    }
  }
}

/**
 * Erro de texto vazio conforme a origem. `subject` é a frase completa (ex.: "a mensagem está
 * vazia"), para a concordância ficar certa.
 */
export function emptySourceError(plan: TextPlan, subject: string, example: string): CliError {
  if (plan.kind === 'file') return usageError(`o arquivo "${plan.path}" está vazio.`)
  if (plan.kind === 'stdin') {
    return usageError(
      `${subject}: nada chegou pelo stdin.`,
      `passe o texto como argumento (${example}) ou mande pelo stdin com "-".`
    )
  }
  return usageError(`${subject}.`, `exemplo: ${example}`)
}

/**
 * Limpa uma mensagem para entrega no terminal de outro agente: tira linhas em branco do início e
 * espaços/quebras do fim (heredocs e pipes sempre deixam uma quebra final). Preserva a indentação
 * da primeira linha com conteúdo.
 */
export function cleanMessage(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd()
}

/** Garante a quebra de linha final (texto passado em argumentos para notas, como faz `echo`). */
export function withTrailingNewline(text: string): string {
  return text === '' || text.endsWith('\n') ? text : `${text}\n`
}

/**
 * Nome de peer/nó como o agente digitou. Aceita "@revisor" (estilo menção) — nomes válidos nunca
 * começam com "@".
 */
export function refArg(raw: string): string {
  const t = raw.trim()
  return t.startsWith('@') ? t.slice(1).trim() : t
}
