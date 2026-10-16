import type { CanvasEdge, CanvasNode, HairStyle, Look } from './schemas'

/**
 * Escritório: a mesma organização do canvas desenhada como um escritório em pixel art. Terminais viram
 * mesas, conexões entre terminais viram tapetes, notas viram quadros ligados por passarelas. Aqui fica
 * a parte pura (cena, aparência padrão, tradução de ferramenta em animação); o desenho é do renderer.
 */

// ------------------------------------------------------------------ aparência

export const SKIN_TONES = ['#fbe0c8', '#f0c6a0', '#dfa57c', '#c48a62', '#9a6343', '#6e4630']
export const HAIR_COLORS = ['#191b20', '#3b2a1e', '#6b4226', '#a5532b', '#c9a23b', '#e3d5b8', '#8d8f99', '#4a6fd1', '#c2507a']
export const SHIRT_COLORS = ['#e5534b', '#e0884f', '#d4a849', '#59b37a', '#3fa6a6', '#5b8def', '#7e6bd6', '#b48ead', '#ece8dc', '#2b3245']
export const PANTS_COLORS = ['#2f3e66', '#3b4a6b', '#22252e', '#5b5f6b', '#8a7556', '#6b3e3e', '#2f5a45']
export const SHOE_COLORS = ['#1b1e28', '#ece8dc', '#7a4a2b', '#c0392b', '#2f62c9']
export const HAIR_STYLES: HairStyle[] = ['curto', 'longo', 'cacheado', 'coque', 'raspado']
/** Cor da camiseta de um terminal sem papel. */
export const NO_ROLE_COLOR = '#7d8597'

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Visual padrão de um terminal sem aparência escolhida: varia com o id, sempre o mesmo para o mesmo id. */
export function defaultLook(seed: string): Look {
  let h = hash(seed)
  const pick = <T>(list: T[]): T => {
    const v = list[h % list.length]!
    h = (Math.floor(h / list.length) ^ hash(String(h))) >>> 0
    return v
  }
  return {
    skin: pick(SKIN_TONES),
    hair: pick(HAIR_COLORS.slice(0, 7)),
    hairStyle: pick(HAIR_STYLES),
    shirtFromRole: true,
    shirt: pick(SHIRT_COLORS),
    pants: pick(PANTS_COLORS),
    shoes: pick(SHOE_COLORS),
    glasses: h % 3 === 0,
    headphones: h % 5 === 1,
    beard: h % 7 === 2,
    badge: h % 2 === 0,
    cap: false
  }
}

/** Aparência efetiva: a escolhida (ou a padrão) com a camiseta na cor do papel, se for o caso. */
export function effectiveLook(look: Look | undefined, seed: string, roleColor: string | undefined): Look {
  const l = { ...(look ?? defaultLook(seed)) }
  if (l.shirtFromRole) l.shirt = roleColor ?? NO_ROLE_COLOR
  return l
}

// ------------------------------------------------------------------ atividade (o que o personagem faz)

export type OfficeToolKind = 'typing' | 'reading' | 'terminal' | 'browser' | 'writing' | 'thinking'

/** Animação para a ferramenta que o agente está usando (nomes do Claude Code e do Codex). */
export function toolActivity(name: string): OfficeToolKind {
  const n = name.toLowerCase()
  if (/^(edit|write|multiedit|notebookedit|apply_patch)$/.test(n)) return 'typing'
  if (/^(read|grep|glob|ls|view_image|webfetch|websearch|web_search|toolsearch)$/.test(n)) return 'reading'
  if (/^(bash|powershell|exec_command|shell|shell_command|local_shell|write_stdin|monitor|bashoutput)$/.test(n)) return 'terminal'
  if (/playwright|^browser_|browser/.test(n)) return 'browser'
  if (/^(skill|todowrite|update_plan)$/.test(n)) return 'writing'
  return 'thinking'
}

