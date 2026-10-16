import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  addedFileDiff,
  editedFiles,
  isAppFile,
  normalizePath,
  parseNumstatZ,
  parsePorcelainZ,
  parseUnifiedDiff,
  pathKey,
  type ChangedFile,
  type FileDiff
} from '@shared/changes'
import { parseCodexLine, parseTranscriptLine, type ChatItem, type ParseState } from '@shared/chat'
import type { TerminalNodeData } from '@shared/schemas'
import { git } from '../floors/git'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import type { WorkspaceStore } from '../store/WorkspaceStore'
import type { TerminalService } from '../terminals/TerminalService'
import { chatAgentFor, locateClaudeTranscript, readFrom } from '../chat/transcripts'
import { codexSessionFile } from '../terminals/sessions'
import { log } from '../util/log'

export interface RepoInfo {
  /** Raiz do repositório (como o git informa, com "/"). */
  root: string
  label: string
  branch: string
}

export interface ChangesDeps {
  workspaces: WorkspaceManager
  terminals: TerminalService
  /** Move para a lixeira do sistema (recuperável). */
  trash(file: string): Promise<void>
  env?: Record<string, string | undefined>
}

const WIN = process.platform === 'win32'
const MAX_FILES = 3000
const MAX_DIFF_BYTES = 4 * 1024 * 1024
const MAX_TEXT_FILE = 1024 * 1024
/** Quanto do fim de cada histórico de conversa é lido para saber quem editou o quê. */
const TRANSCRIPT_TAIL = 8 * 1024 * 1024

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  )
}

/** Caminho real (no Windows, nomes curtos 8.3 como ANA~1.SOU viram o nome longo), normalizado com "/". */
function canonical(p: string): string {
  try {
    return normalizePath(fs.realpathSync.native(p), p)
  } catch {
    return normalizePath(p, p)
  }
}

function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0)
}

/**
 * Mudanças nos repositórios do workspace (raiz do projeto, floors e pastas dos terminais): status, diff,
 * descartar (o conteúdo vai para a lixeira), commit e quem editou cada arquivo (pelos históricos dos
 * agentes). Só git local, sem shell; caminhos sempre conferidos contra o status atual.
 */
export class ChangesService {
  private readonly attributionCache = new Map<string, { size: number; mtimeMs: number; files: string[] }>()

  constructor(private readonly deps: ChangesDeps) {}

  private ws(dir: string): WorkspaceStore {
    const ws = this.deps.workspaces.get(dir)
    if (!ws) throw new Error('workspace não está aberto')
    return ws
  }

  private terminals(ws: WorkspaceStore): TerminalNodeData[] {
    return ws.doc.nodes.filter((n): n is TerminalNodeData => n.kind === 'terminal')
  }

