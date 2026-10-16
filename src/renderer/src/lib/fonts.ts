/** Valor da opção "Outra fonte…" na lista de fontes da interface. */
export const OTHER_FONT = '\u0000outra'

/**
 * Opção marcada na lista para a fonte salva: '' = padrão; o próprio nome se ele estiver na lista;
 * OTHER_FONT para um nome digitado (ou uma lista "A, B") fora dela.
 */
export function fontChoice(value: string, listed: readonly string[]): string {
  const v = value.trim()
  if (!v) return ''
  return listed.includes(v) ? v : OTHER_FONT
}

/**
 * Fontes da lista que estão instaladas: o texto medido com a fonte pedida difere do medido só com a
 * genérica de reserva em pelo menos uma das três genéricas (uma fonte igual à padrão de uma delas ainda
 * difere das outras).
 */
export function installedFonts(names: readonly string[]): string[] {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return [...names]
  const sample = 'mmmmmmmmmmlli1WQ@#ãç'
  const width = (font: string): number => {
    ctx.font = `32px ${font}`
    return ctx.measureText(sample).width
  }
  const bases = ['monospace', 'serif', 'sans-serif'].map((b) => [b, width(b)] as const)
  return names.filter((n) => bases.some(([b, w]) => width(`"${n}", ${b}`) !== w))
}
