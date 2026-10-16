/**
 * Folha de sprites de um personagem próprio do escritório: 4 colunas (quadros de animação) × 5 linhas
 * (vistas), células na proporção 1:2 (16×32 é o tamanho dos personagens desenhados; maiores são
 * reduzidas). Qualquer outra imagem vale como quadro único, usado em todas as vistas.
 */

export const SHEET_COLS = 4
export const SHEET_ROWS = 5
/** Ordem das linhas da folha. */
export const SHEET_VIEWS = ['front', 'back', 'side', 'sit', 'cheer'] as const
export type SheetView = (typeof SHEET_VIEWS)[number]

export type SheetLayout = { kind: 'sheet'; cellW: number; cellH: number } | { kind: 'single'; width: number; height: number }

export function sheetLayout(width: number, height: number): SheetLayout {
  const cellW = width / SHEET_COLS
  const cellH = height / SHEET_ROWS
  if (Number.isInteger(cellW) && Number.isInteger(cellH) && cellW > 0 && cellH === cellW * 2) return { kind: 'sheet', cellW, cellH }
  return { kind: 'single', width, height }
}

/**
 * Célula para a vista e o quadro pedidos. Quadro vazio cai no primeiro da linha; linha vazia, no
 * primeiro quadro da frente (assim uma folha só com a frente já funciona).
 */
export function sheetCell(view: SheetView, frame: number, filled: (col: number, row: number) => boolean): { col: number; row: number } {
  const row = SHEET_VIEWS.indexOf(view)
  const col = ((frame % SHEET_COLS) + SHEET_COLS) % SHEET_COLS
  if (filled(col, row)) return { col, row }
  if (filled(0, row)) return { col: 0, row }
  return { col: 0, row: 0 }
}

/** Retângulo (no quadro de destino w×h) onde caber uma imagem única: proporção mantida, centrada, no chão. */
export function fitSingle(width: number, height: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(w / width, h / height)
  const dw = width * scale
  const dh = height * scale
  return { x: (w - dw) / 2, y: h - dh, w: dw, h: dh }
}

/** Texto para pedir a um agente (ex.: Claude Code) que desenhe um personagem neste formato. */
export function characterPrompt(description: string): string {
  return [
    `Crie um personagem em pixel art para o escritório do Maestrinho: ${description || 'descreva aqui o personagem'}.`,
    'Entregue um PNG com fundo transparente de 64×160 pixels: uma grade de 4 colunas × 5 linhas, cada célula com 16×32 pixels (personagem inteiro, de pé, pés na última linha da célula).',
    'Linhas, de cima para baixo: 1) de frente; 2) de costas; 3) de lado, olhando para a direita; 4) sentado de costas, digitando (só a metade de cima aparece, a mesa cobre as pernas); 5) comemorando, de frente, braços para cima.',
    'Colunas: 4 quadros de animação da caminhada (parado, passo, parado, passo); nas linhas 4 e 5 bastam 1 ou 2 quadros, deixe o resto vazio (transparente).',
    'Use poucas cores, contorno escuro de 1 pixel e nada de suavização (pixels nítidos). Salve como personagem.png.'
  ].join('\n')
}