  async repos(dir: string): Promise<RepoInfo[]> {
    const ws = this.ws(dir)
    const candidates: { dir: string; label: string }[] = [{ dir: ws.dir, label: ws.doc.name }]
    for (const f of ws.doc.floors) candidates.push({ dir: f.worktreePath, label: `floor ${f.name}` })
    for (const t of this.terminals(ws)) {
      try {
        candidates.push({ dir: this.deps.terminals.resolveCwd(t), label: t.name })
      } catch {
        // terminal de outro workspace / pasta sumiu
      }
    }
    const byRoot = new Map<string, { root: string; labels: string[]; branch: string }>()
    const seenDirs = new Set<string>()
    for (const c of candidates) {
      const k = pathKey(normalizePath(c.dir, c.dir), WIN)
      if (seenDirs.has(k) || !fs.existsSync(c.dir)) continue
      seenDirs.add(k)
      const top = await git(c.dir, ['rev-parse', '--show-toplevel'], 15_000)
      if (top.code !== 0) continue
      const root = canonical(top.stdout.trim())
      const rk = pathKey(root, WIN)
      const entry = byRoot.get(rk)
      if (entry) {
        if (!entry.labels.includes(c.label)) entry.labels.push(c.label)
        continue
      }
      const br = await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], 15_000)
      byRoot.set(rk, { root, labels: [c.label], branch: br.code === 0 ? br.stdout.trim() : 'HEAD destacado' })
    }
    return [...byRoot.values()].map((v) => ({
      root: v.root,
      label: v.labels[0]! + (v.labels.length > 1 ? ` (${v.labels.slice(1).join(', ')})` : ''),
      branch: v.branch
    }))
  }

  /** Raiz do repositório, conferindo que ele pertence ao workspace (o renderer não escolhe pastas arbitrárias). */
  async assertRoot(dir: string, root: string): Promise<string> {
    const repos = await this.repos(dir)
    const want = pathKey(normalizePath(root, root), WIN)
    const found = repos.find((r) => pathKey(r.root, WIN) === want)
    if (!found) throw new Error('repositório não pertence a este workspace')
    return found.root
  }

  private async hasHead(root: string): Promise<boolean> {
    return (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], 15_000)).code === 0
  }

  private async entries(root: string): Promise<ReturnType<typeof parsePorcelainZ>> {
    const st = await git(root, ['-c', 'core.quotepath=off', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], 60_000)
    if (st.code !== 0) throw new Error(`git status falhou: ${firstLine(st.stderr)}`)
    return parsePorcelainZ(st.stdout).filter((e) => !isAppFile(e.path))
  }

  async status(dir: string, rootRaw: string): Promise<{ branch: string; files: ChangedFile[]; truncated: boolean }> {
    const ws = this.ws(dir)
    const root = await this.assertRoot(dir, rootRaw)
    const all = await this.entries(root)
    const truncated = all.length > MAX_FILES
    const entries = all.slice(0, MAX_FILES)
    const head = await this.hasHead(root)
    const ns = await git(root, ['-c', 'core.quotepath=off', 'diff', '--numstat', '-z', ...(head ? ['HEAD'] : ['--cached'])], 60_000)
    const counts = ns.code === 0 ? parseNumstatZ(ns.stdout) : new Map()
    const who = this.attribution(ws)
    const files: ChangedFile[] = []
    for (const e of entries) {
      const abs = canonical(normalizePath(e.path, root))
      let c = counts.get(e.path) ?? { added: 0, deleted: 0, binary: false }
      if (e.kind === '?') c = await this.countUntracked(abs)
      files.push({ ...e, ...c, agents: [...(who.get(pathKey(abs, WIN)) ?? [])].sort((a, b) => a.localeCompare(b, 'pt-BR')) })
    }
    const br = await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], 15_000)
    return { branch: br.code === 0 ? br.stdout.trim() : 'HEAD destacado', files, truncated }
  }

  private async countUntracked(abs: string): Promise<{ added: number; deleted: number; binary: boolean }> {
    try {
      const st = await fsp.stat(abs)
      if (!st.isFile() || st.size > MAX_TEXT_FILE) return { added: 0, deleted: 0, binary: !st.isFile() }
      const buf = await fsp.readFile(abs)
      if (looksBinary(buf)) return { added: 0, deleted: 0, binary: true }
      const text = buf.toString('utf8')
      const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
      return { added: lines, deleted: 0, binary: false }
    } catch {
      return { added: 0, deleted: 0, binary: false }
    }
  }

  /** Quem editou cada arquivo (caminho absoluto normalizado -> nomes dos terminais), pelos históricos. */
  attribution(ws: WorkspaceStore): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>()
    const env = this.deps.env ?? process.env
    for (const node of this.terminals(ws)) {
      try {
        const preset = this.deps.terminals.presetFor(node)
        const agent = chatAgentFor(preset, node)
        if (!agent || !node.sessionId) continue
        const cwd = this.deps.terminals.resolveCwd(node)
        const file = agent === 'claude' ? locateClaudeTranscript(cwd, node.sessionId, env) : codexSessionFile(node.sessionId, env)
        if (!file) continue
        for (const f of this.editedIn(file, agent, cwd)) {
          const k = pathKey(canonical(f), WIN)
          let set = out.get(k)
          if (!set) out.set(k, (set = new Set()))
          set.add(node.name)
        }
      } catch {
        // histórico ilegível: sem atribuição para este agente
      }
    }
    return out
  }

  private editedIn(file: string, agent: 'claude' | 'codex', cwd: string): string[] {
    const st = fs.statSync(file)
    const cached = this.attributionCache.get(file)
    if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.files
    const chunk = readFrom(file, 0, TRANSCRIPT_TAIL)
    if (!chunk) return []
    const text = chunk.truncated ? chunk.text.slice(chunk.text.indexOf('\n') + 1) : chunk.text
    const tools: ParseState = new Map()
    const items: ChatItem[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const r = agent === 'claude' ? parseTranscriptLine(line, tools) : parseCodexLine(line, tools)
      for (const it of r.items) if (it.kind === 'tool') items.push(it)
    }
    const files = editedFiles(items as unknown as { kind: string; name?: string; detail?: string }[], cwd)
    this.attributionCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, files })
    return files
  }

  /** O caminho precisa estar entre as mudanças atuais (nada de caminhos arbitrários vindos da interface). */
  private async pick(root: string, paths: string[]): Promise<ReturnType<typeof parsePorcelainZ>> {
    const entries = await this.entries(root)
    const byPath = new Map(entries.map((e) => [e.path, e]))
    const picked = paths.map((p) => byPath.get(p))
    const missing = paths.filter((_, i) => !picked[i])
    if (missing.length) throw new Error(`O arquivo "${missing[0]}" não tem mais mudanças (atualize a lista).`)
    return picked as ReturnType<typeof parsePorcelainZ>
  }

  async diff(dir: string, rootRaw: string, file: string): Promise<FileDiff> {
    const root = await this.assertRoot(dir, rootRaw)
    const [entry] = await this.pick(root, [file])
    const abs = path.join(root, ...entry!.path.split('/'))
    if (entry!.kind === '?') {
      try {
        const st = await fsp.stat(abs)
        if (st.size > MAX_TEXT_FILE) return { path: file, hunks: [], binary: false, truncated: true }
        const buf = await fsp.readFile(abs)
        if (looksBinary(buf)) return { path: file, hunks: [], binary: true, truncated: false }
        return { path: file, binary: false, ...addedFileDiff(buf.toString('utf8')) }
      } catch {
        return { path: file, hunks: [], binary: false, truncated: false }
      }
    }
    const head = await this.hasHead(root)
    const specs = entry!.orig ? [entry!.orig, entry!.path] : [entry!.path]
    const r = await git(root, ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '-M', '-U3', ...(head ? ['HEAD'] : ['--cached']), '--', ...specs], 60_000)
    if (r.code !== 0) throw new Error(`git diff falhou: ${firstLine(r.stderr)}`)
    const text = r.stdout.length > MAX_DIFF_BYTES ? r.stdout.slice(0, MAX_DIFF_BYTES) : r.stdout
    const parsed = parseUnifiedDiff(text)
    return { path: file, ...parsed, truncated: parsed.truncated || r.stdout.length > MAX_DIFF_BYTES }
  }

  /**
   * Descarta as mudanças. Nada se perde de vez: arquivos novos vão para a lixeira e, de arquivos
   * modificados, uma cópia do conteúdo atual vai para a lixeira antes de voltar à versão do commit.
   */
  async discard(dir: string, rootRaw: string, paths: string[]): Promise<void> {
    const root = await this.assertRoot(dir, rootRaw)
    const entries = await this.pick(root, paths)
    const head = await this.hasHead(root)
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    for (const e of entries) {
      const abs = path.join(root, ...e.path.split('/'))
      if (e.kind === '?') {
        await this.deps.trash(abs)
        continue
      }
      if (e.kind === 'A' || !head) {
        await git(root, ['rm', '--cached', '-q', '--ignore-unmatch', '--', e.path], 30_000)
        if (fs.existsSync(abs)) await this.deps.trash(abs)
        continue
      }
      // Cópia do conteúdo atual para a lixeira (recuperável), depois volta à versão do último commit.
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const ext = path.extname(abs)
        const copy = path.join(os.tmpdir(), `${path.basename(abs, ext)} (descartado ${stamp})${ext}`)
        await fsp.copyFile(abs, copy)
        await this.deps.trash(copy)
      }
      if (e.kind === 'R' && e.orig) {
        const r = await git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', e.orig], 30_000)
        if (r.code !== 0) throw new Error(`git restore falhou: ${firstLine(r.stderr)}`)
        await git(root, ['rm', '--cached', '-q', '--ignore-unmatch', '--', e.path], 30_000)
        if (fs.existsSync(abs)) await fsp.rm(abs, { force: true })
        continue
      }
      const r = await git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', e.path], 30_000)
      if (r.code !== 0) throw new Error(`git restore falhou: ${firstLine(r.stderr)}`)
    }
    log.info('mudanças descartadas', { files: entries.length })
  }

  /** Commit só dos arquivos escolhidos (o resto do que estiver preparado fica de fora). */
  async commit(dir: string, rootRaw: string, paths: string[], message: string): Promise<{ hash: string }> {
    const root = await this.assertRoot(dir, rootRaw)
    const msg = message.trim()
    if (!msg) throw new Error('Escreva a mensagem do commit.')
    const entries = await this.pick(root, paths)
    const specs = [...new Set(entries.flatMap((e) => (e.orig ? [e.orig, e.path] : [e.path])))]
    const add = await git(root, ['add', '-A', '--', ...specs], 60_000)
    if (add.code !== 0) throw new Error(`git add falhou: ${firstLine(add.stderr)}`)
    const c = await git(root, ['commit', '-m', msg, '--', ...specs], 180_000)
    if (c.code !== 0) throw new Error(`O git recusou o commit: ${firstLine(c.stderr) || firstLine(c.stdout)}`)
    const h = await git(root, ['rev-parse', '--short', 'HEAD'], 15_000)
    log.info('commit feito pela revisão de mudanças', { files: specs.length })
    return { hash: h.stdout.trim() }
  }
}
