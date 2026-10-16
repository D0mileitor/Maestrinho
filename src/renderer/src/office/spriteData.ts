import type { Look } from '@shared/schemas'

/**
 * Personagens 16×32 desenhados pixel a pixel. Cada letra é uma cor da paleta (derivada da aparência):
 * o contorno · s pele · z pele sombra · w brilho do olho · e olho · b bochecha · m boca
 * t camiseta · T sombra · L luz · p calça · q sombra · x cinto · f sapato · g brilho do sapato
 * h cabelo · k sombra · H luz · G lente · a fone · A detalhe do fone · c boné · C aba · y crachá · Y faixa · i cordão
 */

export type SpriteView = 'front' | 'back' | 'side' | 'cheer' | 'sit'

const FRONT = [
  '................',
  '................',
  '....oooooooo....',
  '...osssssssso...',
  '..osssssssssso..',
  '..osssssssssso..',
  '..osssssssssso..',
  '..osswesswesso..',
  '..osseesseesso..',
  '..osbssssssbso..',
  '..ossssmmsssso..',
  '...ozsssssszo...',
  '....oooooooo....',
  '......ozzo......',
  '..ootttsstttoo..',
  '.otLttttttttTto.',
  '.otLottttttoTto.',
  '.oTTottttttoTTo.',
  '.ossottttttosso.',
  '.ossotttttTosso.',
  '.ozzoxxxxxxozzo.',
  '..oooppppppooo..',
  '....oppppppo....',
  '....oppoopqo....',
  '....oppoopqo....',
  '....oppoopqo....',
  '....oqpoopqo....',
  '....oqpoopqo....',
  '...offfoofffo...',
  '...ogffoogffo...',
  '...oooooooooo...',
  '................'
]

const BACK = FRONT.map((r, i) => {
  if (i >= 7 && i <= 10) return '..osssssssssso..'
  if (i === 14) return '..oottttttttoo..'
  return r
})

const SIDE = [
  '................',
  '................',
  '.....ooooooo....',
  '....ossssssso...',
  '...ossssssssso..',
  '...ossssssssso..',
  '...ossssssssso..',
  '...osssssswesso.',
  '...osssssseesso.',
  '...ossssssbsso..',
  '...osssssssmso..',
  '....ozsssssszo..',
  '.....ooooooo....',
  '.......ozzo.....',
  '.....oottttoo...',
  '....otttttttTo..',
  '....otttTTttto..',
  '....otttTTttto..',
  '....otttssttto..',
  '....otttsstTTo..',
  '....oxxxzzxxxo..',
  '.....oppppppo...',
  '.....oppppppo...',
  '......opppqo....',
  '......opppqo....',
  '......opppqo....',
  '......oqppqo....',
  '......oqppqo....',
  '......offffffo..',
  '......ogfffffo..',
  '......oooooooo..',
  '................'
]

const SIDE_STRIDE = [
  '.....oppppppo...',
  '.....oppo.opo...',
  '....oppo...opo..',
  '....opo....oqpo.',
  '...oqpo.....oqpo',
  '...oqo......oqpo',
  '..offfo....offfo',
  '..ogffo....ogffo',
  '..ooooo....ooooo'
]

