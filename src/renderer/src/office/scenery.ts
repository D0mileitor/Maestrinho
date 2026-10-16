import type { SceneRect } from '@shared/office'
import type { OfficeSceneId } from '@shared/schemas'
import { placeDecor, type DecorSpec, type Placed } from './decor'
import { shade } from './spriteData'

/**
 * Cenários da visão Escritório. Todos na mesma vista das mesas e dos agentes (pixel art 2D, de cima
 * em 3/4): a parede (ou o fundo) aparece de frente na faixa de cima e o chão é visto de cima; móveis
 * com tampo claro, frente escura e sombra embaixo, luz vindo de cima à esquerda. O fundo fixo é
 * desenhado uma vez por tamanho de sala; o que se mexe (nuvens, chamas, vapor) é desenhado a cada quadro.
 */

export type Px = (x: number, y: number, w: number, h: number, c: string) => void

export interface PathStyle {
  /** Tapete entre terminais. */
  carpet: { edge: string; fill: string; lit: string; dash: string; dashes: 'stripes' | 'stones' | 'dots' }
  /** Passarela até uma nota. */
  walk: { edge: string; fill: string; lit: string }
}

export interface SceneryRenderer {
  paths: PathStyle
  /** Fundo e o que se mexe atrás dos móveis. */
  back(g: CanvasRenderingContext2D, px: Px, t: number): void
  /** O que fica na frente de tudo (fagulhas, borboletas, vinheta). */
  front(g: CanvasRenderingContext2D, px: Px, t: number): void
}

interface Built {
  vignette: string
  paint(px: Px, g: CanvasRenderingContext2D): void
  back?(px: Px, g: CanvasRenderingContext2D, t: number): void
  front?(px: Px, g: CanvasRenderingContext2D, t: number): void
}

interface Kit {
  paths: PathStyle
  decor: DecorSpec[]
  build(W: number, H: number, decor: Placed[], r: () => number): Built
}

/** Primeira linha do chão (abaixo da parede/fundo). */
export const FLOOR_TOP = 81

// ------------------------------------------------------------------ utilidades

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length]!
const of = <T>(v: number, list: readonly T[]): T => list[v % list.length]!

function ellipse(px: Px, cx: number, cy: number, rx: number, ry: number, c: string): void {
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))))
    if (half > 0) px(cx - half, cy + dy, half * 2, 1, c)
  }
}

function shadow(px: Px, cx: number, cy: number, rx: number, ry: number): void {
  ellipse(px, cx, cy, rx, ry, 'rgba(0,0,0,0.22)')
}

/** 0→1→0 em ondas triangulares (para bolas e personagens que vão e voltam). */
function tri(x: number): number {
  const m = ((x % 2) + 2) % 2
  return m < 1 ? m : 2 - m
}

function makePx(g: CanvasRenderingContext2D): Px {
  return (x, y, w, h, c) => {
    g.fillStyle = c
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
  }
}

/** Assoalho de tábuas (escritório, sala de descanso). */
function planks(px: Px, W: number, H: number, r: () => number, colors: readonly [string, string, string], seam: string, row: string): void {
  for (let y = FLOOR_TOP + 3; y < H + 8; y += 7) {
    let x = -Math.floor(r() * 40)
    while (x < W) {
      const w = 34 + Math.floor(r() * 34)
      const k = r()
      px(x, y, w - 1, 6, k < 0.33 ? colors[0] : k < 0.66 ? colors[1] : colors[2])
      px(x, y, w - 1, 1, 'rgba(255,240,220,0.06)')
      px(x + w - 1, y, 1, 6, seam)
      if (k > 0.8) px(x + 8, y + 3, 5, 1, 'rgba(60,40,25,0.4)')
      x += w
    }
  }
  for (let y = FLOOR_TOP; y < H; y += 7) px(0, y + 6, W, 1, row)
}

/** Janelas nas pontas da parede e, se a sala for larga, entre a ponta e o meio. */
function wallWindows(W: number, centerHalf: number): number[] {
  const cx = Math.round(W / 2)
  const out = [22, W - 70]
  for (const f of [0.25, 0.75]) {
    const wx = Math.round(W * f) - 24
    if (wx > 22 + 48 + 40 && wx + 48 < W - 70 - 40 && (wx + 48 < cx - centerHalf - 30 || wx > cx + centerHalf + 30)) out.push(wx)
  }
  return out
}

function drawWindow(px: Px, x: number, y: number, t: number): void {
  px(x, y, 48, 40, '#cfc7b3')
  px(x + 2, y + 2, 44, 36, '#86b9e6')
  px(x + 2, y + 26, 44, 12, '#b7d6f0')
  const cl = ((t * 4) % 70) - 14
  if (cl > 0 && cl < 38) {
    px(x + 2 + cl, y + 8, 8, 2, '#ffffff')
    px(x + 4 + cl, y + 7, 4, 1, '#ffffff')
  }
  for (let i = 0; i < 6; i++) px(x + 2, y + 2 + i * 4, 44, 1, 'rgba(236,232,220,0.85)')
  px(x + 23, y + 2, 2, 36, '#cfc7b3')
  px(x - 2, y + 40, 52, 3, '#b8ae97')
}

function windowBeams(g: CanvasRenderingContext2D, windows: number[]): void {
  g.fillStyle = 'rgba(255, 236, 190, 0.05)'
  for (const wx of windows) {
    g.beginPath()
    g.moveTo(wx, FLOOR_TOP)
    g.lineTo(wx + 48, FLOOR_TOP)
    g.lineTo(wx + 98, 170)
    g.lineTo(wx + 50, 170)
    g.closePath()
    g.fill()
  }
}

function clockFace(px: Px, x: number, y: number): void {
  px(x, y, 18, 18, '#cfc7b3')
  px(x + 2, y + 2, 14, 14, '#f4f1e8')
  px(x + 8, y + 4, 1, 6, '#2b3245')
}

function clockHand(px: Px, x: number, y: number, t: number): void {
  const ang = (t / 5) % (Math.PI * 2)
  px(x + 8 + Math.round(Math.cos(ang) * 4), y + 9 + Math.round(Math.sin(ang) * 4), 1, 1, '#c0392b')
}

/** Vapor subindo de um ponto (café, comida). */
function steam(px: Px, x: number, y: number, t: number, n = 3): void {
  for (let k = 0; k < n; k++) {
    const p = (t * 0.8 + k / n) % 1
    const a = (1 - p) * 0.55
    px(x + k * 3 + Math.round(Math.sin(t * 3 + k) * 1.5), y - Math.round(p * 12), 1, 2, `rgba(255,255,255,${a.toFixed(2)})`)
  }
}

