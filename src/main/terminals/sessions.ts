import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Retomada de sessão de agentes. Hoje só o Claude Code permite escolher o id da sessão ao iniciar
 * (`--session-id <uuid>`) e retomá-la depois (`--resume <uuid>`).
 *
 * O Claude Code guarda cada sessão em `<CLAUDE_CONFIG_DIR ou ~/.claude>/projects/<cwd codificado>/<id>.jsonl`,
 * onde o cwd codificado troca todo caractere não alfanumérico por "-"
 * (ex.: C:\Users\ana\proj → C--Users-ana-proj). Se esse formato mudar, a verificação falha de forma
 * segura: o terminal só inicia uma sessão nova.
 */
export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function claudeSessionExists(
  cwd: string,
  sessionId: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return false
  const base = env['CLAUDE_CONFIG_DIR']?.trim() || path.join(os.homedir(), '.claude')
  const encoded = encodeClaudeProjectDir(path.resolve(cwd))
  // No Windows a letra do drive pode vir em maiúscula ou minúscula (o sistema de arquivos ignora caixa).
  const candidates = new Set([encoded, encoded.charAt(0).toLowerCase() + encoded.slice(1), encoded.charAt(0).toUpperCase() + encoded.slice(1)])
  for (const dir of candidates) {
    try {
      if (fs.statSync(path.join(base, 'projects', dir, `${sessionId}.jsonl`)).isFile()) return true
    } catch {
      // tenta o próximo
    }
  }
  return false
}

/**
 * Codex: não dá para escolher o id ao iniciar, mas dá para retomar com `codex resume <id>`. O id é
 * descoberto depois (o histórico `<CODEX_HOME ou ~/.codex>/sessions/AAAA/MM/DD/rollout-<data>-<id>.jsonl`
 * é criado na primeira mensagem) e guardado no nó. Ao retomar, o Codex continua gravando no mesmo arquivo,
 * então o histórico de um terminal é achado pelo id, procurando dos dias mais recentes para os antigos.
 */
const codexFiles = new Map<string, string>()

export function codexSessionFile(sessionId: string, env: Record<string, string | undefined> = process.env): string | null {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null
  const cached = codexFiles.get(sessionId)
  if (cached && fs.existsSync(cached)) return cached
  const root = path.join(env['CODEX_HOME']?.trim() || path.join(os.homedir(), '.codex'), 'sessions')
  const suffix = `-${sessionId.toLowerCase()}.jsonl`
  const sortedDirs = (dir: string): string[] => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
        .map((e) => e.name)
        .sort((a, b) => Number(b) - Number(a))
    } catch {
      return []
    }
  }
  for (const y of sortedDirs(root)) {
    for (const m of sortedDirs(path.join(root, y))) {
      for (const d of sortedDirs(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d)
        let names: string[]
        try {
          names = fs.readdirSync(dir)
        } catch {
          continue
        }
        const hit = names.find((n) => n.startsWith('rollout-') && n.toLowerCase().endsWith(suffix))
        if (hit) {
          const file = path.join(dir, hit)
          codexFiles.set(sessionId, file)
          return file
        }
      }
    }
  }
  return null
}
