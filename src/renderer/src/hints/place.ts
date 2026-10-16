export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Placement {
  x: number
  y: number
  /** Lado do elemento em que o hint ficou. */
  side: 'above' | 'below' | 'left' | 'right'
  /** Posição da setinha ao longo da borda virada para o elemento (da esquerda, ou do topo nos lados). */
  arrow: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi))

/**
 * Onde desenhar o hint sem sair da janela, com a setinha apontando para o meio do elemento. Normalmente
 * embaixo dele (em cima se não couber e houver mais espaço lá); em itens de menu (`prefer: 'side'`), ao lado,
 * para não cobrir os itens vizinhos.
 */
export function placeHint(
  anchor: Box,
  tip: { w: number; h: number },
  view: { w: number; h: number },
  prefer: 'vertical' | 'side' = 'vertical',
  gap = 8,
  margin = 8
): Placement {
  if (prefer === 'side') {
    const roomRight = view.w - (anchor.x + anchor.w) - gap - margin
    const roomLeft = anchor.x - gap - margin
    const side = tip.w <= roomRight || roomRight >= roomLeft ? 'right' : 'left'
    const x = side === 'right' ? anchor.x + anchor.w + gap : anchor.x - gap - tip.w
    const cy = anchor.y + anchor.h / 2
    const y = clamp(cy - tip.h / 2, margin, view.h - margin - tip.h)
    return { x: Math.round(clamp(x, margin, view.w - margin - tip.w)), y: Math.round(y), side, arrow: Math.round(clamp(cy - y, 10, tip.h - 10)) }
  }
  const roomBelow = view.h - (anchor.y + anchor.h) - gap - margin
  const roomAbove = anchor.y - gap - margin
  const side = tip.h <= roomBelow || roomBelow >= roomAbove ? 'below' : 'above'
  const y = side === 'below' ? anchor.y + anchor.h + gap : anchor.y - gap - tip.h
  const cx = anchor.x + anchor.w / 2
  const x = clamp(cx - tip.w / 2, margin, view.w - margin - tip.w)
  return {
    x: Math.round(x),
    y: Math.round(clamp(y, margin, view.h - margin - tip.h)),
    side,
    arrow: Math.round(clamp(cx - x, 10, tip.w - 10))
  }
}
