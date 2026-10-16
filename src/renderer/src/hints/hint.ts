import { hintText, type HintKey } from '../i18n/hints'
import type { HintText } from './content'

/** Atributos que ligam um elemento ao hint do Maestrinho (lidos pela HintLayer). */
export interface HintAttrs {
  'data-hint'?: string
  'data-hint-title'?: string
  'data-hint-body'?: string
  'data-hint-keys'?: string
  'aria-label'?: string
}

/** Separador dos atalhos em `data-hint-keys` ("Ctrl+K | Ctrl+P"). */
export const KEYS_SEP = ' | '

/**
 * Hint do registro (`src/renderer/src/i18n/hints`). Com `label`, o título também vira o nome acessível
 * (para botões só com ícone).
 */
export function hint(key: HintKey, opts: { label?: boolean } = {}): HintAttrs {
  return { 'data-hint': key, ...(opts.label ? { 'aria-label': hintText[key].title } : {}) }
}

/** Hint com texto montado na hora (ex.: com o nome do agente ou do arquivo). */
export function hintOf(h: HintText, opts: { label?: boolean } = {}): HintAttrs {
  return {
    'data-hint-title': h.title,
    ...(h.body ? { 'data-hint-body': h.body } : {}),
    ...(h.keys?.length ? { 'data-hint-keys': h.keys.join(KEYS_SEP) } : {}),
    ...(opts.label ? { 'aria-label': h.title } : {})
  }
}