const HAIR: Record<Look['hairStyle'], { front: string[]; back: string[] }> = {
  curto: {
    front: ['................', '....oooooooo....', '...ohHHhhhhho...', '..ohHhhhhhhhko..', '..ohhhhhhhhhko..', '..ohkhhhhhkhko..', '..ok.k....k.ko..', '..ok........ko..'],
    back: ['................', '....oooooooo....', '...ohHHhhhhho...', '..ohHhhhhhhhko..', '..ohhhhhhhhhko..', '..ohhhhhhhhhko..', '..ohhhhhhhhhko..', '..ohhhhhhhhhko..', '..okhhhhhhhhko..', '..okkhhhhhhkko..', '...okkkkkkkko...']
  },
  longo: {
    front: ['................', '....oooooooo....', '...ohHHhhhhho...', '..ohHhhhhhhhko..', '.ohhhhhhhhhhhko.', '.ohhkhhhhhhkhko.', '.ohk........kho.', '.ohk........kho.', '.ohk........kho.', '.ohk........kho.', '.okk........kko.', '.okk........kko.', '.ok..........ko.', '.o............o.'],
    back: ['................', '....oooooooo....', '...ohHHhhhhho...', '..ohHhhhhhhhko..', '.ohhhhhhhhhhhko.', '.ohhhhhhhhhhhko.', '.ohhhhhhhhhhhko.', '.ohhhhhhhhhhhko.', '.ohhhhhhhhhhhko.', '.ohhhhhhhhhhhko.', '.ohhhhhhhhhhhko.', '.okhhhhhhhhhhko.', '.okhhhhhhhhhkko.', '.okhhhhhhhhhkko.', '.okhhhhhhhhhkko.', '..okkkkkkkkkko..', '...oooooooooo...']
  },
  cacheado: {
    front: ['....oooooooo....', '..ooHhhhhhHhoo..', '.ohHhhhhhhhhhko.', 'ohhhhHhhhhhHhhko', 'ohhhhhhhhhhhhhko', 'ohhkhhhhhhhhkhko', 'ohk..........kho', 'okk..........kko', '.ok..........ko.'],
    back: ['....oooooooo....', '..ooHhhhhhHhoo..', '.ohHhhhhhhhhhko.', 'ohhhhHhhhhhHhhko', 'ohhhhhhhhhhhhhko', 'ohhhhhkhhhhhhhko', 'ohhhhhhhhhkhhhko', 'ohhkhhhhhhhhhhko', 'ohhhhhhhhhhhhhko', 'okhhhhhhkhhhhhko', '.okhhhhhhhhhhko.', '..okkkkkkkkkko..', '...oooooooooo...']
  },
  coque: {
    front: ['......oooo......', '....ooHhhkoo....', '...ohHHhhhhho...', '..ohHhhhhhhhko..', '..ohhhhhhhhhko..', '..ohkhhhhhkhko..', '..ok........ko..', '..o..........o..'],
    back: ['......oooo......', '....ooHhhkoo....', '...ohHHhhhhho...', '..ohHhhhhhhhko..', '..ohhhhhhhhhko..', '..ohhhhhhhhhko..', '..ohhhhhhhhhko..', '..ohhhhhhhhhko..', '..okhhhhhhhhko..', '..okkhhhhhhkko..', '...okkkkkkkko...']
  },
  raspado: {
    front: ['................', '................', '...okkkkkkkko...', '..okkkkkkkkkko..', '..ok........ko..'],
    back: ['................', '................', '...okkkkkkkko...', '..okkkkkkkkkko..', '..okkkkkkkkkko..', '..okkkkkkkkkko..', '..okkkkkkkkkko..', '..okkkkkkkkkko..', '..okkkkkkkkkko..', '..ozkkkkkkkkzo..']
  }
}

