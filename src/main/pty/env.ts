import * as path from 'node:path'
import { ENV } from '@shared/constants'

export interface TerminalEnvInput {
  base: Record<string, string>
  presetEnv: Record<string, string>
  binDir: string
  apiPort: number
  token: string
  terminalId: string
  terminalName: string
  workspaceDir: string
  nodeExe: string
  cliScript: string
}

/** Lê uma variável sem diferenciar maiúsculas (no Windows "Path" e "PATH" são a mesma). */
function findKey(env: Record<string, string>, key: string): string | undefined {
  return Object.keys(env).find((k) => k.toLowerCase() === key.toLowerCase())
}

/** Prefixa um diretório ao PATH, preservando o nome original da variável e sem duplicar. */
export function prependPath(env: Record<string, string>, dir: string, platform: NodeJS.Platform = process.platform): void {
  const sep = platform === 'win32' ? ';' : ':'
  const key = findKey(env, 'PATH') ?? 'PATH'
  const current = env[key] ?? ''
  const norm = (p: string): string => (platform === 'win32' ? path.win32.normalize(p).toLowerCase() : p)
  const parts = current.split(sep).filter((p) => p !== '' && norm(p) !== norm(dir))
  // Remove variações de caixa duplicadas no Windows (ex.: "Path" e "PATH").
  if (platform === 'win32') {
    for (const k of Object.keys(env)) if (k !== key && k.toLowerCase() === 'path') delete env[k]
  }
  env[key] = [dir, ...parts].join(sep)
}

/** Ambiente completo de um terminal: base + extras do preset + variáveis do CLI + PATH. */
export function buildTerminalEnv(input: TerminalEnvInput): Record<string, string> {
  const env: Record<string, string> = { ...input.base }
  for (const [k, v] of Object.entries(input.presetEnv)) {
    // No Windows os nomes não diferenciam maiúsculas: "PATH" do preset substitui o "Path" herdado.
    if (process.platform === 'win32') {
      for (const existing of Object.keys(env)) if (existing !== k && existing.toLowerCase() === k.toLowerCase()) delete env[existing]
    }
    env[k] = v
  }
  env[ENV.port] = String(input.apiPort)
  env[ENV.token] = input.token
  env[ENV.session] = input.token
  env[ENV.terminalId] = input.terminalId
  env[ENV.terminalName] = input.terminalName
  env[ENV.workspaceDir] = input.workspaceDir
  env[ENV.node] = input.nodeExe
  env[ENV.cli] = input.cliScript
  prependPath(env, input.binDir)
  return env
}