/** Fileira de chamas sobre a linha `base` (pixel art: colunas de 3 com alturas que tremem). */
function flameRow(px: Px, x0: number, x1: number, base: number, t: number, hMin: number, hVar: number, seed: number): void {
  for (let x = x0; x < x1; x += 3) {
    const n = Math.sin(t * 6 + x * 0.35 + seed) * 0.5 + Math.sin(t * 9.7 + x * 0.13 + seed * 2) * 0.35 + Math.sin(t * 15.3 + x * 0.71) * 0.15
    const h = Math.max(2, Math.round(hMin + hVar * (n * 0.5 + 0.5)))
    px(x, base - h, 3, h, '#c0392b')
    const h2 = Math.round(h * 0.68)
    px(x, base - h2, 3, h2, '#ff7a1a')
    const h3 = Math.round(h * 0.36)
    px(x + 1, base - h3, 1, h3, '#ffd23f')
    if (n > 0.62) px(x + 1, base - h - 3, 1, 2, '#ff7a1a')
  }
}

function vignette(g: CanvasRenderingContext2D, W: number, H: number, color: string): void {
  const grd = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, Math.max(W, H) * 0.62)
  grd.addColorStop(0, 'rgba(0,0,0,0)')
  grd.addColorStop(1, color)
  g.fillStyle = grd
  g.fillRect(0, 0, W, H)
}

// ------------------------------------------------------------------ decoração comum

function plant(px: Px, x: number, y: number): void {
  shadow(px, x + 11, y + 33, 10, 2)
  px(x + 2, y + 20, 18, 14, '#a2603d')
  px(x + 2, y + 20, 18, 2, '#b8744f')
  px(x + 2, y + 30, 18, 4, '#8a4f30')
  px(x, y + 6, 22, 16, '#3f8f5a')
  px(x + 4, y, 14, 10, '#4fa56a')
  px(x + 2, y + 10, 6, 4, '#5fb37a')
  px(x + 14, y + 14, 6, 4, '#2f7a48')
}

function cooler(px: Px, x: number, y: number): void {
  shadow(px, x + 10, y + 39, 10, 2)
  px(x, y + 8, 20, 32, '#cfd6e2')
  px(x + 16, y + 8, 4, 32, '#b9c0cf')
  px(x + 3, y, 14, 12, '#8fc3ec')
  px(x + 4, y + 1, 4, 3, '#c9e6fb')
  px(x + 5, y + 18, 3, 2, '#e5534b')
  px(x + 12, y + 18, 3, 2, '#5b8def')
  px(x + 3, y + 22, 14, 1, '#9aa3b5')
}

// ------------------------------------------------------------------ escritório

const OFFICE: Kit = {
  paths: {
    carpet: { edge: '#22324f', fill: '#34486a', lit: '#d4a849', dash: '#d4a849', dashes: 'stripes' },
    walk: { edge: '#5f4a36', fill: '#9a8260', lit: '#c9a86a' }
  },
  // Sem gaveteiros de enfeite: o arquivo de gavetas de verdade (histórico de chamados) fica no canto direito.
  decor: [
    { kind: 'plant', w: 22, h: 34, count: 2, prefer: 'edges' },
    { kind: 'cooler', w: 20, h: 40, count: 1, prefer: 'edges' },
    { kind: 'printer', w: 28, h: 26, count: 1, prefer: 'edges' }
  ],
  build(W, H, decor, r) {
    const cx = Math.round(W / 2)
    const windows = wallWindows(W, 80)
    return {
      vignette: 'rgba(0,0,0,0.26)',
      paint(px, g) {
        px(0, 0, W, 64, '#2f3a58')
        for (let i = 0; i < W; i += 4) px(i, 0, 1, 64, 'rgba(255,255,255,0.025)')
        px(0, 64, W, 14, '#4c3a2c')
        px(0, 64, W, 1, '#6a523d')
        for (let j = 0; j < W; j += 24) px(j, 66, 1, 11, '#3d2f24')
        px(0, 78, W, 3, '#2a2019')
        px(0, FLOOR_TOP, W, H - FLOOR_TOP, '#6b5340')
        planks(px, W, H, r, ['#6f5642', '#664f3c', '#735a45'], '#4f3c2d', '#54402f')
        windowBeams(g, windows)
        // pôster, relógio e prateleira de livros no meio da parede
        px(cx - 60, 12, 30, 38, '#1c2338')
        px(cx - 58, 14, 26, 34, '#ece8dc')
        for (let s = 0; s < 5; s++) px(cx - 55, 22 + s * 3, 20, 1, '#8d8573')
        px(cx - 52, 36, 14, 2, '#d4a849')
        px(cx - 41, 34, 3, 2, '#d4a849')
        clockFace(px, cx + 2, 12)
        px(cx + 34, 44, 60, 3, '#6a523d')
        const books = ['#c0392b', '#2f62c9', '#d4a849', '#59b37a', '#7e6bd6', '#e0884f', '#ece8dc', '#3fa6a6', '#b48ead']
        books.forEach((b, i) => px(cx + 36 + i * 6, 34 + (i % 3), 5, 10 - (i % 3), b))
        for (const d of decor) {
          if (d.kind === 'plant') plant(px, d.x, d.y)
          else if (d.kind === 'cooler') cooler(px, d.x, d.y)
          else if (d.kind === 'printer') {
            shadow(px, d.x + 14, d.y + 25, 13, 2)
            px(d.x + 2, d.y + 14, 24, 4, '#4a5163')
            px(d.x + 4, d.y + 18, 2, 7, '#3a4050')
            px(d.x + 22, d.y + 18, 2, 7, '#3a4050')
            px(d.x, d.y + 2, 28, 12, '#d9dde5')
            px(d.x, d.y + 2, 28, 3, '#eef0f4')
            px(d.x + 5, d.y, 18, 3, '#f4f1e8')
            px(d.x + 4, d.y + 9, 20, 2, '#9aa3b5')
            px(d.x + 23, d.y + 6, 2, 1, '#59b37a')
          }
        }
      },
      back(px, _g, t) {
        for (const wx of windows) drawWindow(px, wx, 10, t)
        clockHand(px, cx + 2, 12, t)
      }
    }
  }
}

// ------------------------------------------------------------------ campo florido

const FLOWER_COLORS = ['#f4f1e8', '#f7d046', '#e5534b', '#e98fc4', '#b18cf0', '#ffa94d'] as const

function flower(px: Px, x: number, y: number, c: string, center: string): void {
  px(x - 1, y, 3, 1, c)
  px(x, y - 1, 1, 3, c)
  px(x, y, 1, 1, center)
}