interface Overlay {
  row: number
  rows: string[]
}
const ACC: {
  glasses: { front: Overlay; side: Overlay }
  beard: { front: Overlay; side: Overlay }
  headphones: { front: Overlay; back: Overlay; side: Overlay }
  badge: { front: Overlay }
  cap: { front: Overlay; back: Overlay; side: Overlay }
} = {
  glasses: {
    front: { row: 6, rows: ['....oooooooo....', '....oGGooGGo....', '....oGGooGGo....', '....oooooooo....'] },
    side: { row: 6, rows: ['.........oooo...', '.........oGGo...', '.........oGGo...', '.........oooo...'] }
  },
  beard: {
    front: { row: 9, rows: ['..oh........ho..', '..ohhh....hhho..', '...ohhhhhhhho...', '....ohhhhhho....'] },
    side: { row: 9, rows: ['....oh....hhs...', '....ohhhhhhho...', '.....ohhhhhho...'] }
  },
  headphones: {
    front: { row: 0, rows: ['....aaaaaaaa....', '...a........a...', '..a..........a..', '..a..........a..', '..a..........a..', '..a..........a..', '.aAa........aAa.', '.aAa........aAa.', '.aAa........aAa.', '.aaa........aaa.'] },
    back: { row: 0, rows: ['....aaaaaaaa....', '...a........a...', '..a..........a..', '..a..........a..', '..a..........a..', '..a..........a..', '.aAa........aAa.', '.aAa........aAa.', '.aAa........aAa.', '.aaa........aaa.'] },
    side: { row: 0, rows: ['.....aaaaaaa....', '....a.......a...', '...a.........a..', '......aaa.......', '......aaa.......', '......aaa.......', '.....aAAAa......', '.....aAAAa......', '.....aAAAa......', '.....aaaaa......'] }
  },
  badge: { front: { row: 15, rows: ['.....i....i.....', '......i..i......', '.......yy.......', '.......YY.......', '.......yy.......'] } },
  cap: {
    front: { row: 0, rows: ['................', '....oooooooo....', '...occcccccco...', '..occcCCccccco..', '..occcccccccco..', '.oCCCCCCCCCCCCo.', '.oooooooooooooo.'] },
    back: { row: 0, rows: ['................', '....oooooooo....', '...occcccccco...', '..occcccccccco..', '..occcccccccco..', '..occcccccccco..', '..oooooooooooo..'] },
    side: { row: 0, rows: ['................', '.....ooooooo....', '....ocCccccco...', '...occccccccco..', '...occccccccco..', '...ocCCCCCCCCCCo', '...oooooooooooo.'] }
  }
}

const PALETTE_KEYS = 'oszwebmtTLpqxfghkHGaAcCyYi'

/** Erros nos desenhos (linhas fora de 16 colunas, letras sem cor). Vazio = tudo certo. */
export function validateSprites(): string[] {
  const bad: string[] = []
  const check = (name: string, rows: string[]): void =>
    rows.forEach((r, i) => {
      if (r.length !== 16) bad.push(`${name} linha ${i}: ${r.length} colunas`)
      for (const ch of r) if (ch !== '.' && !PALETTE_KEYS.includes(ch)) bad.push(`${name} linha ${i}: "${ch}"`)
    })
  check('frente', FRONT)
  check('costas', BACK)
  check('lado', SIDE)
  check('passada', SIDE_STRIDE)
  for (const [k, v] of Object.entries(HAIR)) {
    check(`cabelo ${k} frente`, v.front)
    check(`cabelo ${k} costas`, v.back)
  }
  for (const [k, v] of Object.entries(ACC)) for (const [view, ov] of Object.entries(v as Record<string, Overlay>)) check(`${k} ${view}`, ov.rows)
  if (FRONT.length !== 32 || SIDE.length !== 32) bad.push('altura diferente de 32')
  return bad
}

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) & 255
  let g = (n >> 8) & 255
  let b = n & 255
  if (f > 1) {
    r += (255 - r) * (f - 1)
    g += (255 - g) * (f - 1)
    b += (255 - b) * (f - 1)
  } else {
    r *= f
    g *= f
    b *= f
  }
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))
  return '#' + ((1 << 24) + (c(r) << 16) + (c(g) << 8) + c(b)).toString(16).slice(1)
}

export function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16)
  const y = parseInt(b.slice(1), 16)
  const ch = (s: number): number => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t)
  return '#' + ((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1)
}

export function palette(look: Look): Record<string, string> {
  const cap = shade(look.shirt, 0.8)
  return {
    o: '#221c2c', s: look.skin, z: shade(look.skin, 0.82), w: '#ffffff', e: '#2a2236', b: mix(look.skin, '#ff7d7d', 0.32), m: shade(look.skin, 0.6),
    t: look.shirt, T: shade(look.shirt, 0.74), L: shade(look.shirt, 1.22), p: look.pants, q: shade(look.pants, 0.74), x: shade(look.pants, 0.5),
    f: look.shoes, g: shade(look.shoes, 1.45), h: look.hair, k: shade(look.hair, 0.72), H: shade(look.hair, 1.35), G: 'rgba(190,226,255,0.5)',
    a: '#2a2f3d', A: '#d4a849', c: cap, C: shade(cap, 0.7), y: '#f4f1e8', Y: look.shirt, i: '#3a3f52'
  }
}

