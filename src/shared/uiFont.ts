/**
 * Fonte e tamanho do texto da interface (todo o app, menos os terminais, que têm configuração própria,
 * e blocos de código/diffs, que continuam monoespaçados).
 */

/** Tamanho de texto (px) para o qual o CSS foi desenhado: o tamanho escolhido vira uma escala sobre ele. */
export const UI_BASE_FONT_SIZE = 13
export const UI_FONT_SIZE_MIN = 10
export const UI_FONT_SIZE_MAX = 20

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif', 'ui-monospace'])

/**
 * Lista de fontes digitada pelo usuário ("Segoe UI, Arial") → valor de font-family: cada nome entre
 * aspas (nomes com espaço ou começando por dígito exigem), famílias genéricas sem aspas. Caracteres que
 * poderiam sair do valor CSS são descartados. null = nenhuma fonte informada.
 */
export function fontFamilyList(input: string): string | null {
  const names = input
    .split(',')
    .map((n) => n.replace(/["'\\;{}<>()]/g, '').trim())
    .filter(Boolean)
  if (names.length === 0) return null
  return names.map((n) => (GENERIC.has(n.toLowerCase()) ? n.toLowerCase() : `"${n}"`)).join(', ')
}

/**
 * Variáveis CSS da interface para as preferências: null = remover (vale o padrão do CSS, IBM Plex).
 * A fonte escolhida substitui também a condensada (títulos e barras), para todo texto usar a mesma.
 */
export function uiFontVars(settings: { uiFontFamily: string; uiFontSize: number }): Record<'--font-ui' | '--font-condensed' | '--font-scale', string | null> {
  const family = fontFamilyList(settings.uiFontFamily)
  const value = family ? `${family}, sans-serif` : null
  const size = Number.isFinite(settings.uiFontSize) ? Math.min(UI_FONT_SIZE_MAX, Math.max(UI_FONT_SIZE_MIN, settings.uiFontSize)) : UI_BASE_FONT_SIZE
  return {
    '--font-ui': value,
    '--font-condensed': value,
    '--font-scale': size === UI_BASE_FONT_SIZE ? null : String(Math.round((size / UI_BASE_FONT_SIZE) * 10_000) / 10_000)
  }
}