const GARDEN: Kit = {
  paths: {
    carpet: { edge: '#6b6458', fill: '#a39b8b', lit: '#e8d9a8', dash: '#8c8475', dashes: 'stones' },
    walk: { edge: '#7a5a38', fill: '#a07b52', lit: '#d9b47a' }
  },
  decor: [
    { kind: 'pond', w: 62, h: 30, count: 1, prefer: 'spread' },
    { kind: 'tree', w: 40, h: 60, count: 5, prefer: 'edges' },
    { kind: 'pine', w: 28, h: 56, count: 3, prefer: 'edges' },
    { kind: 'bench', w: 32, h: 16, count: 1, prefer: 'spread' },
    { kind: 'flowerbed', w: 30, h: 14, count: 3, prefer: 'spread' },
    { kind: 'bush', w: 26, h: 16, count: 6, prefer: 'edges' },
    { kind: 'rock', w: 16, h: 10, count: 4, prefer: 'spread' }
  ],
  build(W, H, decor, r) {
    const butterflies = Array.from({ length: 6 }, (_, i) => ({ c: of(i, ['#f7d046', '#e98fc4', '#8fc3ec', '#ffffff', '#ffa94d']), p: r() * 10, y: FLOOR_TOP + 20 + r() * (H - FLOOR_TOP - 40) }))
    return {
      vignette: 'rgba(10,40,10,0.18)',
      paint(px) {
        // fundo: mata fechada vista de frente e uma cerca viva (sem céu, para manter a vista de cima)
        px(0, 0, W, FLOOR_TOP, '#244f2c')
        for (let x = -10; x < W + 20; x += 14 + r() * 10) {
          const cy = 12 + r() * 12
          const ry = 12 + Math.round(r() * 6)
          ellipse(px, Math.round(x), Math.round(cy), 16 + Math.round(r() * 6), ry, '#2f6e3a')
          ellipse(px, Math.round(x) - 3, Math.round(cy) - 3, 10, Math.round(ry * 0.6), '#3a7d42')
        }
        for (let x = -10; x < W + 20; x += 16 + r() * 12) {
          const cy = Math.round(38 + r() * 10)
          ellipse(px, Math.round(x), cy, 18 + Math.round(r() * 6), 14 + Math.round(r() * 4), '#3f8f4a')
          ellipse(px, Math.round(x) - 5, cy - 5, 9, 6, '#59b35f')
        }
        px(0, 62, W, 14, '#3a8444')
        for (let x = 0; x < W; x += 10) ellipse(px, x + 5, 62, 6, 3, '#4c9a52')
        for (let i = 0; i < W / 9; i++) px(Math.round(r() * W), 60 + Math.round(r() * 12), 1, 1, pick(r, ['#f4f1e8', '#e98fc4', '#f7d046']))
        px(0, 76, W, 2, '#2f6e3a')
        px(0, 78, W, 3, '#4f9a3e')
        // grama, manchas, tufos e canteiros de flores
        px(0, FLOOR_TOP, W, H - FLOOR_TOP, '#6dbb53')
        for (let i = 0; i < (W * H) / 9000; i++) ellipse(px, Math.round(r() * W), Math.round(FLOOR_TOP + r() * (H - FLOOR_TOP)), 14 + Math.round(r() * 20), 6 + Math.round(r() * 8), '#76c35b')
        for (let i = 0; i < (W * H) / 45; i++) {
          const x = Math.round(r() * W)
          const y = Math.round(FLOOR_TOP + r() * (H - FLOOR_TOP))
          if (r() < 0.5) px(x, y, 1, 2, '#5aa846')
          else px(x, y, 2, 1, '#84ce66')
        }
        for (let c = 0; c < (W * H) / 5500; c++) {
          const cx = r() * W
          const cy = FLOOR_TOP + 6 + r() * (H - FLOOR_TOP - 10)
          const col = pick(r, FLOWER_COLORS)
          const center = col === '#f7d046' ? '#8d5a2b' : '#f7d046'
          for (let k = 0; k < 6 + r() * 8; k++) flower(px, Math.round(cx + (r() - 0.5) * 28), Math.round(cy + (r() - 0.5) * 16), col, center)
        }
        for (const d of decor) {
          const { x, y, v } = d
          if (d.kind === 'tree') {
            shadow(px, x + 20, y + 57, 16, 3)
            px(x + 17, y + 38, 7, 20, '#6b4226')
            px(x + 21, y + 38, 3, 20, '#5a3620')
            ellipse(px, x + 20, y + 21, 19, 17, '#2f6e3a')
            ellipse(px, x + 20, y + 20, 17, 15, '#3f8f4a')
            ellipse(px, x + 14, y + 14, 8, 6, '#59b35f')
            const fruit = v % 3 === 0 ? '#e5534b' : v % 3 === 1 ? '#f4b6d2' : null
            if (fruit) for (const [fx, fy] of [[10, 22], [24, 12], [28, 26], [16, 30], [30, 18]] as const) px(x + fx, y + fy, 2, 2, fruit)
          } else if (d.kind === 'pine') {
            shadow(px, x + 14, y + 54, 12, 3)
            px(x + 12, y + 44, 4, 11, '#5a3620')
            for (let k = 0; k < 5; k++) {
              const w = 8 + k * 5
              px(x + 14 - w / 2, y + 4 + k * 8, w, 10, '#2a5f33')
              px(x + 14 - w / 2, y + 4 + k * 8, Math.round(w / 2), 3, '#3f8f4a')
            }
            px(x + 12, y, 4, 6, '#2a5f33')
          } else if (d.kind === 'bush') {
            shadow(px, x + 13, y + 15, 12, 2)
            ellipse(px, x + 13, y + 9, 13, 7, '#3f8f4a')
            ellipse(px, x + 10, y + 7, 6, 3, '#59b35f')
            if (v % 2 === 0) for (const [fx, fy] of [[6, 8], [14, 5], [19, 10]] as const) px(x + fx, y + fy, 2, 2, of(v, FLOWER_COLORS))
          } else if (d.kind === 'rock') {
            shadow(px, x + 8, y + 9, 8, 2)
            ellipse(px, x + 8, y + 5, 8, 5, '#8d8f99')
            ellipse(px, x + 6, y + 3, 4, 2, '#a8abb5')
            px(x + 3, y + 8, 10, 1, '#6b6d76')
          } else if (d.kind === 'pond') {
            ellipse(px, x + 31, y + 15, 31, 14, '#7d7466')
            ellipse(px, x + 31, y + 15, 28, 12, '#3f7fb8')
            ellipse(px, x + 29, y + 13, 24, 9, '#4a90c9')
            ellipse(px, x + 18, y + 16, 5, 3, '#3f8f4a')
            ellipse(px, x + 42, y + 11, 4, 2, '#3f8f4a')
            px(x + 18, y + 14, 1, 2, '#e98fc4')
          } else if (d.kind === 'bench') {
            shadow(px, x + 16, y + 15, 15, 2)
            px(x, y, 32, 3, '#9b7650')
            px(x, y + 5, 32, 5, '#b8916a')
            px(x, y + 10, 32, 3, '#8a6440')
            px(x + 2, y + 13, 2, 3, '#5a3f28')
            px(x + 28, y + 13, 2, 3, '#5a3f28')
          } else if (d.kind === 'flowerbed') {
            px(x, y + 2, 30, 12, '#8a6440')
            px(x + 2, y + 3, 26, 8, '#6b4a2e')
            for (let k = 0; k < 9; k++) flower(px, x + 4 + (k % 5) * 5 + (k > 4 ? 2 : 0), y + 5 + (k > 4 ? 4 : 0), of(v + k, FLOWER_COLORS), '#f7d046')
          }
        }
      },
      back(px, _g, t) {
        for (const d of decor) {
          if (d.kind !== 'pond') continue
          for (let k = 0; k < 3; k++) {
            const p = (t * 0.35 + k / 3) % 1
            px(d.x + 12 + Math.round(p * 34), d.y + 10 + k * 4, 4, 1, `rgba(255,255,255,${(0.5 * Math.sin(p * Math.PI)).toFixed(2)})`)
          }
        }
      },
      front(px, _g, t) {
        butterflies.forEach((b, i) => {
          const x = (((b.p + t * 0.06 + i * 0.17) % 1) * (W + 40)) - 20 + Math.sin(t * 1.3 + i) * 12
          const y = b.y + Math.sin(t * 0.9 + b.p * 3) * 18
          const open = Math.floor(t * 9 + i) % 2 === 0
          px(x, y, 1, 2, '#3b2a1e')
          if (open) {
            px(x - 2, y - 1, 2, 2, b.c)
            px(x + 1, y - 1, 2, 2, b.c)
          } else {
            px(x - 1, y - 1, 1, 2, b.c)
            px(x + 1, y - 1, 1, 2, b.c)
          }
        })
      }
    }
  }
}

