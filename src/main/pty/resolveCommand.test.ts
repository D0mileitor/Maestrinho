import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CommandNotFoundError,
  escapeCmdArgument,
  escapeCmdCommand,
  findExecutable,
  parseNpmCmdShim,
  planSpawn,
  quoteWindowsArg,
  windowsCommandLine,
  type FsProbe,
  type SpawnPlan
} from './resolveCommand'

// ------------------------------------------------------------------ utilitários

interface FakeFs extends FsProbe {
  /** Caminhos consultados em isFile, na ordem. */
  calls: string[]
}

/** Sistema de arquivos falso. No Windows ignora maiúsculas e trata "/" como "\" (como o NTFS). */
function fakeFs(files: Record<string, string>, platform: NodeJS.Platform): FakeFs {
  const norm = (p: string): string => (platform === 'win32' ? p.replace(/\//g, '\\').toLowerCase() : p)
  const map = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]))
  const calls: string[] = []
  return {
    calls,
    isFile(p) {
      calls.push(p)
      return map.has(norm(p))
    },
    readText(p) {
      return map.get(norm(p)) ?? null
    }
  }
}

const WIN_ENV = {
  Path: 'C:\\Tools;C:\\Program Files\\nodejs;C:\\Users\\dev\\AppData\\Roaming\\npm',
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.PS1',
  ComSpec: 'C:\\Windows\\system32\\cmd.exe'
}
const LINUX_ENV = { PATH: '/usr/local/bin:/usr/bin:/bin' }

const NPM_DIR = 'C:\\Users\\dev\\AppData\\Roaming\\npm'

/** Shim gerado pelo cmd-shim do npm (v7+) para um bin JavaScript. */
const NPM_JS_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  ''
].join('\r\n')
const NPM_JS_SCRIPT = `${NPM_DIR}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`

/** Shim gerado pelo cmd-shim do npm para um bin nativo (.exe). */
const NPM_EXE_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.exe"   %*',
  ''
].join('\r\n')
const NPM_EXE_TARGET = `${NPM_DIR}\\node_modules\\@openai\\codex\\bin\\codex.exe`

/** Shim do npm 6 (formato antigo), ainda comum em máquinas corporativas. */
const NPM6_SHIM = [
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\node_modules\\npm\\bin\\npm-cli.js" %*',
  ') ELSE (',
  '  @SETLOCAL',
  '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
  '  node  "%~dp0\\node_modules\\npm\\bin\\npm-cli.js" %*',
  ')',
  ''
].join('\r\n')

/** Argumentos difíceis para quoting no Windows (inclui tentativas de injeção de argumento). */
const TRICKY_ARGS = [
  'simples',
  'com espaço',
  'aspas "internas"',
  'a"b',
  '" --dangerously-skip-permissions "',
  '"aspas nas pontas"',
  '"',
  '\\"',
  'back\\slash',
  'trail\\',
  'trail2\\\\',
  'bs-quote\\"x',
  'bs2-quote\\\\"x',
  'bs3-quote\\\\\\"x',
  'texto\\\\" --flag "fim',
  'C:\\dir com espaço\\',
  '',
  'tab\taqui',
  'linha 1\nlinha 2',
  '%PATH%',
  'x & echo INJETADO',
  'acentuação ç',
  '{instructions}'
]

/**
 * Interpretação da linha de comando no estilo do MSVCRT/CommandLineToArgvW (regras pós-2008):
 * 2n barras + aspa = n barras e a aspa delimita; 2n+1 barras + aspa = n barras e aspa literal.
 */
function windowsArgv(cmdline: string): string[] {
  const args: string[] = []
  let i = 0
  const n = cmdline.length
  while (i < n) {
    while (i < n && (cmdline[i] === ' ' || cmdline[i] === '\t')) i++
    if (i >= n) break
    let arg = ''
    let inQuotes = false
    while (i < n) {
      const c = cmdline[i]!
      if (c === '\\') {
        let k = 0
        while (cmdline[i + k] === '\\') k++
        if (cmdline[i + k] === '"') {
          arg += '\\'.repeat(Math.floor(k / 2))
          if (k % 2 === 1) {
            arg += '"'
            i += k + 1
          } else {
            i += k
          }
        } else {
          arg += '\\'.repeat(k)
          i += k
        }
        continue
      }
      if (c === '"') {
        if (inQuotes && cmdline[i + 1] === '"') {
          arg += '"'
          i += 2
        } else {
          inQuotes = !inQuotes
          i++
        }
        continue
      }
      if (!inQuotes && (c === ' ' || c === '\t')) break
      arg += c
      i++
    }
    args.push(arg)
  }
  return args
}

