import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ProviderUsage, UsageReport } from '@shared/usage'
import { claudeUsageFromConfig, codexUsageFromTails } from './providers'

type Env = Record<string, string | undefined>

/** O ~/.claude.json costuma ter dezenas de KB; acima disto algo está errado e não vale ler. */
const CLAUDE_MAX_BYTES = 32 * 1024 * 1024
/** Quanto do fim de cada histórico do Codex é lido (o evento de limites vem a cada resposta). */
const CODEX_TAIL_BYTES = 256 * 1024
/** Históricos mais recentes considerados: um terminal retomado continua gravando num arquivo de dias atrás. */
const CODEX_FILES = 4
/** Pastas de dia percorridas (a janela semanal não precisa de mais que isso). */
const CODEX_DAYS = 14

/** Configuração global do Claude Code: <CLAUDE_CONFIG_DIR>/.claude.json ou ~/.claude.json. */
export function claudeConfigFile(env: Env = process.env): string {
  const dir = env['CLAUDE_CONFIG_DIR']?.trim()
  return dir ? path.join(dir, '.claude.json') : path.join(os.homedir(), '.claude.json')
}

export function codexSessionsDir(env: Env = process.env): string {
  return path.join(env['CODEX_HOME']?.trim() || path.join(os.homedir(), '.codex'), 'sessions')
}

/** Última leitura por arquivo/assinatura: arquivo igual não é lido de novo; leitura falha mantém a anterior. */
const cache = new Map<string, { key: string; usage: ProviderUsage | null }>()

async function readClaude(env: Env): Promise<ProviderUsage | null> {
  const file = claudeConfigFile(env)
  const prev = cache.get(file)
  try {
    const st = await fsp.stat(file)
    if (!st.isFile() || st.size > CLAUDE_MAX_BYTES) return null
    const key = `${st.mtimeMs}:${st.size}`
    if (prev?.key === key) return prev.usage
    // O Claude Code reescreve o arquivo com frequência; uma leitura no meio da escrita falha no JSON.parse.
    const usage = claudeUsageFromConfig(JSON.parse(await fsp.readFile(file, 'utf8')))
    cache.set(file, { key, usage })
    return usage
  } catch {
    return prev?.usage ?? null
  }
}

async function numericDirs(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => Number(b) - Number(a))
}

/** Históricos do Codex modificados por último (sessions/AAAA/MM/DD/rollout-*.jsonl). */
async function recentCodexFiles(root: string): Promise<{ file: string; mtimeMs: number; size: number }[]> {
  const days: string[] = []
  collect: for (const y of await numericDirs(root)) {
    for (const m of await numericDirs(path.join(root, y))) {
      for (const d of await numericDirs(path.join(root, y, m))) {
        days.push(path.join(root, y, m, d))
        if (days.length >= CODEX_DAYS) break collect
      }
    }
  }
  const files: { file: string; mtimeMs: number; size: number }[] = []
  for (const day of days) {
    for (const e of await fsp.readdir(day, { withFileTypes: true }).catch(() => [])) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
      const file = path.join(day, e.name)
      const st = await fsp.stat(file).catch(() => null)
      if (st) files.push({ file, mtimeMs: st.mtimeMs, size: st.size })
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, CODEX_FILES)
}

async function readTail(file: string, size: number): Promise<string> {
  const fh = await fsp.open(file, 'r')
  try {
    const len = Math.min(size, CODEX_TAIL_BYTES)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

async function readCodex(env: Env): Promise<ProviderUsage | null> {
  const root = codexSessionsDir(env)
  const prev = cache.get(root)
  try {
    const files = await recentCodexFiles(root)
    if (files.length === 0) return null
    const key = files.map((f) => `${f.file}:${f.mtimeMs}:${f.size}`).join('|')
    if (prev?.key === key) return prev.usage
    const usage = codexUsageFromTails(await Promise.all(files.map((f) => readTail(f.file, f.size))))
    cache.set(root, { key, usage })
    return usage
  } catch {
    return prev?.usage ?? null
  }
}

/**
 * Uso da assinatura de cada agente encontrado neste computador. Só lê o que os próprios agentes já
 * guardam (Claude Code: cache do /usage no ~/.claude.json; Codex: eventos de limite nos históricos);
 * nada vai para a rede e nenhum token é lido.
 */
export async function readSubscriptionUsage(env: Env = process.env): Promise<UsageReport> {
  const providers = await Promise.all([readClaude(env), readCodex(env)])
  return { providers: providers.filter((p): p is ProviderUsage => p !== null) }
}
