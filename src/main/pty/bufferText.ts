import { normalize } from '@shared/fuzzy'

/** O mínimo do buffer do xterm usado aqui (permite testar sem um terminal). */
export interface BufferLike {
  length: number
  getLine(y: number): { isWrapped: boolean; translateToString(trimRight?: boolean, startCol?: number, endCol?: number): string } | undefined
}

/**
 * Linhas lógicas (as quebradas pelo wrap unidas) do fim para o começo do buffer; `y` é a primeira linha
 * física de cada uma. Ler de trás para frente deixa o custo proporcional ao que é pedido, não ao
 * tamanho do histórico (antes, ler as últimas 40 linhas percorria as 10 mil do scrollback).
 */
export function* logicalLinesBackward(buf: BufferLike, maxRows = Number.POSITIVE_INFINITY): Generator<{ text: string; y: number }> {
  const stop = Math.max(0, buf.length - maxRows)
  let parts: string[] = []
  for (let y = buf.length - 1; y >= stop; y--) {
    const line = buf.getLine(y)
    if (!line) continue
    parts.push(line.translateToString(true))
    if (!line.isWrapped) {
      yield { text: parts.reverse().join(''), y }
      parts = []
    }
  }
  // Começo de uma linha que já saiu do histórico (ou do limite): o que sobrou é uma linha.
  if (parts.length > 0) yield { text: parts.reverse().join(''), y: stop }
}

/**
 * Últimas `rows` linhas físicas da tela, cada uma como aparece (sem juntar as "quebradas pelo wrap"), sem as
 * vazias do fim e sem espaços à direita. É o certo para ler TUIs como o Claude Code e o Codex: elas desenham
 * linha a linha, e no Windows o ConPTY não manda a quebra depois de uma linha que ocupa a largura toda — o
 * xterm marca a seguinte como continuação e as linhas lógicas grudam separadores, opções e abas.
 */
export function lastRows(buf: BufferLike, rows: number, cols?: number): string {
  const out: string[] = []
  for (let y = buf.length - 1; y >= 0 && out.length < rows; y--) {
    // Até a largura atual: depois de diminuir o terminal, as células além dela guardam a tela antiga.
    const text = (buf.getLine(y)?.translateToString(true, 0, cols) ?? '').replace(/\s+$/u, '')
    if (out.length === 0 && text === '') continue
    out.push(text)
  }
  return out.reverse().join('\n')
}

/** Texto das últimas `lines` linhas lógicas, sem as linhas vazias do fim e sem espaços à direita. */
export function lastLines(buf: BufferLike, lines: number): string {
  const out: string[] = []
  for (const { text } of logicalLinesBackward(buf)) {
    if (out.length === 0 && text.trim() === '') continue
    out.push(text.replace(/\s+$/u, ''))
    if (out.length >= lines) break
  }
  return out.reverse().join('\n')
}

/**
 * Até `max` linhas que contêm `query` (sem acento e sem diferenciar maiúsculas), da mais recente para a
 * mais antiga, olhando só as últimas `maxRows` linhas físicas.
 */
export function searchLines(buf: BufferLike, query: string, max: number, maxRows = 5000): { text: string; y: number }[] {
  const q = normalize(query.trim())
  if (!q) return []
  const out: { text: string; y: number }[] = []
  for (const l of logicalLinesBackward(buf, maxRows)) {
    if (!normalize(l.text).includes(q)) continue
    out.push({ text: l.text.replace(/\s+$/u, ''), y: l.y })
    if (out.length >= max) break
  }
  return out
}