/**
 * Um nível de processamento de "^" do cmd.exe. Como todas as aspas saem escapadas (^"), o cmd nunca
 * entra em modo "entre aspas" e todo circunflexo é processado.
 */
const uncaret = (s: string): string => s.replace(/\^([\s\S])/g, '$1')

/** Argumentos como o programa final os recebe após cmd.exe + `%*` do shim (dois níveis de ^). */
const throughCmdShim = (arg: string): string[] => windowsArgv(uncaret(uncaret(escapeCmdArgument(arg, true))))

// ------------------------------------------------------------------ findExecutable

describe('findExecutable (win32)', () => {
  it('procura nos diretórios do PATH na ordem, testando as extensões do PATHEXT', () => {
    const probe = fakeFs({ [`${NPM_DIR}\\claude.cmd`]: '', 'C:\\Tools\\claude.exe': '' }, 'win32')
    expect(findExecutable('claude', WIN_ENV, 'win32', probe, 'C:\\proj')).toBe('C:\\Tools\\claude.exe')
    expect(probe.calls).toEqual(['C:\\Tools\\claude.com', 'C:\\Tools\\claude.exe'])
  })

  it('segue para os próximos diretórios quando não encontra', () => {
    const probe = fakeFs({ [`${NPM_DIR}\\claude.cmd`]: '' }, 'win32')
    expect(findExecutable('claude', WIN_ENV, 'win32', probe, 'C:\\proj')).toBe(`${NPM_DIR}\\claude.cmd`)
  })

  it('dentro do mesmo diretório vale a ordem do PATHEXT', () => {
    const files = { 'C:\\Tools\\x.exe': '', 'C:\\Tools\\x.com': '', 'C:\\Tools\\x.cmd': '' }
    expect(findExecutable('x', WIN_ENV, 'win32', fakeFs(files, 'win32'))).toBe('C:\\Tools\\x.com')
    const env = { ...WIN_ENV, PATHEXT: '.CMD;.EXE' }
    expect(findExecutable('x', env, 'win32', fakeFs(files, 'win32'))).toBe('C:\\Tools\\x.cmd')
  })

  it('só considera extensões que o ConPTY consegue iniciar (.com/.exe/.bat/.cmd)', () => {
    const probe = fakeFs({ 'C:\\Tools\\s.js': '', 'C:\\Tools\\s.ps1': '', 'C:\\Tools\\s.vbs': '' }, 'win32')
    expect(findExecutable('s', WIN_ENV, 'win32', probe)).toBeNull()
    expect(probe.calls.some((c) => /\.(js|ps1|vbs|msc)$/i.test(c))).toBe(false)
  })

  it('sem PATHEXT usa o padrão .COM;.EXE;.BAT;.CMD', () => {
    const probe = fakeFs({ 'C:\\Tools\\tool.bat': '' }, 'win32')
    expect(findExecutable('tool', { Path: 'C:\\Tools' }, 'win32', probe)).toBe('C:\\Tools\\tool.bat')
    expect(probe.calls).toEqual(['C:\\Tools\\tool.com', 'C:\\Tools\\tool.exe', 'C:\\Tools\\tool.bat'])
  })

  it('nomes de variável sem diferenciar maiúsculas (Path, PATH, path, PathExt)', () => {
    const files = { 'C:\\Tools\\tool.exe': '' }
    for (const key of ['Path', 'PATH', 'path']) {
      expect(findExecutable('tool', { [key]: 'C:\\Tools' }, 'win32', fakeFs(files, 'win32'))).toBe('C:\\Tools\\tool.exe')
    }
    const probe = fakeFs({ 'C:\\Tools\\tool.cmd': '' }, 'win32')
    expect(findExecutable('tool', { PATH: 'C:\\Tools', PathExt: '.EXE' }, 'win32', probe)).toBeNull()
  })

  it('extensão executável explícita é testada primeiro, como está', () => {
    const probe = fakeFs({ 'C:\\Program Files\\nodejs\\node.exe': '' }, 'win32')
    expect(findExecutable('node.exe', WIN_ENV, 'win32', probe)).toBe('C:\\Program Files\\nodejs\\node.exe')
    expect(probe.calls[0]).toBe('C:\\Tools\\node.exe')
    expect(probe.calls[1]).toBe('C:\\Tools\\node.exe.com')
  })

  it('extensão não executável não é tentada como está (script.ps1 não é iniciável)', () => {
    const probe = fakeFs({ 'C:\\Tools\\script.ps1': '' }, 'win32')
    expect(findExecutable('script.ps1', WIN_ENV, 'win32', probe)).toBeNull()
    expect(probe.calls).not.toContain('C:\\Tools\\script.ps1')
  })

  it('aceita diretórios entre aspas e ignora entradas vazias no PATH', () => {
    const env = { Path: ';;"C:\\Program Files\\Tool";;C:\\Other;' }
    const probe = fakeFs({ 'C:\\Program Files\\Tool\\t.exe': '' }, 'win32')
    expect(findExecutable('t', env, 'win32', probe)).toBe('C:\\Program Files\\Tool\\t.exe')
    expect(probe.calls.every((c) => c.startsWith('C:\\'))).toBe(true)
  })

  it('caminho absoluto não consulta o PATH (barras normais ou invertidas)', () => {
    const probe = fakeFs({ 'D:\\apps\\agent.exe': '' }, 'win32')
    expect(findExecutable('D:\\apps\\agent', WIN_ENV, 'win32', probe)).toBe('D:\\apps\\agent.exe')
    expect(findExecutable('D:\\apps\\agent.exe', WIN_ENV, 'win32', probe)).toBe('D:\\apps\\agent.exe')
    expect(findExecutable('D:/apps/agent.exe', WIN_ENV, 'win32', probe)).toBe('D:/apps/agent.exe')
    expect(probe.calls.some((c) => c.startsWith('C:\\Tools'))).toBe(false)
  })

  it('caminho relativo (com separador) é resolvido a partir do cwd', () => {
    const probe = fakeFs({ 'C:\\proj\\bin\\tool.cmd': '', 'C:\\shared\\x.exe': '' }, 'win32')
    expect(findExecutable('.\\bin\\tool', WIN_ENV, 'win32', probe, 'C:\\proj')).toBe('C:\\proj\\bin\\tool.cmd')
    expect(findExecutable('bin/tool', WIN_ENV, 'win32', probe, 'C:\\proj')).toBe('C:\\proj\\bin\\tool.cmd')
    expect(findExecutable('..\\shared\\x', WIN_ENV, 'win32', probe, 'C:\\proj')).toBe('C:\\shared\\x.exe')
  })

  it('não encontrado devolve null', () => {
    expect(findExecutable('inexistente', WIN_ENV, 'win32', fakeFs({}, 'win32'))).toBeNull()
    expect(findExecutable('inexistente', {}, 'win32', fakeFs({}, 'win32'))).toBeNull()
  })
})

