import type { ApiErrorCode } from '@shared/api'
import { stripAnsi } from '@shared/ansi'
import { CLI_NAME } from '@shared/constants'

/**
 * Códigos de saída do CLI (documentados em `orq help`). O agente que chamou decide o que fazer a
 * partir deles, então cada classe de problema tem um código estável.
 */
export const EXIT = {
  ok: 0,
  /** Erro genérico ou falha de conexão com o app. */
  error: 1,
  /** Uso incorreto (argumentos/opções) ou comando fora de um terminal do app. */
  usage: 2,
  /** Sem permissão: sem conexão no canvas, não é gerente, token inválido. */
  forbidden: 3,
  /** Peer, nota, papel, preset ou arquivo inexistente. */
  notFound: 4,
  /** Tempo esgotado (ex.: `send --wait`). */
  timeout: 5,
  /** O processo do destino não está rodando. */
  unavailable: 6,
  /** Conflito ou limite: nome ambíguo, nota alterada/travada, excesso de mensagens, texto grande demais. */
  conflict: 7,
  /** Interrompido por Ctrl+C ou sinal. */
  interrupted: 130
} as const
export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

/** Códigos de erro do CLI: os da API mais os problemas locais. */
export type CliErrorCode =
  | ApiErrorCode
  | 'usage'
  | 'not_in_terminal'
  | 'connection'
  | 'bad_response'
  | 'io'
  | 'interrupted'

const EXIT_BY_CODE: Record<CliErrorCode, ExitCode> = {
  bad_request: EXIT.usage,
  unauthorized: EXIT.forbidden,
  forbidden: EXIT.forbidden,
  not_found: EXIT.notFound,
  timeout: EXIT.timeout,
  conflict: EXIT.conflict,
  precondition: EXIT.conflict,
  too_large: EXIT.conflict,
  rate_limited: EXIT.conflict,
  unavailable: EXIT.unavailable,
  internal: EXIT.error,
  usage: EXIT.usage,
  not_in_terminal: EXIT.usage,
  connection: EXIT.error,
  bad_response: EXIT.error,
  io: EXIT.error,
  interrupted: EXIT.interrupted
}

export function exitCodeFor(code: CliErrorCode): ExitCode {
  return EXIT_BY_CODE[code]
}

/** Erro com código, mensagem em pt-BR e dica opcional (uma linha) para o agente se corrigir. */
export class CliError extends Error {
  constructor(
    readonly code: CliErrorCode,
    message: string,
    readonly hint?: string
  ) {
    super(message)
    this.name = 'CliError'
  }

  get exitCode(): ExitCode {
    return exitCodeFor(this.code)
  }
}

/** Erro devolvido pela API local (o app recusou o pedido); recebe a dica padrão do comando. */
export class ApiCallError extends CliError {
  constructor(code: ApiErrorCode, message: string) {
    super(code, message)
    this.name = 'ApiCallError'
  }
}

export function usageError(message: string, hint?: string): CliError {
  return new CliError('usage', message, hint)
}

export function isCliError(err: unknown, code?: CliErrorCode): err is CliError {
  return err instanceof CliError && (code === undefined || err.code === code)
}

/** Converte qualquer falha em CliError (erros inesperados viram "internal", código 1). */
export function toCliError(err: unknown): CliError {
  if (err instanceof CliError) return err
  const detail = err instanceof Error ? err.message : String(err)
  return new CliError('internal', `erro inesperado no CLI: ${detail}`)
}

/** Grupo do comando, para escolher a dica certa. */
export type HintScope = 'peer' | 'note' | 'role' | 'manager' | 'other'

export const TOO_LARGE_TEXT_HINT = 'divida o texto, ou grave-o numa nota conectada e envie só o nome dela.'
export const TOO_LARGE_NOTE_HINT = `divida o conteúdo em partes menores (${CLI_NAME} note append).`

/** Dica padrão para um erro vindo da API (quando o servidor não manda uma). */
export function hintFor(code: CliErrorCode, scope: HintScope): string | undefined {
  const c = CLI_NAME
  switch (code) {
    case 'forbidden':
      return scope === 'manager'
        ? `comandos de gerente só funcionam em terminais com o modo gerente ligado (veja "${c} whoami").`
        : `você só alcança o que está conectado a você no canvas: veja "${c} peers".`
    case 'unauthorized':
      return 'o token deste terminal não é mais aceito (o app foi reiniciado?); reinicie este terminal.'
    case 'not_found':
      if (scope === 'note') return `veja as notas conectadas com "${c} note list".`
      if (scope === 'role') return `veja os papéis com "${c} role list" (role edit aceita --create).`
      return `confira os nomes com "${c} peers".`
    case 'unavailable':
      return 'o processo do destino não está rodando (encerrado ou parado); peça ao usuário para reiniciá-lo.'
    case 'rate_limited':
      return 'muitas mensagens em pouco tempo nesta conexão; espere um pouco antes de tentar de novo.'
    case 'precondition':
      return `a nota mudou desde a revisão informada; leia de novo com "${c} note read <nota> --json".`
    case 'too_large':
      return scope === 'note' ? TOO_LARGE_NOTE_HINT : TOO_LARGE_TEXT_HINT
    case 'internal':
      return 'erro interno do app; os detalhes ficam no log do app.'
    default:
      return undefined
  }
}

/** Remove sequências de terminal de textos vindos de fora (servidor, outros agentes) e junta numa linha. */
export function oneLine(text: string): string {
  return stripAnsi(text).replace(/[\r\n\t]+/g, ' ').trim()
}
