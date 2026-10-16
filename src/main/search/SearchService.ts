import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { multiTermScore, normalize } from '@shared/fuzzy'
import type { SearchResult } from '@shared/ipc'
import type { ConfigStore } from '../store/ConfigStore'
import type { WorkspaceManager } from '../store/WorkspaceManager'

const MAX_NOTE_BYTES = 256 * 1024
const MAX_RESULTS = 60

/**
 * Busca global (paleta Ctrl+K): nós de todos os workspaces abertos (inclusive outros floors),
 * corpo das notas e a lista de workspaces. Sem acento e sem diferenciar maiúsculas; o nome vale
 * mais que o corpo; o workspace ativo ganha um bônus.
 */
export class SearchService {
  private readonly noteCache = new Map<string, { mtimeMs: number; text: string }>()

  constructor(
    private readonly deps: {
      workspaces: WorkspaceManager
      config: ConfigStore
      /** Linhas da saída dos terminais que contêm o texto (ver PtyManager.searchOutput). */
      searchOutput?(query: string): { id: string; text: string; line: number }[]
    }
  ) {}

  private async noteText(file: string): Promise<string> {
    try {
      const st = await fsp.stat(file)
      const cached = this.noteCache.get(file)
      if (cached && cached.mtimeMs === st.mtimeMs) return cached.text
      const handle = await fsp.open(file, 'r')
      try {
        const buf = Buffer.alloc(Math.min(st.size, MAX_NOTE_BYTES))
        await handle.read(buf, 0, buf.length, 0)
        const text = buf.toString('utf8')
        this.noteCache.set(file, { mtimeMs: st.mtimeMs, text })
        return text
      } finally {
        await handle.close()
      }
    } catch {
      return ''
    }
  }

  async query(q: string): Promise<SearchResult[]> {
    const query = q.trim()
    if (!query) return []
    const out: SearchResult[] = []
    const active = this.deps.workspaces.active
    const presets = new Map(this.deps.config.presets.map((p) => [p.id, p.label]))
    const roles = new Map(this.deps.config.roles.map((r) => [r.id, r.name]))

    for (const ws of this.deps.workspaces.all()) {
      const boost = ws === active ? 5 : 0
      const floorName = (id?: string): string =>
        id ? (ws.doc.floors.find((f) => f.id === id)?.name ?? 'floor') : 'térreo'
      for (const n of ws.doc.nodes) {
        let label = ''
        let fields: string[] = []
        let detail = ''
        let snippet = ''
        if (n.kind === 'terminal') {
          const preset = presets.get(n.presetId) ?? n.presetId
          const role = n.roleId ? (roles.get(n.roleId) ?? '') : ''
          label = n.name
          fields = [n.name, 'terminal', preset, role, ws.doc.name]
          detail = [preset, role, ws.doc.name, floorName(n.floorId)].filter(Boolean).join(', ')
        } else if (n.kind === 'note') {
          label = n.file
          const body = await this.noteText(path.join(ws.notesDir, n.file))
          fields = [n.file, 'nota', ws.doc.name, body]
          detail = `nota, ${ws.doc.name}, ${floorName(n.floorId)}`
          snippet = snippetOf(body, query)
        } else if (n.kind === 'portal') {
          label = n.title || n.url
          fields = [label, 'portal', n.url, ws.doc.name]
          detail = `portal, ${n.url}`
        } else if (n.kind === 'shape') {
          if (!n.text.trim()) continue
          label = n.text.split('\n')[0]!.slice(0, 80)
          fields = [n.text, 'texto', ws.doc.name]
          detail = `texto, ${ws.doc.name}`
        }
        const r = multiTermScore(query, fields)
        if (r.score < 0) continue
        out.push({
          kind: n.kind,
          id: n.id,
          label,
          detail: snippet ? `${detail} — ${snippet}` : detail,
          dir: ws.dir,
          floorId: n.floorId,
          score: r.score + boost
        })
      }
    }

    for (const item of this.deps.workspaces.list()) {
      if (!item.exists) continue
      const r = multiTermScore(query, [item.name, 'workspace', item.dir])
      if (r.score < 0) continue
      out.push({ kind: 'workspace', id: item.dir, label: item.name, detail: item.dir, dir: item.dir, score: r.score })
    }

    out.push(...this.outputResults(query))
    return out.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS)
  }

  /** Trechos da saída dos terminais (a partir de 3 letras): abaixo dos nomes, os mais recentes primeiro. */
  private outputResults(query: string): SearchResult[] {
    if (normalize(query).length < 3 || !this.deps.searchOutput) return []
    const out: SearchResult[] = []
    const matches = this.deps.searchOutput(query)
    matches.forEach((m, i) => {
      for (const ws of this.deps.workspaces.all()) {
        const node = ws.doc.nodes.find((n) => n.id === m.id)
        if (!node || node.kind !== 'terminal') continue
        out.push({
          kind: 'output',
          id: `${m.id}#${m.line}`,
          terminalId: m.id,
          line: m.line,
          label: node.name,
          detail: snippetOf(m.text, query) || m.text.slice(0, 120),
          dir: ws.dir,
          floorId: node.floorId,
          score: 1 - i / (matches.length + 1)
        })
      }
    })
    return out
  }
}

/** Trecho do corpo em volta da primeira palavra da busca encontrada. */
function snippetOf(body: string, query: string): string {
  const first = normalize(query.split(/\s+/)[0] ?? '')
  if (!first) return ''
  const norm = normalize(body)
  const idx = norm.indexOf(first)
  if (idx < 0) return ''
  const start = Math.max(0, idx - 30)
  return (start > 0 ? '…' : '') + body.slice(start, idx + first.length + 50).replace(/\s+/g, ' ').trim() + '…'
}