describe('findExecutable (linux)', () => {
  it('procura no PATH separado por ":" e sem extensões', () => {
    const probe = fakeFs({ '/usr/bin/claude': '' }, 'linux')
    expect(findExecutable('claude', LINUX_ENV, 'linux', probe)).toBe('/usr/bin/claude')
    expect(probe.calls).toEqual(['/usr/local/bin/claude', '/usr/bin/claude'])
  })

  it('o primeiro diretório do PATH vence', () => {
    const probe = fakeFs({ '/usr/bin/x': '', '/usr/local/bin/x': '' }, 'linux')
    expect(findExecutable('x', LINUX_ENV, 'linux', probe)).toBe('/usr/local/bin/x')
  })

  it('PATHEXT é ignorado e o nome diferencia maiúsculas', () => {
    const probe = fakeFs({ '/usr/bin/Claude': '', '/usr/bin/claude.exe': '' }, 'linux')
    expect(findExecutable('claude', { ...LINUX_ENV, PATHEXT: '.EXE' }, 'linux', probe)).toBeNull()
  })

  it('caminho com "/" é absoluto ou relativo ao cwd; "\\" não é separador', () => {
    const probe = fakeFs({ '/opt/x/agent': '', '/home/dev/proj/agent': '' }, 'linux')
    expect(findExecutable('/opt/x/agent', LINUX_ENV, 'linux', probe)).toBe('/opt/x/agent')
    expect(findExecutable('./agent', LINUX_ENV, 'linux', probe, '/home/dev/proj')).toBe('/home/dev/proj/agent')
    const probe2 = fakeFs({}, 'linux')
    findExecutable('dir\\tool', LINUX_ENV, 'linux', probe2)
    expect(probe2.calls[0]).toBe('/usr/local/bin/dir\\tool')
  })
})

