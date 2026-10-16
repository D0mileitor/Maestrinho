/**
 * Atalhos para as suas mensagens no chat (lógica pura): uma régua no canto do chat com um traço por
 * mensagem sua; ao passar o mouse, a lista com o começo de cada uma; ao clicar, o chat rola até ela.
 */

/** Máximo de traços na régua (com mais mensagens, mostra a janela em volta da atual). */
export const OUTLINE_MAX_TICKS = 24

/** Texto da mensagem numa linha só (a lista corta com reticências conforme a largura). */
export function outlineText(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/**
 * Qual das suas mensagens está "em leitura": a última que começa acima de um terço da área visível.
 * No fim da conversa, vale a última que aparece na tela. -1 = acima da primeira.
 * `tops` = posição de cada mensagem dentro da área rolável (não finito = não está na tela).
 */
export function currentIndex(tops: readonly number[], viewTop: number, viewHeight: number, atEnd: boolean): number {
  const line = atEnd ? viewTop + viewHeight - 8 : viewTop + viewHeight / 3
  let found = -1
  tops.forEach((top, i) => {
    if (Number.isFinite(top) && top <= line) found = i
  })
  return found
}

/** Janela [início, fim) de no máximo `max` traços, com o atual no meio quando dá. */
export function tickWindow(count: number, active: number, max = OUTLINE_MAX_TICKS): [number, number] {
  if (count <= max) return [0, count]
  const start = Math.min(Math.max(0, active - Math.floor(max / 2)), count - max)
  return [start, start + max]
}
