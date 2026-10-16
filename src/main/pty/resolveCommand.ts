import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Resolve o executável de um preset no PATH (com PATHEXT no Windows) e decide como iniciá-lo.
 *
 * No Windows, o ConPTY só inicia executáveis reais. Agentes instalados via npm são shims `.cmd`;
 * para esses, lemos o shim (formato do npm cmd-shim) e iniciamos o alvo diretamente — evitando o
 * `cmd.exe` e o aviso "Terminar o trabalho em lotes (S/N)?" ao pressionar Ctrl+C. Se o shim não
 * for reconhecido, usamos `cmd.exe /d /s /c` com escape seguro.
 */

export interface FsProbe {
  isFile(p: string): boolean
  readText(p: string): string | null
}

export const realFs: FsProbe = {
  isFile(p) {
    try {
      return fs.statSync(p).isFile()
    } catch {
      return false
    }
  },
  readText(p) {
    try {
      return fs.readFileSync(p, 'utf8')
    } catch {
      return null
    }
  }
}

export interface SpawnPlan {
  /** Executável passado ao node-pty. */
  file: string
  /** Argumentos: array (node-pty faz o quoting) ou linha de comando já montada (Windows). */
  args: string[] | string
  /** Descrição legível (para mensagens de erro e logs). */
  display: string
  via: 'direct' | 'npm-shim' | 'cmd'
}

export class CommandNotFoundError extends Error {
  constructor(public readonly command: string) {
    super(`Comando não encontrado: ${command}`)
    this.name = 'CommandNotFoundError'
  }
}

function getEnvValue(env: Record<string, string | undefined>, key: string): string | undefined {
  const found = Object.keys(env).find((k) => k.toLowerCase() === key.toLowerCase())
  return found ? env[found] : undefined
}

function hasPathSeparator(cmd: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? /[\\/]/.test(cmd) || /^[a-zA-Z]:/.test(cmd) : cmd.includes('/')
}

/** Procura `command` no PATH. Retorna caminho absoluto ou null. */
export function findExecutable(
  command: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  probe: FsProbe = realFs,
  cwd: string = process.cwd()
): string | null {
  const p = platform === 'win32' ? path.win32 : path.posix
  const exts =
    platform === 'win32'
      ? (getEnvValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e === '.exe' || e === '.cmd' || e === '.bat' || e === '.com')
      : ['']
  const candidatesFor = (base: string): string[] => {
    if (platform !== 'win32') return [base]
    const ext = p.extname(base).toLowerCase()
    // Já tem extensão executável: tenta como está primeiro.
    const list = exts.includes(ext) ? [base] : []
    for (const e of exts) list.push(base + e)
    return list
  }

  if (hasPathSeparator(command, platform)) {
    const abs = p.isAbsolute(command) ? command : p.resolve(cwd, command)
    return candidatesFor(abs).find((c) => probe.isFile(c)) ?? null
  }

  const pathValue = getEnvValue(env, 'PATH') ?? ''
  const dirs = pathValue.split(platform === 'win32' ? ';' : ':').filter((d) => d.trim() !== '')
  for (const rawDir of dirs) {
    const dir = rawDir.replace(/^"(.*)"$/, '$1')
    for (const candidate of candidatesFor(p.join(dir, command))) {
      if (probe.isFile(candidate)) return candidate
    }
  }
  return null
}

/**
 * Quoting de um argumento segundo as regras do CommandLineToArgvW / MSVCRT (o que os programas do
 * Windows usam para separar a linha de comando). Barras invertidas só são especiais antes de aspas e
 * no fim do argumento. Montamos a linha nós mesmos porque o node-pty deixa sem aspas um argumento que
 * já começa e termina com aspas, o que permitiria injetar argumentos (ex.: texto de um papel).
 */
export function quoteWindowsArg(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg
  let out = '"'
  let backslashes = 0
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes += 1
      continue
    }
    if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"'
    } else {
      out += '\\'.repeat(backslashes) + ch
    }
    backslashes = 0
  }
  out += '\\'.repeat(backslashes * 2) + '"'
  return out
}

/** Linha de comando (sem o executável) para o Windows. */
export function windowsCommandLine(args: readonly string[]): string {
  return args.map(quoteWindowsArg).join(' ')
}

/**
 * Escape de argumento para cmd.exe (algoritmo de https://qntm.org/cmd). Adaptado do cross-spawn
 * (lib/util/escape.js, MIT, Copyright (c) 2018 Made With MOXY Lda), com o quoting reescrito abaixo.
 */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g
