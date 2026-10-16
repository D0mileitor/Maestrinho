import type { HintText } from '../../hints/content'
import { dialogosHints } from './dialogos'
import { escritorioHints } from './escritorio'
import { geralHints } from './geral'
import { nosHints } from './nos'
import { paineisHints } from './paineis'

/**
 * Textos dos hints (o balão que aparece ao parar o mouse num botão), por área. Cada área tem o seu arquivo
 * e as chaves começam pelo nome dela ("topo.", "no.", "chat.", "dialogo.", "escritorio."…).
 */
export const hintText = { ...geralHints, ...nosHints, ...paineisHints, ...dialogosHints, ...escritorioHints } satisfies Record<string, HintText>
export type HintKey = keyof typeof hintText
