import * as fsp from 'node:fs/promises'
import type { AgentUsage } from '@shared/usage'
import { addClaudeLines, addCodexLines, pruneEntries, totalsSince, type ParsedUsage } from './agentUsage'

/** Primeira leitura de um histórico: só o final (as janelas de limite não passam de uma semana). */
const FIRST_READ_BYTES = 32 * 1024 * 1024
/** Respostas mais antigas que isto são descartadas da memória. */
const KEEP_MS = 8 * 24 * 60 * 60_000

export interface AgentTerminal {
  terminalId: string
  name: string
  workspace: string
  provider: 'claude' | 'codex'
  /** Histórico da sessão do terminal. */
  file: string
}

/** Início das janelas atuais de cada provedor (ms). */
export type UsageWindows = Record<'claude' | 'codex', { session: number; week: number }>

interface Tracked extends ParsedUsage {
  offset: number
  /** Linha incompleta no fim da última leitura. */
  partial: string
}

/**
 * Uso de tokens de cada terminal de agente, lido dos históricos de forma incremental: cada chamada lê
 * só os bytes novos (assíncrono, para não travar o processo principal).
 */
export class AgentUsageService {
  private readonly tracked = new Map<string, Tracked>()

  async read(terminals: AgentTerminal[], windows: UsageWindows, now = Date.now()): Promise<AgentUsage[]> {
    const out: AgentUsage[] = []
    const live = new Set<string>()
    for (const t of terminals) {
      live.add(t.file)
      const parsed = await this.update(t.file, t.provider, now)
      if (!parsed) continue
      const w = windows[t.provider]
      const week = totalsSince(parsed.entries.values(), w.week)
      if (week.weight === 0) continue
      out.push({
        terminalId: t.terminalId,
        name: t.name,
        workspace: t.workspace,
        provider: t.provider,
        model: parsed.model,
        session: totalsSince(parsed.entries.values(), w.session),
        week
      })
    }
    // Terminais fechados ou com outra sessão: libera a memória.
    for (const file of this.tracked.keys()) if (!live.has(file)) this.tracked.delete(file)
    return out
  }

  private async update(file: string, provider: AgentTerminal['provider'], now: number): Promise<Tracked | null> {
    let t = this.tracked.get(file)
    try {
      const size = (await fsp.stat(file)).size
      if (!t || size < t.offset) {
        // Primeira vez (ou o arquivo foi recriado): começa do fim recente.
        t = { entries: new Map(), model: null, offset: Math.max(0, size - FIRST_READ_BYTES), partial: '' }
        this.tracked.set(file, t)
      }
      if (size > t.offset) {
        const fh = await fsp.open(file, 'r')
        try {
          const buf = Buffer.alloc(size - t.offset)
          await fh.read(buf, 0, buf.length, t.offset)
          t.offset = size
          const text = t.partial + buf.toString('utf8')
          const cut = text.lastIndexOf('\n')
          t.partial = cut >= 0 ? text.slice(cut + 1) : text
          const complete = cut >= 0 ? text.slice(0, cut) : ''
          if (provider === 'claude') addClaudeLines(complete, t)
          else addCodexLines(complete, t)
        } finally {
          await fh.close()
        }
      }
      pruneEntries(t, now - KEEP_MS)
      return t
    } catch {
      return t ?? null
    }
  }
}