// ------------------------------------------------------------------ shims do npm

describe('parseNpmCmdShim', () => {
  const shimPath = `${NPM_DIR}\\claude.cmd`

  it('formato JS ("%_prog%"): usa o node.exe ao lado do shim quando existe', () => {
    const probe = fakeFs({ [NPM_JS_SCRIPT]: '', [`${NPM_DIR}\\node.exe`]: '' }, 'win32')
    expect(parseNpmCmdShim(shimPath, NPM_JS_SHIM, WIN_ENV, probe)).toEqual({
      program: `${NPM_DIR}\\node.exe`,
      prefixArgs: [NPM_JS_SCRIPT]
    })
  })

  it('formato JS: sem node.exe local, usa o node do PATH', () => {
    const probe = fakeFs({ [NPM_JS_SCRIPT]: '', 'C:\\Program Files\\nodejs\\node.exe': '' }, 'win32')
    expect(parseNpmCmdShim(shimPath, NPM_JS_SHIM, WIN_ENV, probe)).toEqual({
      program: 'C:\\Program Files\\nodejs\\node.exe',
      prefixArgs: [NPM_JS_SCRIPT]
    })
  })

  it('formato JS: sem node disponível ou sem o script, não reconhece (null)', () => {
    expect(parseNpmCmdShim(shimPath, NPM_JS_SHIM, WIN_ENV, fakeFs({ [NPM_JS_SCRIPT]: '' }, 'win32'))).toBeNull()
    const noScript = fakeFs({ 'C:\\Program Files\\nodejs\\node.exe': '' }, 'win32')
    expect(parseNpmCmdShim(shimPath, NPM_JS_SHIM, WIN_ENV, noScript)).toBeNull()
  })

  it('formato exe ("%dp0%\\...\\tool.exe" %*): executa o .exe diretamente', () => {
    const probe = fakeFs({ [NPM_EXE_TARGET]: '' }, 'win32')
    expect(parseNpmCmdShim(`${NPM_DIR}\\codex.cmd`, NPM_EXE_SHIM, WIN_ENV, probe)).toEqual({
      program: NPM_EXE_TARGET,
      prefixArgs: []
    })
  })

  it('formato exe com alvo inexistente não é reconhecido', () => {
    expect(parseNpmCmdShim(`${NPM_DIR}\\codex.cmd`, NPM_EXE_SHIM, WIN_ENV, fakeFs({}, 'win32'))).toBeNull()
  })

  it('aceita a variante "%~dp0\\" e quebras de linha LF', () => {
    const content = '@echo off\n"%~dp0\\bin\\tool.exe" %*\n'
    const probe = fakeFs({ 'C:\\t\\bin\\tool.exe': '' }, 'win32')
    expect(parseNpmCmdShim('C:\\t\\tool.cmd', content, WIN_ENV, probe)).toEqual({
      program: 'C:\\t\\bin\\tool.exe',
      prefixArgs: []
    })
  })

  it('sem linha com %* ou sem caminho relativo ao shim, não reconhece', () => {
    const probe = fakeFs({ 'C:\\abs\\tool.exe': '' }, 'win32')
    expect(parseNpmCmdShim('C:\\t\\a.cmd', '@echo off\r\necho oi\r\n', WIN_ENV, probe)).toBeNull()
    expect(parseNpmCmdShim('C:\\t\\a.cmd', '@echo off\r\n"C:\\abs\\tool.exe" %*\r\n', WIN_ENV, probe)).toBeNull()
  })

  it('limitação conhecida: shims do npm 6 (e do pnpm) não são reconhecidos e caem no cmd.exe', () => {
    const probe = fakeFs(
      { 'C:\\npm6\\node_modules\\npm\\bin\\npm-cli.js': '', 'C:\\Program Files\\nodejs\\node.exe': '' },
      'win32'
    )
    expect(parseNpmCmdShim('C:\\npm6\\npm.cmd', NPM6_SHIM, WIN_ENV, probe)).toBeNull()
  })
})

