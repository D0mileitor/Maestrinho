import type { ChatImage, ChatItem, HelperItem } from './chat'

/**
 * Chat geral (lógica pura): junta as conversas de todos os agentes numa linha do tempo e interpreta as
 * menções ("@dev @qa texto") para saber a quem cada mensagem vai.
 */

export interface GeneralEntry {
  /** Único na linha do tempo (terminal + item). */
  key: string
  at: string
  /** Terminal dono da conversa onde a mensagem apareceu. */
  terminalId: string
  /**
   * user = você escreveu para o terminal; assistant = resposta dele; orq = recado de outro agente para ele;
   * helper = resposta de um ajudante que ele chamou.
   */
  kind: 'user' | 'assistant' | 'orq' | 'helper'
  text: string
  /** Remetente do recado (orq). */
  from?: string
  images?: ChatImage[]
  /** Ajudante que respondeu (rosto, tarefa, tipo, situação e uso). */
  helper?: Pick<HelperItem, 'seed' | 'title' | 'type' | 'status' | 'usage'>
}

export interface FeedInput {
  terminalId: string
  items: readonly ChatItem[]
}

/**
 * Linha do tempo do chat geral: suas mensagens, as respostas e os recados entre agentes (sem as
 * ferramentas), em ordem de horário; itens sem horário herdam o do anterior da mesma conversa.
 * Devolve só as últimas `limit`.
 */
export function mergeFeeds(feeds: readonly FeedInput[], limit = 500): GeneralEntry[] {
  const all: { e: GeneralEntry; feed: number; idx: number }[] = []
  feeds.forEach((f, feed) => {
    let lastAt = ''
    f.items.forEach((item, idx) => {
      if (item.at) lastAt = item.at
      if (item.kind === 'helper') {
        // a resposta do ajudante entra; o pedido (linha "chamou um ajudante") fica só na aba do agente
        if (item.role !== 'report') return
        const helper = { seed: item.seed, title: item.title, status: item.status, ...(item.type ? { type: item.type } : {}), ...(item.usage ? { usage: item.usage } : {}) }
        all.push({ e: { key: `${f.terminalId}:${item.key}`, at: item.at || lastAt, terminalId: f.terminalId, kind: 'helper', text: item.report ?? '', helper }, feed, idx })
        return
      }
      if (item.kind !== 'user' && item.kind !== 'assistant' && item.kind !== 'orq') return
      const base = { key: `${f.terminalId}:${item.key}`, at: item.at || lastAt, terminalId: f.terminalId, text: item.text }
      const e: GeneralEntry =
        item.kind === 'orq'
          ? { ...base, kind: 'orq', from: item.from }
          : item.kind === 'user'
            ? { ...base, kind: 'user', images: item.images }
            : { ...base, kind: 'assistant' }
      if (e.text.trim() === '' && !(e.images && e.images.length)) return
      all.push({ e, feed, idx })
    })
  })
  all.sort((a, b) => (a.e.at < b.e.at ? -1 : a.e.at > b.e.at ? 1 : a.feed - b.feed || a.idx - b.idx))
  return all.slice(Math.max(0, all.length - limit)).map((x) => x.e)
}

/**
 * Menções numa mensagem do chat geral. Destinatários = os agentes mencionados (em qualquer lugar do
 * texto, sem diferenciar maiúsculas); o texto entregue perde só as menções do começo ("@dev @qa rodem os
 * testes" → "rodem os testes"). Sem menção conhecida, `targets` vem vazio (vale o último destinatário).
 */
export function parseMentions(text: string, names: readonly string[]): { targets: string[]; body: string } {
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]))
  const targets: string[] = []
  for (const m of text.matchAll(/(^|[\s(,;])@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu)) {
    const raw = m[2]!.replace(/[.,;:!?]+$/u, '')
    const name = byLower.get(raw.toLowerCase())
    if (name && !targets.includes(name)) targets.push(name)
  }
  const lead = /^\s*(?:@[\p{L}\p{N}][\p{L}\p{N}._-]*[\s,]*)+/u.exec(text)
  let body = text
  if (lead) {
    const leadNames = [...lead[0].matchAll(/@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu)].map((m) => m[1]!.toLowerCase())
    // Só corta o começo se todas as menções dele são agentes de verdade.
    if (leadNames.every((n) => byLower.has(n))) body = text.slice(lead[0].length)
  }
  return { targets, body: body.trim() }
}

/** Menção sendo digitada no fim do texto ("…@de" → "de"), para sugerir agentes; null se não há. */
export function mentionQuery(text: string): string | null {
  const m = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u.exec(text)
  return m ? m[1]! : null
}