/** Sinais de um terminal para o escritório (enviados pelo processo principal enquanto a visão está aberta). */
export interface OfficeActivity {
  id: string
  /** Ferramenta mais recente no histórico do agente. */
  tool: { kind: OfficeToolKind; detail: string; done: boolean } | null
  /** O histórico diz que a última resposta terminou. */
  turnEnded: boolean
  /** Há uma pergunta com opções esperando o usuário na tela (permissão etc.). */
  waiting: boolean
  /**
   * Usos do histórico de chamados (historico/, INDICE.md, projeto.md): o contador sobe a cada leitura ou
   * gravação nova e o agente vai até o arquivo de gavetas do escritório.
   */
  archive: { seq: number; mode: ArchiveMode }
  /** Ajudantes (sub-agentes do Claude Code) que este agente chamou e que estão trabalhando ou acabaram de terminar. */
  helpers?: OfficeHelper[]
}

export type ArchiveMode = 'read' | 'write'

/** Ajudante de um agente no escritório: um estagiário num banquinho ao lado da mesa de quem o chamou. */
export interface OfficeHelper {
  /** Id da chamada do ajudante: a semente do visual (o chat usa a mesma, então é o mesmo rosto). */
  seed: string
  /** Tarefa que o agente deu a ele. */
  title: string
  /** Tipo do ajudante (Explore, Plan, general-purpose…). */
  type?: string
  status: 'running' | 'done'
  /** O que ele está fazendo agora (pela ferramenta mais recente no histórico dele). */
  tool: OfficeToolKind | null
}

/** Retângulo de um monitor na mesa: relativo ao centro da mesa e à base dos monitores (y negativo = para cima). */
export interface MonitorRect {
  x: number
  y: number
  w: number
  h: number
}

const ROW_W = 20
const ROW_H = 15
/** x de cada monitor numa fileira de 1, 2 ou 3 (fileiras com monitores menores cabem nos 64 da mesa). */
const ROW_X: Record<number, number[]> = { 1: [-10], 2: [-21, 0], 3: [-31, -10, 11] }

/**
 * Monitores na mesa: 1 grande; 2 lado a lado; 3 numa fileira; de 4 a 6, três na fileira de baixo e o resto
 * numa fileira em cima deles (4 = um em cima, 5 = dois, 6 = duas fileiras de três). Na ordem de leitura:
 * fileira de cima primeiro, da esquerda para a direita.
 */
export function monitorLayout(count: number): MonitorRect[] {
  const n = Math.min(6, Math.max(1, Math.round(count) || 1))
  if (n === 1) return [{ x: -15, y: -22, w: 30, h: 22 }]
  if (n === 2)
    return [
      { x: -28, y: -19, w: 27, h: 19 },
      { x: 1, y: -19, w: 27, h: 19 }
    ]
  const bottom = ROW_X[3]!.map((x) => ({ x, y: -ROW_H, w: ROW_W, h: ROW_H }))
  if (n === 3) return bottom
  const top = ROW_X[n - 3]!.map((x) => ({ x, y: -2 * ROW_H - 1, w: ROW_W, h: ROW_H }))
  return [...top, ...bottom]
}

/** Qual monitor mostra o que o agente está fazendo: o único, o primeiro da dupla ou o do meio da fileira de baixo. */
export function mainMonitor(count: number): number {
  const n = monitorLayout(count).length
  return n <= 2 ? 0 : n - 2
}

/** Visual de um ajudante: sorteado pela semente, sempre de boné (o "estagiário"). */
export function helperLook(seed: string): Look {
  return { ...defaultLook(seed), cap: true, shirtFromRole: false }
}