// ------------------------------------------------------------------ linha de comando do Windows

describe('quoteWindowsArg / windowsCommandLine', () => {
  it('argumento simples (sem espaço nem aspas) fica como está; barras soltas são literais', () => {
    expect(quoteWindowsArg('simples')).toBe('simples')
    expect(quoteWindowsArg('--allowedTools')).toBe('--allowedTools')
    expect(quoteWindowsArg('C:\\dir\\')).toBe('C:\\dir\\')
    expect(quoteWindowsArg('Bash(orq')).toBe('Bash(orq')
  })

  it('vazio, espaço, tab, quebra de linha ou aspas: entre aspas', () => {
    expect(quoteWindowsArg('')).toBe('""')
    expect(quoteWindowsArg('a b')).toBe('"a b"')
    expect(quoteWindowsArg('tab\tx')).toBe('"tab\tx"')
    expect(quoteWindowsArg('l1\nl2')).toBe('"l1\nl2"')
    expect(quoteWindowsArg('a"b')).toBe(String.raw`"a\"b"`)
  })

  it('barras antes de aspas e no fim (dentro das aspas) são dobradas', () => {
    expect(quoteWindowsArg('a\\\\"b')).toBe(String.raw`"a\\\\\"b"`)
    expect(quoteWindowsArg('C:\\dir com espaço\\')).toBe(String.raw`"C:\dir com espaço\\"`)
    expect(quoteWindowsArg('a\\b c')).toBe(String.raw`"a\b c"`)
  })

  it('argumento que já começa e termina com aspas também é protegido (sem injeção de argumentos)', () => {
    expect(quoteWindowsArg('" --dangerously-skip-permissions "')).toBe(String.raw`"\" --dangerously-skip-permissions \""`)
  })

  it('windowsCommandLine junta os argumentos com espaço', () => {
    expect(windowsCommandLine(['--modo', 'a b', ''])).toBe('--modo "a b" ""')
    expect(windowsCommandLine([])).toBe('')
  })

  it('modelo CommandLineToArgvW: qualquer lista de argumentos volta intacta', () => {
    expect(windowsArgv(windowsCommandLine(TRICKY_ARGS))).toEqual(TRICKY_ARGS)
    for (const a of TRICKY_ARGS) expect(windowsArgv(windowsCommandLine([a])), JSON.stringify(a)).toEqual([a])
  })
})

// ------------------------------------------------------------------ escape para cmd.exe

