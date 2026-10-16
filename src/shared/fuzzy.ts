/** Normaliza para busca: sem acentos, minúsculas. "Café" ~ "cafe". */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/**
 * Pontua `query` contra `text` (subsequência com bônus para início de palavra e sequência
 * contínua). Retorna -1 se não casar. Também devolve as posições casadas (para negrito).
 */
export function fuzzyScore(query: string, text: string): { score: number; positions: number[] } {
  const q = normalize(query)
  const s = normalize(text)
  if (!q) return { score: 0, positions: [] }
  const positions: number[] = []
  let score = 0
  let qi = 0
  let prev = -2
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      positions.push(i)
      const wordStart = i === 0 || /[\s._\-/\\]/.test(s[i - 1]!)
      score += 1 + (wordStart ? 6 : 0) + (prev === i - 1 ? 4 : 0)
      prev = i
      qi++
    }
  }
  if (qi < q.length) return { score: -1, positions: [] }
  // Prefere textos curtos e casamentos no começo.
  score += Math.max(0, 8 - (positions[0] ?? 0)) - s.length * 0.02
  return { score, positions }
}

/** Todas as palavras da consulta precisam casar em algum dos campos. */
export function multiTermScore(query: string, fields: string[]): { score: number; positions: number[] } {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return { score: 0, positions: [] }
  let total = 0
  let firstPositions: number[] = []
  for (const [ti, term] of terms.entries()) {
    let best = -1
    let bestPos: number[] = []
    for (const [fi, field] of fields.entries()) {
      const r = fuzzyScore(term, field)
      // O primeiro campo (nome) vale mais que os demais (tipo, workspace, corpo).
      const weighted = r.score < 0 ? -1 : r.score * (fi === 0 ? 1.5 : 1)
      if (weighted > best) {
        best = weighted
        bestPos = fi === 0 ? r.positions : []
      }
    }
    if (best < 0) return { score: -1, positions: [] }
    total += best
    if (ti === 0) firstPositions = bestPos
  }
  return { score: total, positions: firstPositions }
}
