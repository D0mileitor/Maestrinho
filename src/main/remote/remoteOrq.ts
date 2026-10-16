import { APP_NAME, CLI_NAME, ENV } from '@shared/constants'

/**
 * `orq` em servidores remotos (terminais SSH). O terminal SSH é aberto com um túnel reverso
 * (`ssh -R 127.0.0.1:<porta remota>:127.0.0.1:<porta da API>`); no servidor, um script POSIX que só
 * precisa de `curl` envia os argumentos para POST /v1/cli e imprime a saída. Nenhum segredo vai para
 * o arquivo: porta e token ficam só em variáveis da sessão.
 */

export const REMOTE_BIN = '$HOME/.maestrinho/bin'

export function remoteOrqScript(): string {
  return [
    '#!/bin/sh',
    `# ${CLI_NAME} remoto do ${APP_NAME} (gerado automaticamente; não edite). Requer curl.`,
    `if [ -z "$${ENV.port}" ] || [ -z "$${ENV.token}" ]; then`,
    `  echo "${CLI_NAME}: este comando só funciona numa sessão SSH aberta pelo ${APP_NAME}." >&2`,
    '  exit 2',
    'fi',
    `command -v curl >/dev/null 2>&1 || { echo "${CLI_NAME}: o curl é necessário neste servidor." >&2; exit 1; }`,
    '[ "$#" -eq 0 ] && set -- --help',
    'hdr=$(mktemp 2>/dev/null || echo "/tmp/orq.$$.hdr")',
    'n=$#',
    'use_stdin=0',
    'for a in "$@"; do',
    '  [ "$a" = "-" ] && use_stdin=1',
    '  set -- "$@" --data-urlencode "a=$a"',
    'done',
    'shift "$n"',
    '[ "$use_stdin" = 1 ] && set -- "$@" --data-urlencode "stdin@-"',
    `curl -sS --noproxy '*' -D "$hdr" -H "Authorization: Bearer $${ENV.token}" "$@" "http://127.0.0.1:$${ENV.port}/v1/cli"`,
    'rc=$?',
    "code=$(sed -n 's/^[Xx]-[Oo]rq-[Ee]xit: *\\([0-9][0-9]*\\).*/\\1/p' \"$hdr\" | tail -n 1)",
    'rm -f "$hdr"',
    `[ "$rc" -ne 0 ] && { echo "${CLI_NAME}: não consegui falar com o ${APP_NAME} pelo túnel SSH (porta $${ENV.port})." >&2; exit 1; }`,
    'exit "${code:-1}"',
    ''
  ].join('\n')
}

function shQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`
}

/**
 * Texto digitado no shell remoto para instalar o script e exportar as variáveis. As linhas começam
 * com espaço (fora do histórico com HISTCONTROL=ignorespace, padrão em muitas distros) e o `clear`
 * final limpa a tela e o histórico de rolagem do terminal. Requer shell POSIX (bash, zsh, sh).
 * O texto não contém "!": o shebang sai de `printf '\041'`, porque shells interativos (zsh, bash)
 * podem tratar "!" como expansão de histórico mesmo dentro do here-doc.
 */
export function remoteBootstrap(opts: { port: number; token: string; terminalId: string; terminalName: string }): string {
  const marker = 'MAESTRINHO_ORQ_EOF'
  const [shebang, ...body] = remoteOrqScript().trimEnd().split('\n')
  if (shebang !== '#!/bin/sh') throw new Error('script remoto sem shebang esperado')
  return [
    ` mkdir -p "${REMOTE_BIN}" && { printf '#\\041/bin/sh\\n'; cat; } > "${REMOTE_BIN}/${CLI_NAME}" <<'${marker}'`,
    ...body,
    marker,
    ` chmod +x "${REMOTE_BIN}/${CLI_NAME}"; export ${ENV.port}=${opts.port} ${ENV.token}=${shQuote(opts.token)} ` +
      `${ENV.terminalId}=${shQuote(opts.terminalId)} ${ENV.terminalName}=${shQuote(opts.terminalName)} ` +
      `PATH="${REMOTE_BIN}:$PATH"; clear; echo "${CLI_NAME} ativo nesta sessão remota (experimente: ${CLI_NAME} whoami)"`
  ].join('\n')
}

/**
 * A tela termina num prompt de shell (e não num pedido de senha/confirmação)? Só então o bootstrap é
 * digitado — senão o texto (com o token) poderia ir parar num campo de senha.
 */
export function looksLikeShellPrompt(screen: string): boolean {
  if (looksLikeSecretPrompt(screen)) return false
  const last = nonEmptyLines(screen).at(-1) ?? ''
  return /[$#%>]$/.test(last) && last.length < 300
}

/**
 * As últimas `lines` linhas da tela pedem senha, frase-senha, código ou confirmação (sim/não)? O
 * automático olha 4 linhas (conservador); o pedido manual, só a linha do cursor (um aviso sobre senha
 * no banner de login não pode bloqueá-lo).
 */
export function looksLikeSecretPrompt(screen: string, lines = 4): boolean {
  const tail = nonEmptyLines(screen).slice(-lines).join('\n')
  return /password|senha|passphrase|yes\/no|fingerprint|verification code|\(y\/n\)|\[y\/n\]|otp|token:/i.test(tail)
}

function nonEmptyLines(screen: string): string[] {
  return screen
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
}
