/**
 * Revisão das mudanças dos agentes (lógica pura): interpreta a saída do git (status, numstat e diff) e
 * descobre, pelos históricos das conversas, quais arquivos cada agente editou.
 */

/** M modificado, A novo (no índice), D apagado, R renomeado, ? novo (fora do git), U conflito. */
export type ChangeKind = 'M' | 'A' | 'D' | 'R' | '?' | 'U'

export interface ChangedFile {
  /** Caminho relativo à raiz do repositório, com "/". */
  path: string
  /** Caminho anterior (renomeado). */
  orig?: string
  kind: ChangeKind
  /** Há mudança já preparada (staged) para o commit. */
  staged: boolean
  added: number
  deleted: number
  binary: boolean
  /** Agentes que editaram este arquivo (pelos históricos das conversas). */
  agents: string[]
}

export interface DiffLine {
  type: 'ctx' | 'add' | 'del'
  text: string
  /** Número da linha no arquivo antigo / novo. */
  old?: number
  new?: number
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  hunks: DiffHunk[]
  binary: boolean
  /** Diff cortado (grande demais para mostrar inteiro). */
  truncated: boolean
}

/**
 * Arquivos do próprio app no repositório (workspace, notas, quadro; skill do orq gerada enquanto o terminal
 * roda): não são mudança do projeto e ficam fora da revisão.
 */
export function isAppFile(path: string): boolean {
  return path === '.maestrinho' || path.startsWith('.maestrinho/') || path.startsWith('.claude/skills/orq/')
}

/** Saída de `git status --porcelain=v1 -z --untracked-files=all`. */
export function parsePorcelainZ(out: string): Omit<ChangedFile, 'added' | 'deleted' | 'binary' | 'agents'>[] {
  const parts = out.split('\0')
  const files: Omit<ChangedFile, 'added' | 'deleted' | 'binary' | 'agents'>[] = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!
    if (entry.length < 4) continue
    const x = entry[0]!
    const y = entry[1]!
    const path = entry.slice(3)
    if (x === '!') continue
    let kind: ChangeKind
    if (x === '?' && y === '?') kind = '?'
    else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) kind = 'U'
    else if (x === 'R' || y === 'R' || x === 'C') kind = 'R'
    else if (x === 'A') kind = 'A'
    else if (x === 'D' || y === 'D') kind = 'D'
    else kind = 'M'
    const file: Omit<ChangedFile, 'added' | 'deleted' | 'binary' | 'agents'> = { path, kind, staged: x !== ' ' && x !== '?' }
    // Renomeação: o caminho antigo vem na entrada seguinte.
    if (x === 'R' || x === 'C') {
      file.orig = parts[i + 1]
      i++
    }
    files.push(file)
  }
  return files
}

/** Saída de `git diff --numstat -z`: linhas adicionadas/removidas por arquivo ("-" = binário). */
export function parseNumstatZ(out: string): Map<string, { added: number; deleted: number; binary: boolean }> {
  const map = new Map<string, { added: number; deleted: number; binary: boolean }>()
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i]!)
    if (!m) continue
    let path = m[3]!
    // Renomeação no formato -z: "a\tb\t" seguido de origem e destino em entradas separadas.
    if (path === '') {
      path = parts[i + 2] ?? ''
      i += 2
    }
    const binary = m[1] === '-' || m[2] === '-'
    map.set(path, { added: binary ? 0 : Number(m[1]), deleted: binary ? 0 : Number(m[2]), binary })
  }
  return map
}

/** Diff unificado de um arquivo em blocos com os números de linha (sem o cabeçalho "diff --git"). */
export function parseUnifiedDiff(text: string, maxLines = 4000): { hunks: DiffHunk[]; binary: boolean; truncated: boolean } {
  const hunks: DiffHunk[] = []
  let cur: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  let count = 0
  let binary = false
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      binary = true
      continue
    }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
    if (h) {
      cur = { header: line, lines: [] }
      hunks.push(cur)
      oldNo = Number(h[1])
      newNo = Number(h[2])
      continue
    }
    if (!cur) continue
    if (count >= maxLines) return { hunks, binary, truncated: true }
    if (line.startsWith('+')) {
      cur.lines.push({ type: 'add', text: line.slice(1), new: newNo++ })
      count++
    } else if (line.startsWith('-')) {
      cur.lines.push({ type: 'del', text: line.slice(1), old: oldNo++ })
      count++
    } else if (line.startsWith(' ')) {
      cur.lines.push({ type: 'ctx', text: line.slice(1), old: oldNo++, new: newNo++ })
      count++
    }
    // "\ No newline at end of file" e linhas vazias de fim de saída são ignoradas.
  }
  return { hunks, binary, truncated: false }
}

/** Arquivo novo (fora do git) mostrado como diff: tudo adicionado. */
export function addedFileDiff(content: string, maxLines = 4000): { hunks: DiffHunk[]; truncated: boolean } {
  const all = content.replace(/\r\n/g, '\n').split('\n')
  if (all.length > 0 && all[all.length - 1] === '') all.pop()
  const shown = all.slice(0, maxLines)
  return {
    hunks: shown.length ? [{ header: `@@ -0,0 +1,${all.length} @@`, lines: shown.map((text, i) => ({ type: 'add' as const, text, new: i + 1 })) }] : [],
    truncated: all.length > maxLines
  }
}

/** Ferramentas que editam arquivos (Claude Code e Codex). */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch'])

/**
 * Arquivos editados segundo os itens do histórico de uma conversa (ferramentas de edição), como caminhos
 * absolutos normalizados com "/". `cwd` resolve os caminhos relativos (apply_patch do Codex).
 */
export function editedFiles(items: readonly { kind: string; name?: string; detail?: string }[], cwd: string): string[] {
  const out = new Set<string>()
  for (const it of items) {
    if (it.kind !== 'tool' || !it.name || !EDIT_TOOLS.has(it.name) || !it.detail) continue
    for (const raw of it.detail.split('\n')) {
      const p = raw.trim()
      if (!p) continue
      out.add(normalizePath(p, cwd))
    }
  }
  return [...out]
}

/** Caminho absoluto com "/" e sem "." ou ".."; relativo é resolvido contra `base`. */
export function normalizePath(p: string, base: string): string {
  const slash = (s: string): string => s.replace(/\\/g, '/')
  const isAbs = /^([a-zA-Z]:\/|\/)/.test(slash(p))
  const full = isAbs ? slash(p) : `${slash(base).replace(/\/+$/, '')}/${slash(p)}`
  const drive = /^[a-zA-Z]:/.exec(full)?.[0] ?? ''
  const rest = full.slice(drive.length)
  const parts: string[] = []
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return `${drive.toUpperCase()}/${parts.join('/')}`
}

/** Chave de comparação de caminhos (Windows não diferencia maiúsculas). */
export function pathKey(p: string, windows: boolean): string {
  return windows ? p.toLowerCase() : p
}
