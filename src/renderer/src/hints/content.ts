/** Conteúdo de um hint: título, explicação opcional e atalhos ("Ctrl+K", "Esc"). */
export interface HintText {
  title: string
  body?: string
  keys?: readonly string[]
}

/** Atalho no fim do título de um title antigo: "Buscar (Ctrl+K)", "Selecionar (V)", "Fechar (Esc)". */
const KEYS_AT_END = /\s*\(((?:Ctrl|Shift|Alt|Esc|Enter|Tab|Del|F\d{1,2})(?:\s*\+\s*[^()]+)?|[A-Z0-9])\)\s*$/

/**
 * Lê o texto de um `title` nativo: a primeira linha vira o título (sem o atalho entre parênteses, que vira
 * tecla) e as demais, a explicação.
 */
export function parseHintText(text: string): HintText | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const first = lines[0]
  if (!first) return null
  const m = KEYS_AT_END.exec(first)
  const title = m ? first.slice(0, m.index).trim() : first
  const body = lines.slice(1).join('\n')
  return { title: title || first, ...(body ? { body } : {}), ...(m ? { keys: [m[1]!.trim()] } : {}) }
}

/** Teclas de um atalho, para desenhar uma tecla por vez: "Ctrl+Shift+B" → Ctrl, Shift, B; "Ctrl++" → Ctrl, +. */
export function keyParts(combo: string): string[] {
  return combo
    .split(/\+(?=.)/)
    .map((k) => k.trim())
    .filter(Boolean)
}