describe('escapeCmdArgument / escapeCmdCommand', () => {
  it('escape simples: aspas externas e ^ antes de cada metacaractere', () => {
    expect(escapeCmdArgument('simples', false)).toBe('^"simples^"')
    expect(escapeCmdArgument('a b', false)).toBe('^"a^ b^"')
    expect(escapeCmdArgument('a|b<c>d', false)).toBe('^"a^|b^<c^>d^"')
    expect(escapeCmdArgument('(x)!', false)).toBe('^"^(x^)^!^"')
  })

  it('escape duplo (alvo é .cmd/.bat que reinterpreta %*)', () => {
    expect(escapeCmdArgument('a b', true)).toBe('^^^"a^^^ b^^^"')
    expect(escapeCmdArgument('a"b', true)).toBe(String.raw`^^^"a\^^^"b^^^"`)
    expect(escapeCmdArgument('x&y', true)).toBe('^^^"x^^^&y^^^"')
    expect(escapeCmdArgument('50%', true)).toBe('^^^"50^^^%^^^"')
    expect(escapeCmdArgument('a^b', true)).toBe('^^^"a^^^^b^^^"')
    expect(escapeCmdArgument('', true)).toBe('^^^"^^^"')
  })

  it('barras invertidas no fim são dobradas (para não escapar a aspa de fechamento)', () => {
    expect(escapeCmdArgument('C:\\dir\\', true)).toBe(String.raw`^^^"C:\dir\\^^^"`)
    expect(escapeCmdArgument('a\\b', false)).toBe(String.raw`^"a\b^"`)
  })

  // Regressão: o regex preguiçoso herdado do cross-spawn >= 7.0.5 capturava só uma barra e permitia
  // injetar argumentos (`x\\" --flag "y` virava 3 argumentos).
  it('2+ barras invertidas antes de aspas ou no fim são dobradas corretamente', () => {
    expect(escapeCmdArgument('a\\\\', false)).toBe(String.raw`^"a\\\\^"`)
    expect(escapeCmdArgument('a\\\\"b', false)).toBe(String.raw`^"a\\\\\^"b^"`)
  })

  it('quebras de linha viram espaço (o cmd.exe encerraria a linha de comando nelas)', () => {
    expect(escapeCmdArgument('l1\nl2\r\nl3\rl4', false)).toBe('^"l1^ l2^ l3^ l4^"')
  })

  it('escapeCmdCommand escapa espaços e parênteses do caminho do shim', () => {
    expect(escapeCmdCommand('C:\\Program Files (x86)\\Tool\\t.cmd')).toBe(String.raw`C:\Program^ Files^ ^(x86^)\Tool\t.cmd`)
    expect(escapeCmdCommand('C:\\Tools\\legacy.cmd')).toBe('C:\\Tools\\legacy.cmd')
  })

  it('modelo cmd.exe + CommandLineToArgvW: argumentos (sem quebra de linha) chegam intactos, sem injeção', () => {
    for (const c of TRICKY_ARGS.filter((a) => !/[\r\n]/.test(a))) {
      expect(throughCmdShim(c), JSON.stringify(c)).toEqual([c])
    }
    expect(throughCmdShim('linha 1\nlinha 2')).toEqual(['linha 1 linha 2'])
  })

  // BUG (produção, regressão da correção acima): `(\\*)"` e `(\\*)$` voltam ao padrão do CVE-2024-21538
  // (cross-spawn < 7.0.5): com uma sequência longa de barras sem aspa depois, o retrocesso é quadrático
  // (~0,8 s para 40 mil barras nesta máquina) e trava o processo principal. Correção proposta: montar
  // o argumento por varredura linear, reaproveitando a lógica de quoteWindowsArg (ver relatório).
  it('escape em tempo linear: 80 mil barras invertidas não travam o processo', () => {
    const started = performance.now()
    escapeCmdArgument(`${'\\'.repeat(80_000)}x`, true)
    expect(performance.now() - started).toBeLessThan(200)
  })
})

// ------------------------------------------------------------------ planSpawn

