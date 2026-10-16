import { app } from 'electron'
import { run } from '../../cli/run'
import { sleep, type CliIo } from '../../cli/io'
import { ENV } from '@shared/constants'

/**
 * Executa o CLI `orq` dentro do processo principal, em nome de um terminal (o token dele). Usado pelo
 * `orq` remoto (servidores via SSH), que só tem `curl`: ele envia os argumentos para POST /v1/cli e
 * recebe a saída pronta. As mesmas regras, mensagens e códigos de saída do CLI local valem aqui, e
 * cada chamada interna passa de novo pela API com o token do terminal (validação do grafo inclusa).
 */
export interface CliRun {
  exitCode: number
  output: string
}

const MAX_OUTPUT = 4 * 1024 * 1024

export async function runCliInProcess(opts: {
  argv: string[]
  stdin: string | undefined
  port: number
  token: string
  signal: AbortSignal
}): Promise<CliRun> {
  let output = ''
  const write = (t: string): void => {
    if (output.length < MAX_OUTPUT) output += t
  }
  const stdin = Buffer.from(opts.stdin ?? '', 'utf8')
  const io: CliIo = {
    out: write,
    err: write,
    readStdin: async (maxBytes) => {
      if (stdin.length > maxBytes) throw new Error('entrada grande demais')
      return stdin
    },
    readFile: async () => {
      throw new Error('--file não está disponível no orq remoto: envie o texto pelo stdin (orq send <peer> - < arquivo)')
    },
    // Sem texto no stdin, o CLI não deve tentar lê-lo.
    stdinIsTTY: opts.stdin === undefined,
    stdoutIsTTY: false,
    now: () => Date.now(),
    sleep: (ms, signal) => sleep(ms, signal ?? opts.signal),
    signal: opts.signal,
    version: () => app.getVersion()
  }
  const env = { [ENV.port]: String(opts.port), [ENV.token]: opts.token }
  const exitCode = await run(opts.argv, env, io)
  return { exitCode, output }
}