// ------------------------------------------------------------------ refeitório

const FOODS = ['#e0884f', '#59b37a', '#f4d35e', '#8b4a2b', '#e5534b', '#f4f1e8'] as const

const CAFETERIA: Kit = {
  paths: {
    carpet: { edge: '#2b2f38', fill: '#3e4450', lit: '#f4d35e', dash: '#f4d35e', dashes: 'stripes' },
    walk: { edge: '#8d95a6', fill: '#b9c0cf', lit: '#eef0f4' }
  },
  decor: [
    { kind: 'vending', w: 24, h: 42, count: 2, prefer: 'wall' },
    { kind: 'fridge', w: 22, h: 42, count: 1, prefer: 'wall' },
    { kind: 'table', w: 44, h: 32, count: 5, prefer: 'spread' },
    { kind: 'bins', w: 34, h: 18, count: 1, prefer: 'edges' },
    { kind: 'plant', w: 22, h: 34, count: 2, prefer: 'edges' },
    { kind: 'cooler', w: 20, h: 40, count: 1, prefer: 'edges' }
  ],
  build(W, H, decor) {
    const cx = Math.round(W / 2)
    const c0 = Math.round(W * 0.16)
    const c1 = Math.round(W * 0.84)
    const pans: { x: number; food: string }[] = []
    for (let x = c0 + 6, i = 0; x + 20 < c1 - 4; x += 26, i++) pans.push({ x, food: of(i, FOODS) })
    return {
      vignette: 'rgba(0,0,0,0.16)',
      paint(px) {
        // parede de azulejos com faixa colorida
        px(0, 0, W, 64, '#e8e4d8')
        for (let x = 0; x < W; x += 8) px(x, 0, 1, 64, '#d6d0c0')
        for (let y = 0; y < 64; y += 8) px(0, y, W, 1, '#d6d0c0')
        px(0, 40, W, 6, '#3fa6a6')
        for (let x = 0; x < W; x += 8) px(x, 40, 1, 6, '#2f8a8a')
        px(0, 64, W, 14, '#8d95a6')
        px(0, 64, W, 1, '#b9c0cf')
        px(0, 78, W, 3, '#4a5163')
        // quadros de cardápio nas pontas
        for (const bx of [10, W - 66]) {
          if (bx < 0 || (bx > c0 - 56 && bx < c1)) continue
          px(bx, 6, 56, 34, '#6b4a2e')
          px(bx + 2, 8, 52, 30, '#2f4a3a')
          px(bx + 6, 11, 22, 3, '#f4d35e')
          for (let k = 0; k < 5; k++) {
            px(bx + 6, 17 + k * 4, 18 + ((k * 7) % 16), 1, '#e8efe8')
            px(bx + 42, 17 + k * 4, 6, 1, '#e8efe8')
          }
        }
        // balcão do bufê com cubas de comida e protetor de vidro
        px(c0, 46, c1 - c0, 2, 'rgba(200,230,255,0.55)')
        for (let x = c0; x <= c1; x += 52) px(x, 46, 1, 8, '#b9c0cf')
        px(c0, 54, c1 - c0, 9, '#c9ced8')
        px(c0, 54, c1 - c0, 1, '#eef0f4')
        px(c0, 63, c1 - c0, 15, '#8d95a6')
        for (let x = c0; x < c1; x += 32) px(x, 64, 1, 14, '#7a8293')
        for (const p of pans) {
          px(p.x, 55, 20, 7, '#6b7385')
          px(p.x + 1, 56, 18, 4, p.food)
          px(p.x + 2, 56, 6, 1, shade(p.food, 1.3))
        }
        clockFace(px, cx - 9, 6)
        px(0, FLOOR_TOP, W, H - FLOOR_TOP, '#b3ab99')
        for (let y = FLOOR_TOP; y < H; y += 12) {
          for (let x = 0; x < W; x += 12) {
            const light = ((x + y) / 12) % 2 === 0
            px(x, y, 11, 11, light ? '#dcd6c8' : '#c4bcab')
            if (light) px(x, y, 11, 1, 'rgba(255,255,255,0.25)')
          }
        }
        for (const d of decor) {
          const { x, y, v } = d
          if (d.kind === 'plant') plant(px, x, y)
          else if (d.kind === 'cooler') cooler(px, x, y)
          else if (d.kind === 'table') {
            const stool = of(v, ['#c0392b', '#2f62c9', '#d4a849', '#3f8f4a'])
            shadow(px, x + 22, y + 30, 20, 2)
            px(x + 8, y, 10, 5, stool)
            px(x + 26, y, 10, 5, stool)
            px(x + 2, y + 6, 40, 14, '#ece8dc')
            px(x + 2, y + 6, 40, 1, '#ffffff')
            px(x + 2, y + 20, 40, 4, '#b8ae97')
            px(x + 5, y + 24, 3, 5, '#6b7385')
            px(x + 36, y + 24, 3, 5, '#6b7385')
            px(x + 8, y + 26, 10, 5, shade(stool, 0.85))
            px(x + 26, y + 26, 10, 5, shade(stool, 0.85))
            px(x + 8, y + 8, 13, 9, '#5b8def')
            px(x + 10, y + 9, 9, 7, '#ffffff')
            px(x + 12, y + 11, 4, 3, of(v, FOODS))
            if (v % 2 === 0) {
              px(x + 25, y + 8, 13, 9, '#e0884f')
              px(x + 27, y + 9, 9, 7, '#ffffff')
              px(x + 29, y + 11, 4, 3, of(v + 2, FOODS))
            }
          } else if (d.kind === 'vending') {
            const body = of(v, ['#c0392b', '#2f62c9'])
            shadow(px, x + 12, y + 41, 12, 2)
            px(x, y, 24, 42, body)
            px(x, y, 24, 3, shade(body, 1.25))
            px(x + 20, y + 3, 4, 39, shade(body, 0.75))
            px(x + 3, y + 5, 14, 26, '#2b3245')
            for (let row = 0; row < 4; row++) for (let k = 0; k < 3; k++) px(x + 5 + k * 4, y + 7 + row * 6, 3, 4, of(row * 3 + k + v, FOODS))
            px(x + 17, y + 8, 3, 10, '#1b1e28')
            px(x + 3, y + 34, 14, 4, '#1b1e28')
          } else if (d.kind === 'fridge') {
            shadow(px, x + 11, y + 41, 11, 2)
            px(x, y, 22, 42, '#e8eef4')
            px(x + 18, y, 4, 42, '#c9d2dc')
            px(x + 1, y + 14, 17, 1, '#b9c0cf')
            px(x + 15, y + 5, 2, 6, '#8d95a6')
            px(x + 15, y + 18, 2, 10, '#8d95a6')
            px(x + 3, y + 22, 6, 4, '#f4d35e')
          } else if (d.kind === 'bins') {
            ;['#2f62c9', '#3f8f4a', '#d4a849'].forEach((c, k) => {
              const bx = x + k * 12
              shadow(px, bx + 5, y + 17, 6, 1)
              px(bx, y + 4, 10, 14, c)
              px(bx - 1, y + 2, 12, 3, shade(c, 0.8))
              px(bx + 4, y + 9, 2, 2, '#f4f1e8')
            })
          }
        }
      },
      back(px, _g, t) {
        pans.forEach((p, i) => (p.food === '#f4d35e' || i % 2 === 0) && steam(px, p.x + 6, 54, t + i * 0.4))
        clockHand(px, cx - 9, 6, t)
        for (const d of decor) {
          if (d.kind !== 'vending') continue
          px(d.x + 18, d.y + 10, 1, 1, Math.floor(t * 2 + d.v) % 2 ? '#59e36a' : '#1b1e28')
          px(d.x + 18, d.y + 13, 1, 1, Math.floor(t * 3 + d.v) % 3 === 0 ? '#e5534b' : '#1b1e28')
        }
      }
    }
  }
}

