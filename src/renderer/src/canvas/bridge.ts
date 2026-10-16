import { create } from 'zustand'

/**
 * Ações do canvas expostas para atalhos globais, paleta e diálogos (registradas pelo Canvas, que
 * tem acesso à instância do React Flow).
 */
export interface CanvasBridge {
  fitView(): void
  zoomIn(): void
  zoomOut(): void
  /** Centraliza um nó (e opcionalmente ajusta o zoom para enquadrá-lo). */
  centerOnNode(id: string, frame?: boolean): void
  /** Centro da área visível, em coordenadas do canvas. */
  viewportCenter(): { x: number; y: number }
  screenToFlow(p: { x: number; y: number }): { x: number; y: number }
}

let bridge: CanvasBridge | null = null

export function setCanvasBridge(b: CanvasBridge | null): void {
  bridge = b
}

export function canvasBridge(): CanvasBridge | null {
  return bridge
}

/**
 * Zoom "assentado" (atualizado ao fim de cada gesto de pan/zoom). Os terminais re-renderizam a
 * fonte só quando ele muda, e não a cada quadro do gesto.
 */
export const useSettledZoom = create<{ zoom: number; set(z: number): void }>((set) => ({
  zoom: 1,
  set: (zoom) => set({ zoom: Math.round(zoom * 100) / 100 })
}))

export const GRID = 20
export const DEFAULT_TERMINAL_SIZE = { w: 600, h: 420 }
export const DEFAULT_NOTE_SIZE = { w: 400, h: 320 }
export const DEFAULT_PORTAL_SIZE = { w: 800, h: 560 }

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID
}
