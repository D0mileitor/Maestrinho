/**
 * Barra de título própria (a nativa do Windows fica escondida): o app desenha título e ícone; os botões
 * de minimizar/maximizar/fechar continuam os do sistema (com os atalhos de encaixe), pintados nas cores
 * do tema.
 */

export const TITLE_BAR_HEIGHT = 34

export interface TitleBarColors {
  /** Fundo atrás dos botões do sistema (igual ao da barra desenhada pelo app). */
  color: string
  /** Cor dos símbolos (–, □, ×). */
  symbolColor: string
}

/** Cores da área dos botões do sistema, iguais às variáveis --canvas e --text-2 de cada tema. */
export function titleBarColors(theme: 'dark' | 'light'): TitleBarColors {
  return theme === 'light' ? { color: '#e9edf3', symbolColor: '#3f4a5c' } : { color: '#151b27', symbolColor: '#b7bdc9' }
}