/** Nome da ferramenta mais recente num trecho do histórico de um ajudante (o arquivo dele não passa pelo chat). */
export function lastToolName(tail: string): string | null {
  let last: string | null = null
  for (const m of tail.matchAll(/"type":"tool_use","id":"[^"]*","name":"([^"]+)"/g)) last = m[1]!
  return last
}

const ARCHIVE_PATH = /notes[\\/]+historico(?:[\\/]|\b)|historico[\\/]+indice\.md|notes[\\/]+projeto\.md/i
const WRITE_TOOL = /^(write|edit|multiedit|notebookedit|apply_patch)$/i
const SHELL_WRITE = /\b(copy-item|move-item|set-content|add-content|out-file|cp|mv|tee)\b|>>?/i

/**
 * A ferramenta mexe no histórico de chamados? "write" quando grava (Write/Edit, apply_patch, comando que
 * copia/move/redireciona para lá), "read" quando lê ou pesquisa; null quando não tem nada a ver.
 */
export function archiveUse(name: string, detail: string): ArchiveMode | null {
  if (!ARCHIVE_PATH.test(detail)) return null
  if (WRITE_TOOL.test(name)) return 'write'
  if (toolActivity(name) === 'terminal' && SHELL_WRITE.test(detail)) return 'write'
  return 'read'
}

// ------------------------------------------------------------------ cena

export interface ScenePoint {
  x: number
  y: number
}
export interface SceneDesk {
  id: string
  /** Assento (pés do personagem sentado). */
  x: number
  y: number
}
export interface SceneBoard {
  id: string
  file: string
  /** Base do quadro (pés do cavalete). */
  x: number
  y: number
}
export interface SceneEdge {
  a: string
  b: string
  /** Liga um terminal a uma nota (passarela) em vez de dois terminais (tapete). */
  note: boolean
  path: ScenePoint[]
}
export interface OfficeScene {
  width: number
  height: number
  desks: SceneDesk[]
  boards: SceneBoard[]
  edges: SceneEdge[]
  /** Arquivo de gavetas (histórico de chamados): base do móvel, sempre no canto direito, encostado na parede. */
  archive: ScenePoint | null
}

export const OFFICE_GEOMETRY = {
  /**
   * Unidades do escritório por pixel do canvas. Na vertical é maior: os nós do canvas são altos e a mesa,
   * a cadeira e o quadro precisam de espaço entre as fileiras.
   */
  scaleX: 0.13,
  scaleY: 0.24,
  minWidth: 480,
  minHeight: 270,
  marginX: 64,
  /** Primeira fileira de assentos (abaixo da parede). */
  top: 132,
  bottom: 48,
  /** Saída do terminal (na frente da cadeira) e da nota (na frente do quadro). */
  deskDoor: 22,
  boardDoor: 12,
  /** Faixa reservada à direita para o arquivo de gavetas (nenhuma mesa ou quadro fica ali). */
  archiveZone: 64,
  /** Base do arquivo (encostado na parede, como as mesas da primeira fileira). */
  archiveBaseY: 128,
  /** Onde o agente para, na frente do arquivo. */
  archiveDoor: 14
} as const

function center(n: CanvasNode): ScenePoint {
  return { x: n.position.x + n.size.w / 2, y: n.position.y + n.size.h / 2 }
}

/** Saída de um nó da cena (de onde partem os tapetes/passarelas). */
export function doorOf(scene: OfficeScene, id: string): ScenePoint | null {
  const d = scene.desks.find((x) => x.id === id)
  if (d) return { x: d.x, y: d.y + OFFICE_GEOMETRY.deskDoor }
  const b = scene.boards.find((x) => x.id === id)
  if (b) return { x: b.x, y: b.y + OFFICE_GEOMETRY.boardDoor }
  return null
}

/** Caminho em ângulos retos entre duas saídas: desce/sobe até a meia altura, atravessa e chega. */
export function orthogonalPath(pa: ScenePoint, pb: ScenePoint): ScenePoint[] {
  if (Math.abs(pa.y - pb.y) < 3) return [pa, { x: pb.x, y: pa.y }]
  const mid = Math.round((pa.y + pb.y) / 2)
  return [pa, { x: pa.x, y: mid }, { x: pb.x, y: mid }, pb]
}

/** Meia largura do quadro com folga: a passarela não passa por trás dele. */
const BOARD_CLEAR = 44
/** Altura acima da base do quadro que ele ocupa, incluindo a etiqueta com o nome do arquivo. */
const BOARD_TOP = 72

/** Área ocupada por um móvel (a passarela não deve passar por dentro). */
export interface SceneRect {
  x0: number
  x1: number
  y0: number
  y1: number
}

export function boardRect(b: ScenePoint): SceneRect {
  return { x0: b.x - 33, x1: b.x + 33, y0: b.y - BOARD_TOP, y1: b.y + 2 }
}

/** Mesa, monitor, cadeira e etiqueta do agente (a saída fica logo abaixo). */
export function deskRect(d: ScenePoint): SceneRect {
  return { x0: d.x - 34, x1: d.x + 34, y0: d.y - 76, y1: d.y + 18 }
}

function crosses(p: ScenePoint, q: ScenePoint, r: SceneRect): boolean {
  if (p.x === q.x) return p.x > r.x0 && p.x < r.x1 && Math.max(p.y, q.y) > r.y0 && Math.min(p.y, q.y) < r.y1
  return p.y > r.y0 && p.y < r.y1 && Math.max(p.x, q.x) > r.x0 && Math.min(p.x, q.x) < r.x1
}

function clean(path: ScenePoint[]): ScenePoint[] {
  return path.filter((p, i) => i === 0 || p.x !== path[i - 1]!.x || p.y !== path[i - 1]!.y)
}

function lengthOf(path: ScenePoint[]): number {
  let n = 0
  for (let i = 1; i < path.length; i++) n += Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y)
  return n
}