function paint(grid: string[][], rows: string[], start: number): void {
  rows.forEach((r, i) => {
    const line = grid[start + i]
    if (!line) return
    for (let c = 0; c < 16; c++) if (r[c] !== '.') line[c] = r[c]!
  })
}

/** De lado, o cabelo cobre o alto e a nuca; o rosto (à direita) fica livre. */
function sideHair(rows: string[]): string[] {
  return rows.map((r, i) => (i >= 6 ? r.slice(0, 9) + '.......' : r))
}

/**
 * Monta um quadro do personagem: vista, quadro da caminhada (0–3; na vista "sit", 1 e 3 = digitando),
 * respiração (tronco desce 1 px) e piscada.
 */
export function buildGrid(look: Look, view: SpriteView, frame: number, breath: boolean, blink: boolean): string[][] {
  const base = view === 'side' ? SIDE : view === 'back' || view === 'sit' ? BACK : FRONT
  const g = base.map((r) => r.split(''))
  if (view === 'side' && frame % 2 === 1) paint(g, SIDE_STRIDE, 22)
  if ((view === 'front' || view === 'back') && (frame === 1 || frame === 3)) {
    const c0 = frame === 1 ? 3 : 8
    const c1 = frame === 1 ? 7 : 12
    for (let r = 22; r <= 30; r++) for (let c = c0; c <= c1; c++) g[r]![c] = r < 30 ? g[r + 1]![c]! : '.'
  }
  if (view === 'cheer') {
    for (let r = 15; r <= 20; r++) {
      for (let c = 1; c <= 3; c++) g[r]![c] = '.'
      for (let c = 12; c <= 14; c++) g[r]![c] = '.'
      g[r]![4] = 'o'
      g[r]![11] = 'o'
    }
    g[15] = '...oLttttttTo...'.split('')
    paint(g, ['.s............s.', 'os............so', 'ot............to', 'ot............to', 'ot............to', 'oL............To', 'ott..........tto', '.ott........tto.'], 7)
  }
  if (view === 'sit' && frame % 2 === 1) {
    const cols = frame === 1 ? [1, 3] : [12, 14]
    for (let r = 15; r <= 20; r++) for (let c = cols[0]!; c <= cols[1]!; c++) g[r - 1]![c] = g[r]![c]!
  }
  const hv = view === 'side' ? 'side' : view === 'back' || view === 'sit' ? 'back' : 'front'
  const style = HAIR[look.hairStyle] ?? HAIR.curto
  if (!look.cap) paint(g, hv === 'side' ? sideHair(style.back) : style[hv], 0)
  if (look.beard && hv !== 'back') paint(g, ACC.beard[hv].rows, ACC.beard[hv].row)
  if (look.glasses && hv !== 'back') paint(g, ACC.glasses[hv].rows, ACC.glasses[hv].row)
  if (look.cap) {
    paint(g, ACC.cap[hv].rows, ACC.cap[hv].row)
    if (hv !== 'back' && look.hairStyle === 'longo') {
      const rest = HAIR.longo[hv === 'side' ? 'back' : 'front'].slice(6)
      paint(g, hv === 'side' ? rest.map((r) => r.slice(0, 9) + '.......') : rest, 6)
    }
  }
  if (look.headphones) paint(g, ACC.headphones[hv].rows, ACC.headphones[hv].row)
  if (look.badge && hv === 'front' && view !== 'cheer') paint(g, ACC.badge.front.rows, ACC.badge.front.row)
  if (blink && hv !== 'back') {
    if (hv === 'front') {
      g[7] = g[7]!.map((ch) => (ch === 'w' || ch === 'e' ? 's' : ch))
      g[8] = g[8]!.map((ch) => (ch === 'w' ? 'e' : ch))
    } else {
      for (let c = 10; c <= 11; c++) if (g[7]![c] === 'w' || g[7]![c] === 'e') g[7]![c] = 's'
    }
  }
  if (breath) {
    for (let r = 21; r >= 1; r--) g[r] = g[r - 1]!.slice()
    g[0] = '................'.split('')
  }
  return g
}
