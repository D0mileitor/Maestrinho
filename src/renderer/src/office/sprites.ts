import type { Look } from '@shared/schemas'
import { buildGrid, palette, type SpriteView } from './spriteData'
import { customSprite } from './customSprites'

const cache = new Map<string, HTMLCanvasElement>()
const MAX_CACHE = 800

/** Quadro do personagem como imagem 16×32 (com cache: as combinações se repetem muito). */
export function sprite(look: Look, view: SpriteView, frame: number, breath: boolean, blink: boolean): HTMLCanvasElement {
  // Personagem próprio (folha do workspace); enquanto carrega, vale o desenhado.
  if (look.custom) {
    const own = customSprite(look.custom, view, frame)
    if (own) return own
  }
  const key = `${JSON.stringify(look)}|${view}${frame}${breath ? 'b' : ''}${blink ? 'k' : ''}`
  const hit = cache.get(key)
  if (hit) return hit
  const grid = buildGrid(look, view, frame, breath, blink)
  const pal = palette(look)
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 32
  const g = c.getContext('2d')!
  for (let r = 0; r < 32; r++) {
    for (let k = 0; k < 16; k++) {
      const ch = grid[r]![k]!
      if (ch === '.') continue
      g.fillStyle = pal[ch] ?? '#ff00ff'
      g.fillRect(k, r, 1, 1)
    }
  }
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!)
  cache.set(key, c)
  return c
}