// ------------------------------------------------------------------ sala de descanso

const BREAK_ROOM: Kit = {
  paths: {
    carpet: { edge: '#6b2e1e', fill: '#a5532b', lit: '#f0a060', dash: '#d4a849', dashes: 'dots' },
    walk: { edge: '#8a6a4f', fill: '#c9b28f', lit: '#ece0c2' }
  },
  decor: [
    { kind: 'rug', w: 60, h: 30, count: 2, prefer: 'spread' },
    { kind: 'bookshelf', w: 32, h: 42, count: 1, prefer: 'wall' },
    { kind: 'arcade', w: 22, h: 40, count: 1, prefer: 'wall' },
    { kind: 'coffee', w: 34, h: 30, count: 1, prefer: 'wall' },
    { kind: 'sofa', w: 56, h: 28, count: 1, prefer: 'edges' },
    { kind: 'foosball', w: 48, h: 28, count: 1, prefer: 'spread' },
    { kind: 'beanbag', w: 20, h: 16, count: 3, prefer: 'spread' },
    { kind: 'lamp', w: 12, h: 38, count: 1, prefer: 'edges' },
    { kind: 'plant', w: 22, h: 34, count: 2, prefer: 'edges' }
  ],
  build(W, H, decor, r) {
    const cx = Math.round(W / 2)
    const windows = wallWindows(W, 40)
    const pictures = [cx - 90, cx + 64].filter((x) => x > 80 && x + 26 < W - 80)
    const dart = W > 420 ? Math.round(W * 0.62) : -1
    return {
      vignette: 'rgba(40,20,0,0.24)',
      paint(px, g) {
        px(0, 0, W, 46, '#35606b')
        for (let y = 4; y < 44; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < W; x += 8) px(x, y, 1, 1, 'rgba(255,255,255,0.07)')
        px(0, 44, W, 2, '#8a6a4f')
        px(0, 46, W, 32, '#6b4f3a')
        for (let x = 0; x < W; x += 28) {
          px(x + 3, 50, 22, 24, '#5f4532')
          px(x + 3, 50, 22, 1, '#7d5d45')
        }
        px(0, 78, W, 3, '#2e2118')
        px(0, FLOOR_TOP, W, H - FLOOR_TOP, '#9c7249')
        planks(px, W, H, r, ['#a87d55', '#9c7249', '#b0855b'], '#7d5638', '#835c3c')
        windowBeams(g, windows)
        for (const wx of windows) {
          px(wx - 6, 6, 6, 44, '#c2507a')
          px(wx + 48, 6, 6, 44, '#c2507a')
          px(wx - 8, 4, 64, 3, '#5a4130')
        }
        // TV no meio, quadros e alvo de dardos
        px(cx - 31, 5, 62, 38, '#11141c')
        px(cx - 12, 43, 24, 2, '#11141c')
        for (const x of pictures) {
          px(x, 12, 26, 20, '#8a6a4f')
          px(x + 2, 14, 22, 16, '#9fc6e8')
          px(x + 2, 24, 22, 6, '#59b37a')
          ellipse(px, x + 17, 18, 3, 3, '#f7d046')
        }
        if (dart > 0) {
          ellipse(px, dart, 22, 8, 8, '#1b1e28')
          ellipse(px, dart, 22, 6, 6, '#e5534b')
          ellipse(px, dart, 22, 4, 4, '#f4f1e8')
          ellipse(px, dart, 22, 2, 2, '#59b37a')
        }
        for (const d of decor) {
          const { x, y, v } = d
          if (d.kind === 'plant') plant(px, x, y)
          else if (d.kind === 'rug') {
            const [a, b] = of(v, [['#a5532b', '#d4a849'], ['#7a3b5f', '#c2507a'], ['#3f6b4a', '#8fbf7a'], ['#8a5a2b', '#e0b070']] as const)
            // tapete retangular visto de cima, com borda, losangos e franjas nas pontas
            px(x + 3, y, 54, 30, a)
            px(x + 6, y + 3, 48, 24, b)
            for (let k = 0; k < 4; k++) {
              const dx = x + 12 + k * 12
              px(dx + 2, y + 10, 2, 10, a)
              px(dx, y + 13, 6, 4, a)
            }
            for (let j = y + 1; j < y + 30; j += 3) {
              px(x, j, 3, 1, '#ece0c2')
              px(x + 57, j, 3, 1, '#ece0c2')
            }
          } else if (d.kind === 'sofa') {
            const [dark, mid, light] = of(v, [['#3e6fc9', '#5b8def', '#7fa6f2'], ['#9a3b5f', '#c2507a', '#de7aa0'], ['#3f8f5a', '#59b37a', '#7fcf98']] as const)
            shadow(px, x + 28, y + 27, 27, 2)
            px(x, y, 56, 12, dark)
            px(x, y, 56, 2, light)
            px(x + 4, y + 12, 48, 8, mid)
            px(x + 28, y + 12, 1, 8, dark)
            px(x, y + 8, 6, 16, dark)
            px(x + 50, y + 8, 6, 16, dark)
            px(x + 4, y + 20, 48, 5, shade(dark, 0.8))
            px(x + 8, y + 7, 9, 6, '#f4d35e')
            px(x + 40, y + 7, 9, 6, '#f4f1e8')
            px(x + 3, y + 25, 3, 3, '#3a2a1e')
            px(x + 50, y + 25, 3, 3, '#3a2a1e')
          } else if (d.kind === 'beanbag') {
            const c = of(v, ['#e0884f', '#7e6bd6', '#d4a849', '#3fa6a6'])
            shadow(px, x + 10, y + 14, 9, 2)
            ellipse(px, x + 10, y + 9, 10, 6, c)
            ellipse(px, x + 8, y + 6, 5, 3, shade(c, 1.25))
          } else if (d.kind === 'foosball') {
            shadow(px, x + 24, y + 27, 22, 2)
            px(x, y + 4, 48, 18, '#6b4a2e')
            px(x, y + 4, 48, 2, '#8a6440')
            px(x + 3, y + 6, 42, 14, '#3f8f4a')
            px(x + 24, y + 6, 1, 14, '#f4f1e8')
            px(x + 3, y + 10, 2, 6, '#f4f1e8')
            px(x + 43, y + 10, 2, 6, '#f4f1e8')
            for (let k = 0; k < 4; k++) {
              const rx = x + 9 + k * 10
              px(rx, y + 1, 1, 24, '#b9c0cf')
              for (let m = 0; m < 2; m++) px(rx - 1, y + 9 + m * 5, 3, 2, k % 2 ? '#2f62c9' : '#c0392b')
            }
            px(x + 3, y + 22, 3, 6, '#4a3626')
            px(x + 42, y + 22, 3, 6, '#4a3626')
          } else if (d.kind === 'arcade') {
            shadow(px, x + 11, y + 39, 11, 2)
            px(x, y, 22, 40, '#2b3245')
            px(x + 18, y, 4, 40, '#1f2433')
            px(x + 2, y + 2, 16, 5, '#e5534b')
            px(x + 3, y + 8, 14, 11, '#0b0d13')
            px(x + 1, y + 21, 18, 6, '#3d4660')
            px(x + 5, y + 19, 2, 3, '#c0392b')
            px(x + 11, y + 23, 2, 2, '#f7d046')
            px(x + 14, y + 23, 2, 2, '#5b8def')
            px(x + 6, y + 31, 8, 4, '#1b1e28')
          } else if (d.kind === 'coffee') {
            shadow(px, x + 17, y + 29, 16, 2)
            px(x, y + 12, 34, 6, '#b8916a')
            px(x, y + 12, 34, 1, '#d4ad82')
            px(x, y + 18, 34, 11, '#8a6440')
            px(x + 4, y, 12, 14, '#1b1e28')
            px(x + 4, y, 12, 2, '#3a4050')
            px(x + 7, y + 8, 6, 3, '#5a3620')
            px(x + 20, y + 8, 4, 4, '#f4f1e8')
            px(x + 26, y + 9, 4, 3, '#e5534b')
          } else if (d.kind === 'bookshelf') {
            shadow(px, x + 16, y + 41, 15, 2)
            px(x, y, 32, 42, '#6b4a2e')
            px(x, y, 32, 2, '#8a6440')
            for (let s = 0; s < 3; s++) {
              px(x + 2, y + 3 + s * 13, 28, 11, '#3a2a1e')
              let bx = x + 3
              while (bx < x + 28) {
                const bw = 2 + ((bx * 7 + s * 3 + v) % 3)
                px(bx, y + 5 + s * 13 + ((bx + s) % 2), bw, 9 - ((bx + s) % 2), of(bx + s + v, ['#c0392b', '#2f62c9', '#d4a849', '#59b37a', '#7e6bd6', '#ece8dc']))
                bx += bw + 1
              }
            }
          } else if (d.kind === 'lamp') {
            shadow(px, x + 6, y + 37, 6, 2)
            px(x + 2, y + 35, 8, 3, '#2b2b2b')
            px(x + 5, y + 10, 2, 26, '#3a3a3a')
            px(x, y + 2, 12, 9, '#f4d35e')
            px(x + 2, y, 8, 3, '#e0c04a')
          }
        }
      },
      back(px, g, t) {
        // TV com uma partida de pong
        const sx = cx - 28
        const sy = 8
        px(sx, sy, 56, 32, '#0b1d2b')
        const bx = sx + 3 + Math.round(tri(t * 0.7) * 48)
        const by = sy + 2 + Math.round(tri(t * 1.1) * 27)
        px(bx, by, 2, 2, '#f4f1e8')
        px(sx + 1, Math.min(sy + 24, Math.max(sy + 1, by - 3)), 1, 7, '#8fc3ec')
        px(sx + 54, Math.min(sy + 24, Math.max(sy + 1, by - 4)), 1, 7, '#e98fc4')
        for (let k = 0; k < 8; k++) px(sx + 27, sy + 2 + k * 4, 1, 2, 'rgba(255,255,255,0.25)')
        // varal de luzes piscando
        for (let x = 4, i = 0; x < W; x += 12, i++) {
          const y = 3 + Math.round(2 * Math.sin(x * 0.05))
          px(x, y - 1, 1, 1, '#2b2b2b')
          const on = Math.sin(t * 3 + i * 1.7) > -0.3
          const c = of(i, ['#f7d046', '#e5534b', '#59b37a', '#5b8def', '#e98fc4'])
          px(x, y, 2, 2, on ? c : shade(c, 0.45))
        }
        for (const d of decor) {
          if (d.kind === 'arcade') {
            px(d.x + 3, d.y + 8, 14, 11, '#0b0d13')
            const ax = d.x + 4 + Math.round(tri(t * 0.9) * 10)
            px(ax, d.y + 15, 2, 2, '#f7d046')
            px(d.x + 4 + ((Math.floor(t * 4) * 3) % 12), d.y + 10, 1, 1, '#e5534b')
            px(d.x + 2, d.y + 2, 16, 5, Math.floor(t * 2) % 2 ? '#e5534b' : '#ff7a6b')
          } else if (d.kind === 'coffee') steam(px, d.x + 20, d.y + 7, t)
          else if (d.kind === 'lamp') {
            const grd = g.createRadialGradient(d.x + 6, d.y + 8, 2, d.x + 6, d.y + 8, 34)
            grd.addColorStop(0, 'rgba(255,214,140,0.22)')
            grd.addColorStop(1, 'rgba(255,214,140,0)')
            g.fillStyle = grd
            g.fillRect(d.x - 30, d.y - 26, 72, 72)
          }
        }
      }
    }
  }
}

