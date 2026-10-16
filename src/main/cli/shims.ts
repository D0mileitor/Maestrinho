import * as fs from 'node:fs'
import * as path from 'node:path'
import { APP_NAME, CLI_NAME, ENV } from '@shared/constants'

/**
 * Shims do CLI, gerados em <userData>/bin a cada inicialização (conteúdo fixo, sem caminhos
 * absolutos): o executável e o script do CLI chegam por variáveis de ambiente do terminal.
 *  - `orq`     : shell POSIX (Git Bash — usado pelo Claude Code no Windows —, WSL, Linux)
 *  - `orq.cmd` : cmd.exe / PowerShell
 * O CLI roda no próprio Electron em modo Node (ELECTRON_RUN_AS_NODE=1): não exige Node instalado.
 */

export function posixShim(): string {
  return [
    '#!/bin/sh',
    `# Shim do CLI do ${APP_NAME} (gerado automaticamente; não edite).`,
    `if [ -z "$${ENV.node}" ] || [ -z "$${ENV.cli}" ]; then`,
    `  echo "${CLI_NAME}: este comando só funciona dentro de um terminal do ${APP_NAME}." >&2`,
    '  exit 2',
    'fi',
    `node_bin="$${ENV.node}"`,
    // No Git Bash/MSYS, converte C:\\... para /c/... para poder executar o .exe.
    'if command -v cygpath >/dev/null 2>&1; then node_bin=$(cygpath -u "$node_bin"); fi',
    // MSYS_NO_PATHCONV evita que argumentos como "/revisar" virem caminhos do Windows.
    `ELECTRON_RUN_AS_NODE=1 MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' exec "$node_bin" "$${ENV.cli}" "$@"`,
    ''
  ].join('\n')
}

export function cmdShim(): string {
  return [
    '@echo off',
    `rem Shim do CLI do ${APP_NAME} (gerado automaticamente; nao edite).`,
    'setlocal',
    `if not defined ${ENV.node} (`,
    `  echo ${CLI_NAME}: este comando so funciona dentro de um terminal do ${APP_NAME}. 1>&2`,
    '  exit /b 2',
    ')',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"%${ENV.node}%" "%${ENV.cli}%" %*`,
    'exit /b %ERRORLEVEL%',
    ''
  ].join('\r\n')
}

function writeIfChanged(file: string, content: string, mode?: number): void {
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
      if (mode !== undefined) fs.chmodSync(file, mode)
      return
    }
  } catch {
    // reescreve
  }
  fs.writeFileSync(file, content, { encoding: 'utf8', mode })
  if (mode !== undefined) fs.chmodSync(file, mode)
}

/** Gera os shims e devolve o diretório a ser prefixado no PATH dos terminais. */
export function installShims(userDataDir: string): string {
  const binDir = path.join(userDataDir, 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  writeIfChanged(path.join(binDir, CLI_NAME), posixShim(), 0o755)
  writeIfChanged(path.join(binDir, `${CLI_NAME}.cmd`), cmdShim())
  return binDir
}