describe('planSpawn (win32)', () => {
  it('.exe resolvido: execução direta com a linha de comando montada (regras do CommandLineToArgvW)', () => {
    const probe = fakeFs({ 'C:\\Tools\\agent.exe': '' }, 'win32')
    expect(planSpawn('agent', ['--modo', 'a b'], WIN_ENV, { platform: 'win32', probe, cwd: 'C:\\proj' })).toEqual({
      file: 'C:\\Tools\\agent.exe',
      args: '--modo "a b"',
      display: 'agent --modo a b',
      via: 'direct'
    })
  })

  it('shim npm de bin JS: inicia o node com o script (sem cmd.exe) e repassa os argumentos', () => {
    const probe = fakeFs(
      { [`${NPM_DIR}\\claude.cmd`]: NPM_JS_SHIM, [NPM_JS_SCRIPT]: '', 'C:\\Program Files\\nodejs\\node.exe': '' },
      'win32'
    )
    const plan = planSpawn('claude', ['--append-system-prompt', 'linha 1\nlinha 2'], WIN_ENV, { platform: 'win32', probe })
    expect(plan).toEqual({
      file: 'C:\\Program Files\\nodejs\\node.exe',
      args: `${NPM_JS_SCRIPT} --append-system-prompt "linha 1\nlinha 2"`,
      display: 'claude --append-system-prompt linha 1\nlinha 2',
      via: 'npm-shim'
    })
    expect(windowsArgv(plan.args as string)).toEqual([NPM_JS_SCRIPT, '--append-system-prompt', 'linha 1\nlinha 2'])
  })

  it('shim npm de bin nativo: executa o .exe alvo', () => {
    const probe = fakeFs({ [`${NPM_DIR}\\codex.cmd`]: NPM_EXE_SHIM, [NPM_EXE_TARGET]: '' }, 'win32')
    const plan = planSpawn('codex', ['-c', 'x=1'], WIN_ENV, { platform: 'win32', probe })
    expect(plan).toMatchObject({ file: NPM_EXE_TARGET, args: '-c x=1', via: 'npm-shim' })
  })

  it('.cmd não reconhecido: cmd.exe /d /s /c com escape duplo (linha de comando exata)', () => {
    const probe = fakeFs({ 'C:\\Tools\\legacy.cmd': '@echo off\r\nlegacy-real.exe %*\r\n' }, 'win32')
    const args = ['a b', 'a"b', 'x&y', '50%', 'a^b', '']
    const plan = planSpawn('legacy', args, WIN_ENV, { platform: 'win32', probe })
    expect(plan.via).toBe('cmd')
    expect(plan.file).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(plan.args).toBe(
      String.raw`/d /s /c "C:\Tools\legacy.cmd ^^^"a^^^ b^^^" ^^^"a\^^^"b^^^" ^^^"x^^^&y^^^" ^^^"50^^^%^^^" ^^^"a^^^^b^^^" ^^^"^^^""`
    )
    expect(plan.display).toBe('legacy a b a"b x&y 50% a^b ')
  })

  it('fallback: o caminho do shim com espaços/parênteses é escapado e ComSpec ausente usa o padrão', () => {
    const env = { Path: 'C:\\Program Files (x86)\\Tool' }
    const probe = fakeFs({ 'C:\\Program Files (x86)\\Tool\\t.bat': 'echo %*' }, 'win32')
    const plan = planSpawn('t', ['ok'], env, { platform: 'win32', probe })
    expect(plan.file).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(plan.args).toBe(String.raw`/d /s /c "C:\Program^ Files^ ^(x86^)\Tool\t.bat ^^^"ok^^^""`)
  })

  it('fallback também para .cmd ilegível (readText null)', () => {
    const probe: FsProbe = { isFile: (p) => p === 'C:\\Tools\\x.cmd', readText: () => null }
    expect(planSpawn('x', [], WIN_ENV, { platform: 'win32', probe }).via).toBe('cmd')
  })

  it('comando inexistente lança CommandNotFoundError com o nome do comando', () => {
    const probe = fakeFs({}, 'win32')
    expect(() => planSpawn('nao-existe', [], WIN_ENV, { platform: 'win32', probe })).toThrow(CommandNotFoundError)
    try {
      planSpawn('nao-existe', [], WIN_ENV, { platform: 'win32', probe })
    } catch (err) {
      expect(err).toBeInstanceOf(CommandNotFoundError)
      expect((err as CommandNotFoundError).command).toBe('nao-existe')
      expect((err as Error).message).toBe('Comando não encontrado: nao-existe')
      expect((err as Error).name).toBe('CommandNotFoundError')
    }
  })
})

describe('planSpawn (linux)', () => {
  it('execução direta com argumentos em array; .cmd não tem significado especial', () => {
    const probe = fakeFs({ '/usr/bin/claude': '', '/usr/bin/tool.cmd': '@echo off' }, 'linux')
    expect(planSpawn('claude', ['--x', 'a b'], LINUX_ENV, { platform: 'linux', probe })).toEqual({
      file: '/usr/bin/claude',
      args: ['--x', 'a b'],
      display: 'claude --x a b',
      via: 'direct'
    })
    expect(planSpawn('tool.cmd', [], LINUX_ENV, { platform: 'linux', probe }).via).toBe('direct')
  })

  it('os argumentos do plano são uma cópia (mutar a entrada não altera o plano)', () => {
    const probe = fakeFs({ '/usr/bin/agent': '' }, 'linux')
    const args = ['a']
    const plan = planSpawn('agent', args, LINUX_ENV, { platform: 'linux', probe })
    args.push('b')
    expect(plan.args).toEqual(['a'])
  })

  it('comando inexistente lança CommandNotFoundError', () => {
    expect(() => planSpawn('nada', [], LINUX_ENV, { platform: 'linux', probe: fakeFs({}, 'linux') })).toThrow(
      'Comando não encontrado: nada'
    )
  })
})

