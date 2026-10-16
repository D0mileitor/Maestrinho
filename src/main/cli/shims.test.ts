import { spawnSync , type SpawnSyncReturns } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { APP_NAME, CLI_NAME, ENV } from '@shared/constants'
import { findExecutable } from '../pty/resolveCommand'
import { cmdShim, installShims, posixShim } from './shims'

const isWin = process.platform === 'win32'

/** Ambiente do processo sem as variáveis do CLI (como num terminal comum, fora do app). */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(ORQ_|ELECTRON_RUN_AS_NODE$)/i.test(k)) continue
    env[k] = v
  }
  return env
}

describe('posixShim', () => {
  const shim = posixShim()

  it('começa com shebang /bin/sh e usa apenas LF', () => {
    expect(shim.startsWith('#!/bin/sh\n')).toBe(true)
    expect(shim).not.toContain('\r')
    expect(shim.endsWith('\n')).toBe(true)
  })

  it('lê executável e script das variáveis de ambiente (nomes centralizados em ENV)', () => {
    expect(shim).toContain(`"$${ENV.node}"`)
    expect(shim).toContain(`"$${ENV.cli}"`)
    expect(shim).toContain(`[ -z "$${ENV.node}" ] || [ -z "$${ENV.cli}" ]`)
    expect(ENV.node).toBe('ORQ_NODE')
    expect(ENV.cli).toBe('ORQ_CLI')
  })

  it('roda o Electron em modo Node e desliga a conversão de caminhos do MSYS/Git Bash', () => {
    const execLine = shim.split('\n').find((l) => l.includes('exec '))
    expect(execLine).toBeDefined()
    expect(execLine).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(execLine).toContain('MSYS_NO_PATHCONV=1')
    expect(execLine).toContain("MSYS2_ARG_CONV_EXCL='*'")
    expect(execLine).toMatch(/exec "\$node_bin" "\$ORQ_CLI" "\$@"$/)
  })

  it('converte o caminho do executável com cygpath quando disponível (Git Bash)', () => {
    expect(shim).toContain('command -v cygpath')
    expect(shim).toContain('cygpath -u "$node_bin"')
  })

  it('sem as variáveis, avisa no stderr e sai com código 2', () => {
    expect(shim).toContain(`${CLI_NAME}: este comando só funciona dentro de um terminal do ${APP_NAME}.`)
    expect(shim).toMatch(/>&2\n\s+exit 2\n/)
  })

  it('não contém caminhos absolutos (o mesmo arquivo serve para qualquer instalação)', () => {
    const body = shim.split('\n').slice(1).join('\n')
    expect(body).not.toMatch(/[A-Za-z]:\\/)
    expect(body).not.toMatch(/\s\/(home|usr|opt|Users)\//)
  })
})

describe('cmdShim', () => {
  const shim = cmdShim()

  it('usa CRLF em todas as linhas (sem LF solto)', () => {
    expect(shim).toContain('\r\n')
    expect(shim.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(shim.endsWith('\r\n')).toBe(true)
  })

  it('é ASCII puro (o cmd.exe lê o .cmd na página de código OEM)', () => {
    expect(/^[\x20-\x7e\r\n]*$/.test(shim)).toBe(true)
  })

  it('repassa os argumentos com %* para o executável/script das variáveis de ambiente', () => {
    const lines = shim.split('\r\n')
    expect(lines[0]).toBe('@echo off')
    expect(lines).toContain('setlocal')
    expect(lines).toContain('set "ELECTRON_RUN_AS_NODE=1"')
    expect(lines).toContain(`"%${ENV.node}%" "%${ENV.cli}%" %*`)
    expect(lines).toContain('exit /b %ERRORLEVEL%')
  })

  it('sem ORQ_NODE, avisa no stderr e sai com código 2', () => {
    expect(shim).toContain(`if not defined ${ENV.node} (`)
    expect(shim).toContain('1>&2')
    expect(shim).toContain('exit /b 2')
  })
})

describe('installShims', () => {
  let dir = ''

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-shims-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('cria <userData>/bin com os dois shims e devolve o diretório', () => {
    const binDir = installShims(dir)
    expect(binDir).toBe(path.join(dir, 'bin'))
    expect(fs.readFileSync(path.join(binDir, CLI_NAME), 'utf8')).toBe(posixShim())
    expect(fs.readFileSync(path.join(binDir, `${CLI_NAME}.cmd`), 'utf8')).toBe(cmdShim())
    expect(fs.readdirSync(binDir).sort()).toEqual([CLI_NAME, `${CLI_NAME}.cmd`].sort())
  })

  it.runIf(!isWin)('o shim POSIX fica executável (0755)', () => {
    const binDir = installShims(dir)
    expect(fs.statSync(path.join(binDir, CLI_NAME)).mode & 0o777).toBe(0o755)
  })

  it('é idempotente: não reescreve arquivos que já estão corretos', () => {
    const binDir = installShims(dir)
    const files = [path.join(binDir, CLI_NAME), path.join(binDir, `${CLI_NAME}.cmd`)]
    const past = new Date('2020-01-01T00:00:00Z')
    for (const f of files) fs.utimesSync(f, past, past)
    expect(installShims(dir)).toBe(binDir)
    for (const f of files) expect(fs.statSync(f).mtimeMs).toBe(past.getTime())
  })

  it('restaura shims alterados ou corrompidos', () => {
    const binDir = installShims(dir)
    fs.writeFileSync(path.join(binDir, CLI_NAME), 'echo adulterado\n')
    fs.writeFileSync(path.join(binDir, `${CLI_NAME}.cmd`), '')
    installShims(dir)
    expect(fs.readFileSync(path.join(binDir, CLI_NAME), 'utf8')).toBe(posixShim())
    expect(fs.readFileSync(path.join(binDir, `${CLI_NAME}.cmd`), 'utf8')).toBe(cmdShim())
  })

  it('cria o diretório userData se ainda não existir', () => {
    const nested = path.join(dir, 'a', 'b')
    const binDir = installShims(nested)
    expect(fs.existsSync(path.join(binDir, `${CLI_NAME}.cmd`))).toBe(true)
  })
})

// ------------------------------------------------------------------ execução real dos shims

/** Script que registra argv e variáveis relevantes em DUMP_FILE e sai com o código pedido. */
const DUMP_SCRIPT = [
  "const fs = require('node:fs')",
  'const argv = process.argv.slice(2)',
  'fs.writeFileSync(process.env.DUMP_FILE, JSON.stringify({',
  '  argv,',
  '  electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,',
  '  msysNoPathconv: process.env.MSYS_NO_PATHCONV ?? null',
  '}))',
  "const code = argv.find((a) => a.startsWith('--sair-com='))",
  "if (code) process.exitCode = Number(code.split('=')[1])",
  ''
].join('\n')

interface Dump {
  argv: string[]
  electronRunAsNode: string | null
  msysNoPathconv: string | null
}

describe('shims executados de verdade', () => {
  let dir = ''
  let binDir = ''
  let script = ''
  let dumpFile = ''

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-shims-run-'))
    binDir = installShims(dir)
    script = path.join(dir, 'dump.js')
    dumpFile = path.join(dir, 'dump.json')
    fs.writeFileSync(script, DUMP_SCRIPT)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const cliEnv = (): Record<string, string> => ({
    ...cleanEnv(),
    [ENV.node]: process.execPath,
    [ENV.cli]: script,
    DUMP_FILE: dumpFile
  })
  const readDump = (): Dump => JSON.parse(fs.readFileSync(dumpFile, 'utf8')) as Dump

  // No Windows depende do Git Bash (sh.exe no PATH); no Linux, /bin/sh.
  const sh = isWin ? findExecutable('sh', process.env) : '/bin/sh'

  it.runIf(sh !== null)('shim POSIX: executa o CLI com os argumentos intactos ("/revisar" não vira caminho)', () => {
    const args = ['send', 'revisor', 'olá mundo', '/revisar', '--wait', '--sair-com=0']
    const r = spawnSync(sh!, [path.join(binDir, CLI_NAME), ...args], { env: cliEnv(), encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    const dump = readDump()
    expect(dump.argv).toEqual(args)
    expect(dump.electronRunAsNode).toBe('1')
    expect(dump.msysNoPathconv).toBe('1')
  })

  it.runIf(sh !== null)('shim POSIX: propaga o código de saída do CLI', () => {
    const r = spawnSync(sh!, [path.join(binDir, CLI_NAME), '--sair-com=7'], { env: cliEnv(), encoding: 'utf8' })
    expect(r.status).toBe(7)
  })

  it.runIf(sh !== null)('shim POSIX: fora de um terminal do app, sai com código 2 e mensagem no stderr', () => {
    const r = spawnSync(sh!, [path.join(binDir, CLI_NAME), 'whoami'], { env: cleanEnv(), encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(`funciona dentro de um terminal do ${APP_NAME}`)
    expect(fs.existsSync(dumpFile)).toBe(false)
  })

  /** Executa o orq.cmd pelo cmd.exe como um usuário digitaria (aspas simples; os args não têm metacaracteres). */
  function runCmdShim(args: string[], env: Record<string, string>): SpawnSyncReturns<string> {
    const comspec = process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe'
    const line = [path.join(binDir, `${CLI_NAME}.cmd`), ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
    // /s + aspas externas: o cmd remove só o primeiro e o último caractere de aspas.
    return spawnSync(comspec, [`/d /s /c "${line}"`], { windowsVerbatimArguments: true, env, encoding: 'utf8' })
  }

  it.runIf(isWin)('shim .cmd: executa o CLI com os argumentos e ELECTRON_RUN_AS_NODE=1', () => {
    const args = ['send', 'revisor', 'ola mundo', '/revisar', '--sair-com=0']
    const r = runCmdShim(args, cliEnv())
    expect(r.status, r.stderr).toBe(0)
    const dump = readDump()
    expect(dump.argv).toEqual(args)
    expect(dump.electronRunAsNode).toBe('1')
  })

  it.runIf(isWin)('shim .cmd: propaga o código de saída do CLI', () => {
    expect(runCmdShim(['--sair-com=7'], cliEnv()).status).toBe(7)
  })

  it.runIf(isWin)('shim .cmd: fora de um terminal do app, sai com código 2 e mensagem no stderr', () => {
    const r = runCmdShim(['whoami'], cleanEnv())
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(`funciona dentro de um terminal do ${APP_NAME}`)
    expect(fs.existsSync(dumpFile)).toBe(false)
  })
})
