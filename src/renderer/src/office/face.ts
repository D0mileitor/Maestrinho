import type { Look } from '@shared/schemas'
import { sprite } from './sprites'
import { customReady } from './customSprites'

const cache = new Map<string, string>()
const MAX_CACHE = 200
/** Recorte do rosto no quadro de frente: largura toda (cabelo cacheado e fone encostam na borda) e até os ombros. */
const SIZE = 16

/** Rosto do personagem (cabeça e ombros, de frente) como imagem 16×16, para avatares fora do escritório. */
export function faceUrl(look: Look): string {
  const key = JSON.stringify(look)
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = SIZE
  c.height = SIZE
  c.getContext('2d')!.drawImage(sprite(look, 'front', 0, false, false), 0, 0, SIZE, SIZE, 0, 0, SIZE, SIZE)
  const url = c.toDataURL('image/png')
  // Personagem próprio ainda carregando: não guarda o rosto desenhado no lugar dele.
  if (look.custom && !customReady(look.custom)) return url
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!)
  cache.set(key, url)
  return url
}