// ------------------------------------------------------------------ Windows real (cmd.exe de verdade)

describe.runIf(process.platform === 'win32')('planSpawn no Windows real (cmd.exe e node de verdade)', () => {
  let dir = ''
  let env: Record<string, string> = {}

  /**
   * Executa o plano como o node-pty faria: com `args` string, a linha de comando é usada literalmente
   * e o executável vai entre aspas se tiver espaço (argsToCommandLine do node-pty).
   */
  function run(plan: SpawnPlan): string[] {
    const r =
      typeof plan.args === 'string'
        ? spawnSync(plan.file, [plan.args], {
            windowsVerbatimArguments: true,
            argv0: /\s/.test(plan.file) ? `"${plan.file}"` : plan.file,
            encoding: 'utf8',
            env
          })
        : spawnSync(plan.file, plan.args, { encoding: 'utf8', env })
    expect(r.error).toBeUndefined()
    return JSON.parse(r.stdout) as string[]
  }

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-resolve-'))
    fs.writeFileSync(path.join(dir, 'echoargs.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n')
    // Shim fora do formato do npm: força o fallback via cmd.exe.
    fs.writeFileSync(path.join(dir, 'legado.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0\\echoargs.js" %*\r\n`)
    // Shim no formato do npm (bin JS) apontando para node_modules\pkg\cli.js.
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
    fs.copyFileSync(path.join(dir, 'echoargs.js'), path.join(dir, 'node_modules', 'pkg', 'cli.js'))
    fs.writeFileSync(path.join(dir, 'agente.cmd'), NPM_JS_SHIM.replace('@anthropic-ai\\claude-code\\cli.js', 'pkg\\cli.js'))
    const base: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) base[k] = v
    const pathKey = Object.keys(base).find((k) => k.toLowerCase() === 'path') ?? 'Path'
    // node no PATH (para o shim npm sem node.exe local) e o diretório dos shims.
    base[pathKey] = [dir, path.dirname(process.execPath), base[pathKey] ?? ''].join(';')
    env = base
  })

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('execução direta: aspas nas pontas, barras, vazio e quebra de linha chegam intactos (sem injeção)', () => {
    const plan = planSpawn(process.execPath, [path.join(dir, 'echoargs.js'), ...TRICKY_ARGS], env, { platform: 'win32' })
    expect(plan.via).toBe('direct')
    expect(typeof plan.args).toBe('string')
    expect(run(plan)).toEqual(TRICKY_ARGS)
  })

  it('fallback cmd.exe: espaços, aspas, barras, &, %, ^, |, <> e vazio chegam intactos (sem injeção)', () => {
    const args = [
      ...TRICKY_ARGS.filter((a) => !/[\r\n]/.test(a)),
      '%%',
      'caret^aqui',
      'pipe|less',
      '<redir>',
      'a;b,c',
      'bang!'
    ]
    const plan = planSpawn('legado', args, env, { platform: 'win32' })
    expect(plan.via).toBe('cmd')
    expect(run(plan)).toEqual(args)
  })

  it('fallback cmd.exe: quebra de linha vira espaço e os argumentos seguintes são preservados', () => {
    const plan = planSpawn('legado', ['--append-system-prompt', 'linha 1\nlinha 2', '--allowedTools', 'Bash(orq *)'], env, {
      platform: 'win32'
    })
    expect(run(plan)).toEqual(['--append-system-prompt', 'linha 1 linha 2', '--allowedTools', 'Bash(orq *)'])
  })

  it('shim npm real: lê o .cmd, inicia o node com o script e preserva os argumentos', () => {
    const args = ['--x', 'com espaço', 'a"b', 'linha 1\nlinha 2', '', '" --flag "']
    const plan = planSpawn('agente', args, env, { platform: 'win32' })
    expect(plan.via).toBe('npm-shim')
    expect(path.basename(plan.file).toLowerCase()).toBe('node.exe')
    expect(run(plan)).toEqual(args)
  })
})
