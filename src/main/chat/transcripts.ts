import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { codexSessionMeta, type ChatAgent } from '@shared/chat'
import type { AgentPreset, TerminalNodeData } from '@shared/schemas'
import { encodeClaudeProjectDir } from '../terminals/sessions'

/**
 * Onde cada agente grava o histórico da sessão. Usado pelo chat e pelo escritório.
 * - Claude Code: `<CLAUDE_CONFIG_DIR ou ~/.claude>/projects/<cwd codificado>/<sessão>.jsonl`
 * - Codex: `<CODEX_HOME ou ~/.codex>/sessions/AAAA/MM/DD/rollout-*.jsonl` (criado na primeira mensagem)
 */

/** Qual histórico sabemos ler para este preset. */
export function chatAgentFor(preset: AgentPreset, node: TerminalNodeData): ChatAgent | null {
  if (preset.sessionStore === 'claude' && node.sessionId) return 'claude'
  if (preset.id === 'codex' || /(^|[\\/])codex(\.cmd|\.exe|\.ps1)?$/i.test(preset.command.trim())) return 'codex'
  return null
}

export function locateClaudeTranscript(cwd: string, sessionId: string, env: Record<string, string | undefined>): string | null {
  const base = env['CLAUDE_CONFIG_DIR']?.trim() || path.join(os.homedir(), '.claude')
  const encoded = encodeClaudeProjectDir(path.resolve(cwd))
  // No Windows a letra do drive pode vir em maiúscula ou minúscula.
  const dirs = new Set([encoded, encoded.charAt(0).toLowerCase() + encoded.slice(1), encoded.charAt(0).toUpperCase() + encoded.slice(1)])
  return [...dirs].map((d) => path.join(base, 'projects', d, `${sessionId}.jsonl`)).find((f) => fs.existsSync(f)) ?? null
}

/**
 * O Codex não deixa escolher o id da sessão: o histórico do terminal é o primeiro criado depois que o
 * processo iniciou, na mesma pasta, e que não esteja em uso por outro leitor (`claimed`).
 */
export function locateCodexTranscript(
  cwd: string,
  startedAt: number,
  claimed: Set<string | null>,
  env: Record<string, string | undefined>,
  now = Date.now()
): string | null {
  const target = normalizePath(cwd)
  const home = env['CODEX_HOME']?.trim() || path.join(os.homedir(), '.codex')
  const days = new Set([dayDir(startedAt || now), dayDir(now)])
  let best: { file: string; startedAt: number } | null = null
  for (const day of days) {
    const dir = path.join(home, 'sessions', day)
    let names: string[]
    try {
      names = fs.readdirSync(dir).filter((n) => n.startsWith('rollout-') && n.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const name of names) {
      const file = path.join(dir, name)
      if (claimed.has(file)) continue
      try {
        if (fs.statSync(file).mtimeMs < startedAt - 2000) continue
      } catch {
        continue
      }
      const meta = codexSessionMeta(readFirstLine(file))
      if (!meta || normalizePath(meta.cwd) !== target || meta.startedAt < startedAt - 5000) continue
      if (!best || meta.startedAt < best.startedAt) best = { file, startedAt: meta.startedAt }
    }
  }
  return best?.file ?? null
}

function normalizePath(p: string): string {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase()
}

/** Pasta do dia no formato do Codex (AAAA/MM/DD, horário local). */
function dayDir(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return path.join(String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()))
}

/** Primeira linha de um arquivo (o session_meta do Codex pode ter dezenas de KB). */
export function readFirstLine(file: string): string {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const chunks: Buffer[] = []
    let pos = 0
    while (pos < 2 * 1024 * 1024) {
      const buf = Buffer.alloc(64 * 1024)
      const n = fs.readSync(fd, buf, 0, buf.length, pos)
      if (n <= 0) break
      const slice = buf.subarray(0, n)
      const nl = slice.indexOf(10)
      if (nl >= 0) {
        chunks.push(slice.subarray(0, nl))
        break
      }
      chunks.push(slice)
      pos += n
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/** Lê o arquivo de `offset` até o fim (ou só o final, se for grande demais). */
export function readFrom(file: string, offset: number, maxBytes: number): { text: string; size: number; truncated: boolean } | null {
  let fd: number | null = null
  try {
    const size = fs.statSync(file).size
    if (size <= offset) return { text: '', size, truncated: false }
    const start = Math.max(offset, size - maxBytes)
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    return { text: buf.toString('utf8'), size, truncated: start > offset }
  } catch {
    return null
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}