export function escapeCmdArgument(arg: string, doubleEscape: boolean): string {
  // O cmd.exe encerra a linha de comando na primeira quebra de linha: troca por espaço.
  const flat = arg.replace(/\r\n|\r|\n/g, ' ')
  // Quoting MSVCRT por varredura linear (regex com `(\\*)"` teria retrocesso quadrático em sequências
  // longas de barras — mesmo padrão do CVE-2024-21538): barras antes de aspas dobram e a aspa é
  // escapada; barras no fim dobram antes da aspa final.
  let a = '"'
  let backslashes = 0
  for (const ch of flat) {
    if (ch === '\\') {
      backslashes += 1
      continue
    }
    a += ch === '"' ? '\\'.repeat(backslashes * 2 + 1) + '"' : '\\'.repeat(backslashes) + ch
    backslashes = 0
  }
  a += '\\'.repeat(backslashes * 2) + '"'
  a = a.replace(CMD_META, '^$1')
  if (doubleEscape) a = a.replace(CMD_META, '^$1')
  return a
}
export function escapeCmdCommand(cmd: string): string {
  return cmd.replace(CMD_META, '^$1')
}

interface ShimTarget {
  /** Executável final (exe nativo ou node). */
  program: string
  /** Argumentos prefixados (ex.: caminho do script JS). */
  prefixArgs: string[]
}

/**
 * Interpreta shims do npm (cmd-shim). Formatos conhecidos:
 *   "%dp0%\node_modules\pkg\bin\tool.exe"   %*
 *   ... "%_prog%"  "%dp0%\node_modules\pkg\bin\cli.js" %*
 */
export function parseNpmCmdShim(
  shimPath: string,
  content: string,
  env: Record<string, string | undefined>,
  probe: FsProbe = realFs
): ShimTarget | null {
  const dir = path.win32.dirname(shimPath)
  const line = content
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.includes('%*'))
  if (!line) return null
  const quoted = [...line.matchAll(/"%~?dp0%?\\?([^"]+)"/g)].map((m) => path.win32.join(dir, m[1]!))
  if (quoted.length === 0) return null
  const usesProg = /"%_prog%"/i.test(line)
  if (!usesProg) {
    const exe = quoted[0]!
    if (!/\.(exe|com)$/i.test(exe) || !probe.isFile(exe)) return null
    return { program: exe, prefixArgs: [] }
  }
  const script = quoted[quoted.length - 1]!
  if (!probe.isFile(script)) return null
  const localNode = path.win32.join(dir, 'node.exe')
  const node = probe.isFile(localNode) ? localNode : findExecutable('node', env, 'win32', probe)
  if (!node) return null
  return { program: node, prefixArgs: [script] }
}

/** Monta o plano de execução para o node-pty. */
export function planSpawn(
  command: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
  options: { platform?: NodeJS.Platform; probe?: FsProbe; cwd?: string } = {}
): SpawnPlan {
  const platform = options.platform ?? process.platform
  const probe = options.probe ?? realFs
  const resolved = findExecutable(command, env, platform, probe, options.cwd)
  if (!resolved) throw new CommandNotFoundError(command)
  // Linha exibida na interface: argumentos longos (ex.: instruções do papel) aparecem abreviados.
  const display = [command, ...args.map((a) => (a.length > 80 ? `<${a.length} caracteres>` : a))].join(' ')

  if (platform !== 'win32') {
    return { file: resolved, args: [...args], display, via: 'direct' }
  }
  // No Windows a linha de comando é montada aqui (ver quoteWindowsArg).
  if (!/\.(cmd|bat)$/i.test(resolved)) {
    return { file: resolved, args: windowsCommandLine(args), display, via: 'direct' }
  }

  const content = probe.readText(resolved)
  if (content) {
    const target = parseNpmCmdShim(resolved, content, env, probe)
    if (target) {
      return {
        file: target.program,
        args: windowsCommandLine([...target.prefixArgs, ...args]),
        display,
        via: 'npm-shim'
      }
    }
  }

  // Fallback: cmd.exe /d /s /c "<shim> <args>" com escape duplo (o shim re-interpreta %*).
  const comspec = getEnvValue(env, 'ComSpec') ?? 'C:\\Windows\\System32\\cmd.exe'
  const inner = [escapeCmdCommand(path.win32.normalize(resolved)), ...args.map((a) => escapeCmdArgument(a, true))].join(' ')
  return { file: comspec, args: `/d /s /c "${inner}"`, display, via: 'cmd' }
}
