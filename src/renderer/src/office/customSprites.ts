import { SHEET_COLS, SHEET_ROWS, fitSingle, sheetCell, sheetLayout, type SheetLayout, type SheetView } from '@shared/characterSheet'
import { api } from '../lib/api'

/**
 * Personagens próprios (folhas de sprites do workspace): carregados sob demanda e recortados em quadros
 * de 16×32, o mesmo tamanho dos personagens desenhados (o motor do escritório não precisa saber a
 * diferença). Enquanto a imagem carrega, quem pede recebe null e usa o personagem desenhado.
 */

interface Loaded {
  img: HTMLImageElement
  layout: SheetLayout
  /** Células com algum pixel visível ([linha][coluna]). */
  filled: boolean[][]
}

type Entry = { status: 'loading' } | { status: 'error' } | ({ status: 'ready' } & Loaded)

const images = new Map<string, Entry>()
const frames = new Map<string, HTMLCanvasElement>()
const listeners = new Set<() => void>()
let currentDir = ''

/** Workspace cujos personagens valem agora (o ativo). */
export function setCharacterDir(dir: string): void {
  currentDir = dir
}

/** Esquece as imagens carregadas (personagem importado de novo ou removido). */
export function invalidateCharacters(): void {
  images.clear()
  frames.clear()
}

/** Avisa quando um personagem terminar de carregar (para quem guardou o quadro desenhado em cache). */
export function onCharacterLoaded(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function filledCells(img: HTMLImageElement, layout: SheetLayout): boolean[][] {
  if (layout.kind !== 'sheet') return [[true]]
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0)
  const out: boolean[][] = []
  for (let r = 0; r < SHEET_ROWS; r++) {
    out.push([])
    for (let k = 0; k < SHEET_COLS; k++) {
      const data = g.getImageData(k * layout.cellW, r * layout.cellH, layout.cellW, layout.cellH).data
      let any = false
      for (let i = 3; i < data.length && !any; i += 4) any = data[i]! > 0
      out[r]!.push(any)
    }
  }
  return out
}

function load(key: string, dir: string, file: string): void {
  images.set(key, { status: 'loading' })
  void api
    .invoke('office:readCharacter', { dir, file })
    .then(async (url) => {
      const img = new Image()
      img.src = url
      await img.decode()
      const layout = sheetLayout(img.naturalWidth, img.naturalHeight)
      images.set(key, { status: 'ready', img, layout, filled: filledCells(img, layout) })
      for (const fn of listeners) fn()
    })
    .catch(() => images.set(key, { status: 'error' }))
}

/** O personagem próprio já está carregado (para caches que guardam o resultado). */
export function customReady(file: string): boolean {
  return images.get(`${currentDir}|${file}`)?.status === 'ready'
}

/** Quadro 16×32 do personagem próprio, ou null enquanto não carregou (ou se a imagem falhou). */
export function customSprite(file: string, view: SheetView, frame: number): HTMLCanvasElement | null {
  if (!currentDir) return null
  const key = `${currentDir}|${file}`
  const entry = images.get(key)
  if (!entry) {
    load(key, currentDir, file)
    return null
  }
  if (entry.status !== 'ready') return null
  const cell = entry.layout.kind === 'sheet' ? sheetCell(view, frame, (c, r) => entry.filled[r]?.[c] === true) : { col: 0, row: 0 }
  const fkey = `${key}|${cell.col},${cell.row}`
  const hit = frames.get(fkey)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 32
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  if (entry.layout.kind === 'sheet') {
    const { cellW, cellH } = entry.layout
    g.drawImage(entry.img, cell.col * cellW, cell.row * cellH, cellW, cellH, 0, 0, 16, 32)
  } else {
    const r = fitSingle(entry.layout.width, entry.layout.height, 16, 32)
    g.drawImage(entry.img, r.x, r.y, r.w, r.h)
  }
  frames.set(fkey, c)
  return c
}