// ------------------------------------------------------------------ inferno

function crackPath(r: () => number, W: number, H: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  let x = r() * W
  let y = FLOOR_TOP + 8 + r() * (H - FLOOR_TOP - 12)
  const dir = r() < 0.5 ? -1 : 1
  for (let k = 0, n = 30 + r() * 60; k < n; k++) {
    pts.push({ x: Math.round(x), y: Math.round(y) })
    x += dir * (1 + Math.round(r()))
    y += r() < 0.35 ? (r() < 0.5 ? -1 : 1) : 0
    if (y < FLOOR_TOP + 4 || y > H - 3 || x < 0 || x > W) break
  }
  return pts
}

const INFERNO: Kit = {
  paths: {
    carpet: { edge: '#0d0505', fill: '#2a1010', lit: '#ff7a1a', dash: '#ff7a1a', dashes: 'stripes' },
    walk: { edge: '#1a0606', fill: '#5a2a1a', lit: '#ff9a3a' }
  },
  decor: [
    { kind: 'lavapool', w: 46, h: 22, count: 3, prefer: 'spread' },
    { kind: 'cauldron', w: 26, h: 26, count: 1, prefer: 'edges' },
    { kind: 'brazier', w: 12, h: 30, count: 4, prefer: 'edges' },
    { kind: 'stalagmite', w: 16, h: 30, count: 5, prefer: 'edges' },
    { kind: 'pitchfork', w: 12, h: 34, count: 1, prefer: 'spread' },
    { kind: 'skull', w: 11, h: 10, count: 5, prefer: 'spread' },
    { kind: 'bones', w: 16, h: 8, count: 3, prefer: 'spread' }
  ],
  build(W, H, decor, r) {
    const falls = [Math.round(W * 0.12 + r() * W * 0.1), Math.round(W * 0.78 + r() * W * 0.1)]
    const eyes = Array.from({ length: Math.max(3, Math.round(W / 160)) }, () => ({ x: Math.round(r() * (W - 10)), y: Math.round(8 + r() * 40), p: r() * 10 }))
    const cracks = Array.from({ length: Math.round((W * H) / 6000) + 6 }, () => crackPath(r, W, H))
    const embers = Array.from({ length: Math.round(W / 5) }, (_, i) => ({ x: r() * W, s: 10 + r() * 24, o: r() * 400, c: of(i, ['#ffd23f', '#ff7a1a', '#ff4a1a']), big: i % 3 === 0 }))
    // Brilho das rachaduras numa camada separada: pulsa sem redesenhar pixel a pixel.
    const glow = document.createElement('canvas')
    glow.width = W
    glow.height = H
    const gg = glow.getContext('2d')!
    const gpx = makePx(gg)
    for (const c of cracks) {
      for (const p of c) {
        gpx(p.x - 1, p.y - 2, 3, 5, 'rgba(255,90,0,0.18)')
        gpx(p.x, p.y, 1, 2, '#ff6a00')
        gpx(p.x, p.y - 1, 1, 1, '#ffb000')
      }
    }
    return {
      vignette: 'rgba(40,0,0,0.55)',
      paint(px) {
        // parede da caverna (de frente) com blocos de rocha
        px(0, 0, W, FLOOR_TOP, '#2a0b0a')
        for (const row of [0, 16, 32, 48]) {
          let x = -Math.floor(r() * 20)
          while (x < W) {
            const w = 14 + Math.round(r() * 22)
            const h = 14 + Math.round(r() * 8)
            const y = row + Math.round(r() * 5)
            px(x, y, w - 2, h, pick(r, ['#3d1210', '#45140f', '#36100e']))
            px(x, y, w - 2, 1, '#5a1c15')
            px(x, y + h - 1, w - 2, 1, '#1f0807')
            x += w
          }
        }
        for (const fx of falls) {
          px(fx - 2, 0, 10, 68, '#4a0f08')
          px(fx, 0, 6, 68, '#ff6a00')
        }
        px(0, 66, W, 15, '#1a0606')
        px(0, 66, W, 1, '#3d1210')
        // chão de rocha vulcânica com rachaduras
        px(0, FLOOR_TOP, W, H - FLOOR_TOP, '#3a1210')
        for (let i = 0; i < (W * H) / 7000; i++) ellipse(px, Math.round(r() * W), Math.round(FLOOR_TOP + r() * (H - FLOOR_TOP)), 10 + Math.round(r() * 16), 4 + Math.round(r() * 6), '#45160f')
        for (let i = 0; i < (W * H) / 60; i++) {
          const x = Math.round(r() * W)
          const y = Math.round(FLOOR_TOP + r() * (H - FLOOR_TOP))
          px(x, y, r() < 0.5 ? 2 : 1, 1, r() < 0.5 ? '#4a1a14' : '#2c0c0b')
        }
        for (const c of cracks) for (const p of c) px(p.x, p.y + 2, 1, 1, '#1a0606')
        for (const d of decor) {
          const { x, y } = d
          if (d.kind === 'lavapool') {
            ellipse(px, x + 23, y + 11, 23, 11, '#1a0606')
            ellipse(px, x + 23, y + 11, 20, 8, '#c0392b')
            ellipse(px, x + 23, y + 11, 17, 6, '#ff6a00')
            ellipse(px, x + 21, y + 10, 10, 3, '#ffb000')
          } else if (d.kind === 'skull') {
            shadow(px, x + 5, y + 9, 5, 1)
            px(x + 1, y, 9, 7, '#e8dcc8')
            px(x + 3, y + 7, 5, 2, '#e8dcc8')
            px(x + 2, y + 3, 2, 2, '#1a0606')
            px(x + 7, y + 3, 2, 2, '#1a0606')
            px(x + 5, y + 5, 1, 1, '#1a0606')
            px(x + 4, y + 8, 1, 1, '#8d8573')
            px(x + 6, y + 8, 1, 1, '#8d8573')
          } else if (d.kind === 'bones') {
            px(x + 1, y + 2, 14, 2, '#e8dcc8')
            px(x, y + 1, 2, 4, '#e8dcc8')
            px(x + 14, y + 1, 2, 4, '#e8dcc8')
            px(x + 5, y + 5, 8, 2, '#d6c8b0')
          } else if (d.kind === 'stalagmite') {
            shadow(px, x + 8, y + 29, 8, 2)
            px(x + 6, y, 4, 6, '#4f1813')
            px(x + 4, y + 6, 8, 8, '#4f1813')
            px(x + 2, y + 14, 12, 10, '#45140f')
            px(x, y + 24, 16, 6, '#3d1210')
            px(x + 4, y + 6, 1, 18, '#64201a')
            px(x + 8, y + 10, 1, 14, '#ff6a00')
          } else if (d.kind === 'pitchfork') {
            shadow(px, x + 6, y + 33, 5, 1)
            px(x + 5, y + 8, 2, 26, '#3b2a1e')
            px(x + 1, y + 7, 10, 2, '#8d8f99')
            px(x + 1, y, 2, 8, '#8d8f99')
            px(x + 5, y - 1, 2, 9, '#8d8f99')
            px(x + 9, y, 2, 8, '#8d8f99')
          } else if (d.kind === 'brazier') {
            shadow(px, x + 6, y + 29, 5, 1)
            px(x + 5, y + 12, 2, 18, '#2b2b2b')
            px(x + 2, y + 27, 8, 2, '#2b2b2b')
            px(x + 1, y + 9, 10, 4, '#3a3a3a')
            px(x + 1, y + 9, 10, 1, '#5a5a5a')
          } else if (d.kind === 'cauldron') {
            shadow(px, x + 13, y + 25, 12, 2)
            ellipse(px, x + 13, y + 16, 12, 8, '#1b1e28')
            px(x + 2, y + 9, 22, 3, '#2b3245')
            ellipse(px, x + 13, y + 10, 9, 2, '#59e36a')
            px(x + 4, y + 23, 2, 3, '#1b1e28')
            px(x + 20, y + 23, 2, 3, '#1b1e28')
          }
        }
      },
      back(px, g, t) {
        // cachoeiras de lava, olhos no escuro, brilho das rachaduras e chamas na base da parede
        for (const fx of falls) {
          for (let y = 0; y < 68; y += 4) px(fx + 1, y, 4, 2, Math.floor(y / 4 + t * 8) % 2 ? '#ffb000' : '#ff7a1a')
          flameRow(px, fx - 6, fx + 12, 70, t, 3, 5, fx)
        }
        for (const e of eyes) {
          const blink = (t * 0.45 + e.p) % 1 < 0.05
          if (!blink) {
            const c = Math.sin(t * 2 + e.p) > 0 ? '#ff2a2a' : '#c41a1a'
            px(e.x, e.y, 2, 1, c)
            px(e.x + 5, e.y, 2, 1, c)
          }
        }
        g.globalAlpha = 0.5 + 0.4 * Math.sin(t * 2.2)
        g.drawImage(glow, 0, 0)
        g.globalAlpha = 1
        flameRow(px, 0, W, FLOOR_TOP, t, 6, 14, 1)
        for (const d of decor) {
          if (d.kind === 'lavapool') {
            for (let k = 0; k < 3; k++) {
              const p = (t * 0.6 + k * 0.33 + d.v * 0.01) % 1
              const bx = d.x + 10 + ((k * 13 + d.v) % 26)
              if (p < 0.8) ellipse(px, bx, d.y + 10, 1 + Math.round(p * 2), 1, '#ffd23f')
              else px(bx - 1, d.y + 8, 3, 1, '#fff2a8')
            }
          } else if (d.kind === 'brazier') flameRow(px, d.x + 2, d.x + 11, d.y + 10, t, 4, 7, d.v)
          else if (d.kind === 'cauldron') {
            flameRow(px, d.x + 5, d.x + 22, d.y + 26, t, 2, 3, d.v)
            const p = (t * 0.9) % 1
            px(d.x + 9 + Math.round(p * 6), d.y + 9 - Math.round(p * 4), 2, 2, `rgba(130,255,140,${(1 - p).toFixed(2)})`)
          }
        }
      },
      front(px, g, t) {
        for (const e of embers) {
          const y = H - ((t * e.s + e.o) % (H + 20))
          const x = e.x + Math.sin(t * 1.3 + e.o) * 6
          g.globalAlpha = Math.max(0, Math.min(1, (y - FLOOR_TOP * 0.5) / (H * 0.6)))
          px(x, y, e.big ? 2 : 1, e.big ? 2 : 1, e.c)
        }
        g.globalAlpha = 1
        flameRow(px, 0, W, H + 2, t, 4, 12, 7)
        g.fillStyle = `rgba(255,60,0,${(0.05 + 0.03 * Math.sin(t * 11) + 0.02 * Math.sin(t * 17)).toFixed(3)})`
        g.fillRect(0, 0, W, H)
      }
    }
  }
}

