/**
 * CLI `orq`: executado pelos agentes dentro dos terminais do app, no próprio Electron em modo Node
 * (`ELECTRON_RUN_AS_NODE=1 <electron> out/main/orq.js ...`, via shims em <userData>/bin).
 * Só módulos nativos do Node + src/shared. Toda a lógica fica em run.ts (testável sem processos).
 */
import { CLI_NAME } from '@shared/constants'
import { EXIT } from './errors'
import { nodeIo } from './io'
import { run } from './run'

const controller = new AbortController()
let signals = 0
const onSignal = (): void => {
  signals++
  // Segundo Ctrl+C: sai na hora. No primeiro, run() cancela a espera no app e termina sozinho.
  if (signals > 1) process.exit(EXIT.interrupted)
  controller.abort()
  setTimeout(() => process.exit(EXIT.interrupted), 3000).unref()
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, onSignal)

// Leitor fechou o pipe (ex.: `orq peers | head -1`): não é erro do CLI.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(typeof process.exitCode === 'number' ? process.exitCode : EXIT.ok)
  })
}

/** Espera o que já foi escrito no stream ser entregue ao sistema. */
function drain(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.destroyed || !stream.writable) resolve()
    else stream.write('', () => resolve())
  })
}

const io = nodeIo({ signal: controller.signal, scriptDir: __dirname })

void run(process.argv.slice(2), process.env, io)
  .catch((err: unknown) => {
    process.stderr.write(`${CLI_NAME}: erro inesperado: ${err instanceof Error ? err.message : String(err)}\n`)
    return EXIT.error
  })
  .then(async (code) => {
    process.exitCode = code
    await Promise.all([drain(process.stdout), drain(process.stderr)])
    if (io.usedStdin()) process.stdin.destroy()
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(sig, onSignal)
    // Saída já entregue: se algo ainda segurar o processo (ex.: pipe de stdin aberto), sai assim mesmo.
    setTimeout(() => process.exit(code), 1000).unref()
  })
