import { execFile } from 'node:child_process'

/** Execução de git sem shell (argumentos nunca passam por interpretação de shell). */

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

/** `env` acrescenta variáveis (ex.: GIT_INDEX_FILE para trabalhar num índice temporário). */
export function git(cwd: string, args: string[], timeoutMs = 60_000, env: Record<string, string> = {}): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', ...env }
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const r = await git(dir, ['rev-parse', '--is-inside-work-tree'], 15_000)
  return r.code === 0 && r.stdout.trim() === 'true'
}

export async function currentBranch(dir: string): Promise<string> {
  const r = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], 15_000)
  return r.code === 0 ? r.stdout.trim() : ''
}

export async function listBranches(dir: string): Promise<string[]> {
  const r = await git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], 15_000)
  if (r.code !== 0) return []
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function branchExists(dir: string, branch: string): Promise<boolean> {
  const r = await git(dir, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], 15_000)
  return r.code === 0
}

/** Nome de branch seguro: só [a-z0-9-], sem começar/terminar com "-". */
export function branchSlug(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'floor'
}
