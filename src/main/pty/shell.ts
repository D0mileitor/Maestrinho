import { findExecutable } from './resolveCommand'

/** Shell padrão da plataforma: PowerShell 7 (pwsh) se instalado, senão Windows PowerShell; no Linux, $SHELL. */
export function defaultShell(env: Record<string, string | undefined> = process.env): {
  command: string
  args: string[]
} {
  if (process.platform === 'win32') {
    if (findExecutable('pwsh.exe', env)) return { command: 'pwsh.exe', args: ['-NoLogo'] }
    return { command: 'powershell.exe', args: ['-NoLogo'] }
  }
  const sh = env['SHELL'] && env['SHELL'].trim() !== '' ? env['SHELL'] : '/bin/bash'
  return { command: sh, args: ['-l'] }
}

/**
 * Marcadores de sessão de um Claude Code/VS Code "pai" (quando o app é aberto de dentro deles).
 * Herdados, fariam o agente se comportar como sessão filha (ex.: sem salvar transcript, o que quebra
 * a retomada) e vazariam tokens de mensageria da sessão pai. Configurações do usuário
 * (CLAUDE_CONFIG_DIR, CLAUDE_CODE_GIT_BASH_PATH, ANTHROPIC_*, CLAUDE_CODE_USE_BEDROCK...) são mantidas.
 */
const PARENT_SESSION_VARS =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_AGENT_SDK_.*|CLAUDE_CODE_(ENTRYPOINT|CHILD_SESSION|EXECPATH|SSE_PORT|EMIT_STARTUP_TIMING|ENABLE_SDK_FILE_CHECKPOINTING|ENABLE_TASKS|MESSAGING_.*|SESSION_.*)|MCP_CONNECTION_NONBLOCKING|VSCODE_.*)$/i

/** Copia o ambiente do processo, removendo variáveis que não devem vazar para os terminais. */
export function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    // Variáveis internas do Electron/Vite que mudariam o comportamento de processos filhos.
    if (/^(ELECTRON_|VITE_|MAIN_VITE_|NODE_OPTIONS$|ORQ_)/i.test(k)) continue
    if (k === 'ELECTRON_RENDERER_URL') continue
    if (PARENT_SESSION_VARS.test(k)) continue
    env[k] = v
  }
  env['TERM'] = 'xterm-256color'
  env['COLORTERM'] = 'truecolor'
  return env
}