/**
 * Passarela da mesa até a frente do quadro (onde o agente para para ler). Chega pela lateral, na
 * altura da frente, para não cortar o quadro ao meio. Entre os trajetos possíveis (direto ou por um
 * corredor ao lado do quadro), fica com o mais curto que não passa por trás de nenhum móvel em
 * `obstacles` (o próprio quadro sempre conta).
 */
export function walkwayPath(door: ScenePoint, board: SceneBoard, obstacles: SceneRect[] = []): ScenePoint[] {
  const front = { x: board.x, y: board.y + OFFICE_GEOMETRY.boardDoor }
  const direct = clean(Math.abs(door.y - front.y) < 3 ? [door, { x: front.x, y: door.y }] : [door, { x: door.x, y: front.y }, front])
  const top = board.y - BOARD_TOP
  const mids = [door.y < top ? Math.round((door.y + top) / 2) : door.y, door.y]
  const candidates = [direct]
  for (const side of [board.x - BOARD_CLEAR, board.x + BOARD_CLEAR]) {
    for (const mid of mids) candidates.push(clean([door, { x: door.x, y: mid }, { x: side, y: mid }, { x: side, y: front.y }, front]))
  }
  const blockers = [boardRect(board), ...obstacles]
  const free = candidates.filter((path) => !path.some((p, i) => i > 0 && blockers.some((r) => crosses(path[i - 1]!, p, r))))
  if (free.length === 0) return direct
  return free.reduce((best, path) => (lengthOf(path) < lengthOf(best) ? path : best))
}

/**
 * Monta o escritório a partir dos nós do floor ativo: posições proporcionais às do canvas, mesas para
 * terminais, quadros para notas, tapetes/passarelas para as conexões entre eles. Com `view` (tamanho da
 * área na tela), a sala cresce até ter a mesma proporção da área (sem faixas vazias) e o conteúdo fica
 * no centro.
 */
export function buildScene(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  floorId: string | null | undefined,
  view?: { w: number; h: number }
): OfficeScene {
  const G = OFFICE_GEOMETRY
  const visible = nodes.filter((n) => (n.floorId ?? null) === (floorId ?? null) && (n.kind === 'terminal' || n.kind === 'note'))
  if (visible.length === 0) return { width: G.minWidth, height: G.minHeight, desks: [], boards: [], edges: [], archive: null }
  const centers = visible.map(center)
  const minX = Math.min(...centers.map((c) => c.x))
  const minY = Math.min(...centers.map((c) => c.y))
  const desks: SceneDesk[] = []
  const boards: SceneBoard[] = []
  let maxX = 0
  let maxY = 0
  visible.forEach((n, i) => {
    const c = centers[i]!
    const x = Math.round(G.marginX + (c.x - minX) * G.scaleX)
    const y = Math.round(G.top + (c.y - minY) * G.scaleY)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    if (n.kind === 'terminal') desks.push({ id: n.id, x, y })
    else if (n.kind === 'note') boards.push({ id: n.id, file: n.file, x, y })
  })
  // A faixa da direita fica reservada para o arquivo de gavetas.
  let width = Math.max(G.minWidth, maxX + G.marginX + G.archiveZone)
  let height = Math.max(G.minHeight, maxY + G.bottom)
  // Centraliza horizontalmente quando o desenho é mais estreito que a largura mínima.
  let dx = Math.floor((width - (maxX + G.marginX + G.archiveZone)) / 2)
  let dy = 0
  if (view && view.w > 0 && view.h > 0) {
    const aspect = view.w / view.h
    if (width / height < aspect) {
      const w = Math.round(height * aspect)
      dx += Math.floor((w - width) / 2)
      width = w
    } else {
      const h = Math.round(width / aspect)
      dy = Math.floor((h - height) / 2)
      height = h
    }
  }
  if (dx > 0 || dy > 0) {
    for (const p of [...desks, ...boards]) {
      p.x += dx
      p.y += dy
    }
  }
  const archive = { x: width - Math.round(G.archiveZone / 2) - 4, y: G.archiveBaseY }
  const scene: OfficeScene = { width, height, desks, boards, edges: [], archive }
  const isDesk = (id: string): boolean => desks.some((d) => d.id === id)
  const isBoard = (id: string): boolean => boards.some((b) => b.id === id)
  const seen = new Set<string>()
  for (const e of edges) {
    const terminals = Number(isDesk(e.source)) + Number(isDesk(e.target))
    const notes = Number(isBoard(e.source)) + Number(isBoard(e.target))
    if (terminals === 0 || terminals + notes !== 2) continue
    const key = [e.source, e.target].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    let path: ScenePoint[]
    if (notes > 0) {
      const board = boards.find((b) => b.id === e.source || b.id === e.target)!
      const deskId = board.id === e.source ? e.target : e.source
      const obstacles = [...boards.filter((b) => b.id !== board.id).map(boardRect), ...desks.filter((d) => d.id !== deskId).map(deskRect)]
      const toBoard = walkwayPath(doorOf(scene, deskId)!, board, obstacles)
      path = board.id === e.target ? toBoard : toBoard.reverse()
    } else {
      path = orthogonalPath(doorOf(scene, e.source)!, doorOf(scene, e.target)!)
    }
    scene.edges.push({ a: e.source, b: e.target, note: notes > 0, path })
  }
  return scene
}