const KITS: Record<OfficeSceneId, Kit> = {
  escritorio: OFFICE,
  jardim: GARDEN,
  refeitorio: CAFETERIA,
  descanso: BREAK_ROOM,
  inferno: INFERNO
}

/**
 * Cenário com uma imagem do usuário: cobre a sala inteira (cortando as sobras, como "cover") e é
 * reduzida para a grade da cena, então aparece com o mesmo tamanho de pixel dos agentes.
 */
export function createImageScenery(img: HTMLImageElement, W: number, H: number): SceneryRenderer {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const cg = canvas.getContext('2d')!
  const k = Math.max(W / img.naturalWidth, H / img.naturalHeight)
  const w = img.naturalWidth * k
  const h = img.naturalHeight * k
  cg.imageSmoothingEnabled = true
  cg.imageSmoothingQuality = 'high'
  cg.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
  return {
    paths: OFFICE.paths,
    back(g) {
      g.drawImage(canvas, 0, 0)
    },
    front(g) {
      vignette(g, W, H, 'rgba(0,0,0,0.2)')
    }
  }
}

/** Monta o cenário para uma sala W×H, com a decoração fora de `blocked` (mesas, quadros, tapetes). */
export function createScenery(id: OfficeSceneId, W: number, H: number, blocked: SceneRect[]): SceneryRenderer {
  const kit = KITS[id] ?? OFFICE
  const seed = seedOf(id)
  // Salas grandes ganham mais decoração (na mesma proporção da área; as de parede, da largura).
  const area = Math.min(5, Math.max(1, (W * H) / (640 * 360)))
  const wide = Math.min(3, Math.max(1, W / 640))
  const specs = kit.decor.map((d) => ({ ...d, count: Math.round(d.count * (d.prefer === 'wall' ? wide : area)) }))
  // Faixa da dica no canto de baixo à esquerda (texto sobre o desenho).
  const hint = { x0: 0, x1: W * 0.55, y0: H - 18, y1: H }
  const decor = placeDecor(specs, { width: W, height: H, floorTop: FLOOR_TOP + 3, blocked: [...blocked, hint], seed })
  const built = kit.build(W, H, decor, rng(seed))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const cg = canvas.getContext('2d')!
  built.paint(makePx(cg), cg)
  return {
    paths: kit.paths,
    back(g, px, t) {
      g.drawImage(canvas, 0, 0)
      built.back?.(px, g, t)
    },
    front(g, px, t) {
      built.front?.(px, g, t)
      vignette(g, W, H, built.vignette)
    }
  }
}