/** Caminho do tapete de `from` até `to` (na ordem certa); null se não estão conectados. */
export function routeBetween(scene: OfficeScene, from: string, to: string): ScenePoint[] | null {
  const e = scene.edges.find((x) => (x.a === from && x.b === to) || (x.a === to && x.b === from))
  if (!e) return null
  return e.a === from ? e.path.slice() : e.path.slice().reverse()
}

/**
 * Caminho a pé entre duas mesas: o tapete, se estão conectadas; senão pelo chão, em ângulos retos (descendo
 * da saída, atravessando numa faixa e subindo até a outra saída), pela faixa mais curta que não passa por
 * trás de outras mesas ou quadros. Sem faixa livre, vai pela mais curta mesmo assim.
 */
export function walkRoute(scene: OfficeScene, from: string, to: string): ScenePoint[] | null {
  const carpet = routeBetween(scene, from, to)
  if (carpet) return carpet
  const pa = doorOf(scene, from)
  const pb = doorOf(scene, to)
  if (from === to || !pa || !pb || !scene.desks.some((d) => d.id === from) || !scene.desks.some((d) => d.id === to)) return null
  const blockers = [...scene.desks.filter((d) => d.id !== from && d.id !== to).map(deskRect), ...scene.boards.map(boardRect)]
  const lanes = [Math.round((pa.y + pb.y) / 2), pa.y, pb.y]
  const candidates = lanes.map((y) => clean([pa, { x: pa.x, y }, { x: pb.x, y }, pb]))
  const free = candidates.filter((path) => !path.some((p, i) => i > 0 && blockers.some((r) => crosses(path[i - 1]!, p, r))))
  return (free.length > 0 ? free : candidates).reduce((best, path) => (lengthOf(path) < lengthOf(best) ? path : best))
}

/** Frente do arquivo de gavetas (onde o agente para para consultar ou guardar). */
export function archiveFront(scene: OfficeScene): ScenePoint | null {
  return scene.archive ? { x: scene.archive.x, y: scene.archive.y + OFFICE_GEOMETRY.archiveDoor } : null
}

/**
 * Caminho da mesa até a frente do arquivo: desce até a altura da saída (abaixo das cadeiras), anda até a
 * coluna do arquivo pela faixa reservada da direita e sobe/desce até ele.
 */
export function archiveRoute(scene: OfficeScene, deskId: string): ScenePoint[] | null {
  const door = doorOf(scene, deskId)
  const front = archiveFront(scene)
  if (!door || !front || !scene.desks.some((d) => d.id === deskId)) return null
  const lane = Math.max(door.y, front.y)
  const path = [door, { x: door.x, y: lane }, { x: front.x, y: lane }, front]
  return path.filter((p, i) => i === 0 || p.x !== path[i - 1]!.x || p.y !== path[i - 1]!.y)
}
