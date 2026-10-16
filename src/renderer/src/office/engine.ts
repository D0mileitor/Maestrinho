import {
  archiveRoute,
  boardRect,
  deskRect,
  helperLook,
  mainMonitor,
  monitorLayout,
  routeBetween,
  walkRoute,
  type ArchiveMode,
  type OfficeHelper,
  type OfficeScene,
  type OfficeToolKind,
  type SceneRect,
  type ScenePoint
} from '@shared/office'
import type { MessageMood } from '@shared/mood'
import type { Look, OfficeReactions, OfficeSceneId } from '@shared/schemas'
import { t as T } from '../i18n'
import { createImageScenery, createScenery, type PathStyle, type Px, type SceneryRenderer } from './scenery'
import { mix, shade } from './spriteData'
import { sprite } from './sprites'

/** O que o personagem está fazendo (ferramenta em uso ou estado do terminal). */
export type AgentActivity = OfficeToolKind | 'idle' | 'waiting' | 'attention' | 'off'

export interface AgentInfo {
  id: string
  name: string
  look: Look
  roleColor: string
  activity: AgentActivity
  /** Hibernando: a mesa fica vazia com um "z z" sobre o monitor. */
  sleeping?: boolean
}

type Pose = 'sit' | 'walk' | 'stand'
type Facing = 'up' | 'down' | 'left' | 'right'
interface Trip {
  to: string
  kind: 'send' | 'note' | 'archive'
  /** Ida ao arquivo de gavetas: consultar o histórico ou guardar um chamado. */
  mode?: ArchiveMode
  /** Reprovação ou aprovação: na mesa do colega vira bronca ou comemoração. */
  mood?: MessageMood
  /** Cena pedida à mão (menu do personagem): vale mesmo com as reações automáticas desligadas. */
  action?: OfficeAction
}

/** Objeto da bronca de desenho animado. */
export type Prop = 'jornal' | 'galinha' | 'luva' | 'mjolnir' | 'faca'
/** O que um personagem pode fazer na mesa de outro, pelo menu: bronca com um objeto (ou sorteado) ou comemorar. */
export type OfficeAction = Prop | 'sorteio' | 'comemorar'
/** Cena na mesa do colega (com o instante em que começou). */
type Act = { kind: 'bonk'; prop: Prop; start: number; target: string } | { kind: 'cheer'; start: number; target: string }
interface Say {
  id: string
  text: string
  tone: Bubble['tone']
  from: number
  until: number
}

/** Ajudante (sub-agente) no escritório: um estagiário de boné num banquinho ao lado de quem o chamou. */
interface Intern {
  seed: string
  parent: string
  slot: number
  look: Look
  title: string
  type?: string
  tool: OfficeToolKind | null
  /** chegando → abrindo o banquinho → trabalhando → fechando o banquinho → saindo. */
  phase: 'chegando' | 'abrindo' | 'trabalhando' | 'fechando' | 'saindo'
  since: number
  x: number
  y: number
  path: ScenePoint[]
  walkT: number
  facing: Facing
  blinkAt: number
}

/** Lugares dos banquinhos em volta da mesa (relativos ao assento de quem chamou), na ordem de ocupação. */
const INTERN_SLOTS: ScenePoint[] = [
  { x: 46, y: -2 },
  { x: -46, y: -2 },
  { x: 46, y: 24 },
  { x: -46, y: 24 },
  { x: 72, y: -2 },
  { x: -72, y: -2 }
]
const INTERN_SPEED = 40
const STOOL_OPEN_S = 0.35
const STOOL_FOLD_S = 0.5
/** Faixa por onde os estagiários chegam e saem: abaixo da etiqueta com o nome da mesa. */
const INTERN_LANE = 50

/** Destino das idas ao arquivo de gavetas (não é um nó do canvas). */
export const ARCHIVE_ID = 'arquivo'
const ARCHIVE_VISIT_S = 2.4
/** A ida (e a volta) ao arquivo leva no máximo isto, mesmo do outro lado da sala. */
const ARCHIVE_WALK_S = 4

function pathLength(path: ScenePoint[]): number {
  let n = 0
  for (let i = 1; i < path.length; i++) n += Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y)
  return n
}
/** Área do arquivo de gavetas (para clique, dica e decoração não ocupar). */
export function archiveRect(base: ScenePoint): SceneRect {
  return { x0: base.x - 15, x1: base.x + 15, y0: base.y - 50, y1: base.y + 3 }
}
interface Actor {
  id: string
  x: number
  y: number
  pose: Pose
  facing: Facing
  path: ScenePoint[]
  walkT: number
  /** Velocidade da caminhada atual (a ida ao arquivo, que pode ser longe, é mais rápida). */
  speed: number
  carry: string | null
  state: 'seated' | 'going' | 'visiting' | 'returning'
  trip: Trip | null
  queue: Trip[]
  visitUntil: number
  blinkAt: number
  act: Act | null
}

export interface Bubble {
  id: string
  x: number
  y: number
  text: string
  tone: '' | 'ok' | 'ask' | 'bad' | 'hit' | 'blood'
}

const WALK_SPEED = 48
const VISIT_S = 1.6
const MAX_QUEUE = 3
/** Bronca: fala, prepara e acerta a cabeça do colega duas vezes (instantes a partir da chegada). */
const BONK_S = 3
const BONK_HITS = [1.5, 2.1]
/** O colega fica vendo estrelas até este instante. */
const DIZZY_S = 4.4
/** Comemoração: braços para cima e confete; o colega pula na cadeira. */
const CHEER_S = 2.2
const THANKS_AT = 1.1
/** O sorteio usa só os de desenho animado; a facadinha (com sangue) só se escolhida nas configurações. */
const PROPS: Prop[] = ['jornal', 'galinha', 'luva', 'mjolnir']
/** Facadinha: a poça fica no chão até este instante (some devagar no fim); o sangue na tela dura menos. */
const BLOOD_S = 9
const SPLAT_S = 1.8
/** Raios do Mjölnir: duração de cada descarga. */
const BOLT_S = 0.35
/** Efeito em quem levou a bronca: estrelinhas, raios (e estrelinhas) ou sangue. */
interface Hurt {
  hits: number[]
  until: number
  fx: 'estrelas' | 'raio' | 'sangue'
  seed: number
}

function pick<V>(list: readonly V[]): V {
  return list[Math.floor(Math.random() * list.length)]!
}

/**
 * Motor do escritório: estado dos personagens (sentados, caminhando pelo tapete, visitando um colega
 * ou um quadro) e o desenho pixel a pixel. Coordenadas lógicas da cena; quem chama aplica a escala.
 */
export class OfficeEngine {
  scene: OfficeScene = { width: 480, height: 270, desks: [], boards: [], edges: [], archive: null }
  /** Gaveta aberta enquanto alguém consulta ou guarda (até este instante). */
  private archiveOpenUntil = 0
  private actors = new Map<string, Actor>()
  private info = new Map<string, AgentInfo>()
  private glow = new Map<string, number>()
  private ink = new Map<string, number>()
  private says: Say[] = []
  /** Quem levou bronca: instantes das pancadas e até quando vê estrelas. */
  private hurt = new Map<string, Hurt>()
  /** Quem foi comemorado: pula na cadeira neste intervalo. */
  private joy = new Map<string, { from: number; until: number }>()
  /** Estagiários: ajudantes que os agentes chamaram, pela semente (id da chamada). */
  private interns = new Map<string, Intern>()
  private sceneryId: OfficeSceneId = 'escritorio'
  private sceneryImage: HTMLImageElement | null = null
  private scenery: { renderer: SceneryRenderer; scene: OfficeScene; id: OfficeSceneId; image: HTMLImageElement | null } | null = null
  t = 0
  /** Bronca e comemoração (configurações): o objeto, sorteado a cada vez, ou desligado. */
  reactions: OfficeReactions = 'sorteio'
  /** Agente ou quadro selecionado / sob o mouse (ids de nós do canvas). */
  selected: string | null = null
  hovered: string | null = null

  setScene(scene: OfficeScene): void {
    this.scene = scene
    for (const d of scene.desks) {
      const a = this.actors.get(d.id)
      if (!a) {
        this.actors.set(d.id, {
          id: d.id,
          x: d.x,
          y: d.y,
          pose: 'sit',
          facing: 'up',
          path: [],
          walkT: 0,
          speed: WALK_SPEED,
          carry: null,
          state: 'seated',
          trip: null,
          queue: [],
          visitUntil: 0,
          blinkAt: this.t + 1 + Math.random() * 4,
          act: null
        })
      } else if (a.state === 'seated') {
        a.x = d.x
        a.y = d.y
      }
    }
    for (const id of [...this.actors.keys()]) if (!scene.desks.some((d) => d.id === id)) this.actors.delete(id)
    for (const i of [...this.interns.values()]) {
      const desk = scene.desks.find((d) => d.id === i.parent)
      if (!desk) this.interns.delete(i.seed)
      else if (i.phase === 'abrindo' || i.phase === 'trabalhando' || i.phase === 'fechando') {
        i.x = desk.x + INTERN_SLOTS[i.slot]!.x
        i.y = desk.y + INTERN_SLOTS[i.slot]!.y
      }
    }
    for (const b of scene.boards) if (!this.ink.has(b.id)) this.ink.set(b.id, 3)
  }

  /** Troca o cenário (escritório, campo florido, refeitório, sala de descanso, inferno). */
  setScenery(id: OfficeSceneId, image: HTMLImageElement | null = null): void {
    this.sceneryId = id
    this.sceneryImage = image
  }

  /** Cenário pronto para a cena atual: refeito quando a sala muda de tamanho ou de arrumação. */
  private currentScenery(): SceneryRenderer {
    const cur = this.scenery
    if (cur && cur.scene === this.scene && cur.id === this.sceneryId && cur.image === this.sceneryImage) return cur.renderer
    if (this.sceneryImage) {
      const renderer = createImageScenery(this.sceneryImage, this.scene.width, this.scene.height)
      this.scenery = { renderer, scene: this.scene, id: this.sceneryId, image: this.sceneryImage }
      return renderer
    }
    const blocked: SceneRect[] = [...this.scene.desks.map(deskRect), ...this.scene.boards.map(boardRect)]
    if (this.scene.archive) {
      // o arquivo, a etiqueta em cima e o espaço onde o agente para na frente dele
      const r = archiveRect(this.scene.archive)
      blocked.push({ x0: r.x0 - 6, x1: r.x1 + 6, y0: r.y0 - 14, y1: r.y1 + 24 })
    }
    for (const e of this.scene.edges) {
      const half = e.note ? 3 : 7
      for (let i = 0; i < e.path.length - 1; i++) {
        const p = e.path[i]!
        const q = e.path[i + 1]!
        blocked.push({ x0: Math.min(p.x, q.x) - half, x1: Math.max(p.x, q.x) + half, y0: Math.min(p.y, q.y) - half, y1: Math.max(p.y, q.y) + half })
      }
    }
    const renderer = createScenery(this.sceneryId, this.scene.width, this.scene.height, blocked)
    this.scenery = { renderer, scene: this.scene, id: this.sceneryId, image: null }
    return renderer
  }

  /**
   * O agente leu ou gravou o histórico de chamados: levanta, vai até o arquivo de gavetas, abre uma
   * gaveta e volta (com uma pasta, se foi consultar).
   */
  visitArchive(id: string, mode: ArchiveMode): void {
    const a = this.actors.get(id)
    if (!a || !this.scene.archive || !archiveRoute(this.scene, id)) return
    // Já tem uma ida ao arquivo na fila; ou está indo/consultando para a mesma coisa: não repete.
    if (a.queue.some((q) => q.kind === 'archive')) return
    if (a.trip?.kind === 'archive' && a.trip.mode === mode && a.state !== 'returning') return
    const trip: Trip = { to: ARCHIVE_ID, kind: 'archive', mode }
    if (a.state === 'seated' && !a.trip) this.startTrip(a, trip)
    else if (a.queue.length < MAX_QUEUE) a.queue.push(trip)
  }

  /** O ponto cai no arquivo de gavetas? */
  hitArchive(x: number, y: number): boolean {
    if (!this.scene.archive) return false
    const r = archiveRect(this.scene.archive)
    return x >= r.x0 - 2 && x <= r.x1 + 2 && y >= r.y0 - 14 && y <= r.y1
  }

  setInfo(list: AgentInfo[]): void {
    this.info = new Map(list.map((i) => [i.id, i]))
  }

  /**
   * Mensagem do orq entre dois nós: o remetente leva o papel pelo tapete (se estão conectados). Com tom de
   * reprovação ou aprovação, chegando na mesa ele faz a cena em vez de só entregar.
   */
  message(from: string, to: string, kind: 'send' | 'note', mood?: MessageMood): void {
    const a = this.actors.get(from)
    if (!a || !routeBetween(this.scene, from, to)) return
    const trip: Trip = { to, kind, mood }
    if (a.state === 'seated' && !a.trip) this.startTrip(a, trip)
    else if (a.queue.length < MAX_QUEUE) a.queue.push(trip)
  }

  /**
   * Cena pedida à mão (menu do personagem): qualquer um vai até a mesa de qualquer outro, mesmo sem tapete
   * entre eles (anda pelo chão), e dá a bronca ou comemora.
   */
  interact(from: string, to: string, action: OfficeAction): void {
    const a = this.actors.get(from)
    if (!a || !walkRoute(this.scene, from, to)) return
    const trip: Trip = { to, kind: 'send', mood: action === 'comemorar' ? 'praise' : 'complaint', action }
    if (a.state === 'seated' && !a.trip) this.startTrip(a, trip)
    else if (a.queue.length < MAX_QUEUE) a.queue.push(trip)
  }

  /**
   * Ajudantes que um agente chamou (sub-agentes do Claude Code): para cada um chega um estagiário, abre um
   * banquinho ao lado da mesa e trabalha ali; quando termina (ou some da lista), fecha o banquinho e sai.
   */
  setHelpers(parent: string, list: readonly OfficeHelper[]): void {
    const desk = this.scene.desks.find((d) => d.id === parent)
    const seen = new Set<string>()
    for (const h of list) {
      seen.add(h.seed)
      const cur = this.interns.get(h.seed)
      if (cur) {
        cur.title = h.title
        cur.tool = h.tool
        if (h.status === 'done') this.dismissIntern(cur)
        continue
      }
      if (h.status !== 'running' || !desk) continue
      const slot = this.freeSlot(parent)
      if (slot < 0) continue
      const s = INTERN_SLOTS[slot]!
      const laneY = desk.y + INTERN_LANE
      this.interns.set(h.seed, {
        seed: h.seed,
        parent,
        slot,
        look: helperLook(h.seed),
        title: h.title,
        ...(h.type ? { type: h.type } : {}),
        tool: h.tool,
        phase: 'chegando',
        since: this.t,
        x: desk.x,
        y: laneY,
        path: [
          { x: desk.x + s.x, y: laneY },
          { x: desk.x + s.x, y: desk.y + s.y }
        ],
        walkT: 0,
        facing: 'down',
        blinkAt: this.t + 1 + Math.random() * 3
      })
    }
    for (const i of this.interns.values()) if (i.parent === parent && !seen.has(i.seed)) this.dismissIntern(i)
  }

  /** Estagiário sob o ponto (semente), se houver. */
  hitHelper(x: number, y: number): string | null {
    let best: string | null = null
    let dist = 14
    for (const i of this.interns.values()) {
      if (i.phase === 'saindo') continue
      const d = Math.hypot(i.x - x, i.y - 18 - y)
      if (d < dist) {
        dist = d
        best = i.seed
      }
    }
    return best
  }

  /** Dados de um estagiário para a dica (tarefa, tipo, quem chamou, posição). */
  helperInfo(seed: string): { title: string; type?: string; parent: string; x: number; y: number; working: boolean } | null {
    const i = this.interns.get(seed)
    return i ? { title: i.title, ...(i.type ? { type: i.type } : {}), parent: i.parent, x: i.x, y: i.y, working: i.phase === 'trabalhando' } : null
  }

  private freeSlot(parent: string): number {
    const used = new Set([...this.interns.values()].filter((i) => i.parent === parent && i.phase !== 'saindo').map((i) => i.slot))
    for (let k = 0; k < INTERN_SLOTS.length; k++) if (!used.has(k)) return k
    return -1
  }

  /** Terminou: levanta, fecha o banquinho e vai embora (se nem tinha sentado, só vai embora). */
  private dismissIntern(i: Intern): void {
    if (i.phase === 'fechando' || i.phase === 'saindo') return
    if (i.phase === 'chegando') return this.internLeaves(i)
    i.phase = 'fechando'
    i.since = this.t
    i.facing = 'down'
  }

  /** Sai pela faixa abaixo da etiqueta da mesa até a beirada mais próxima da sala. */
  private internLeaves(i: Intern): void {
    const desk = this.scene.desks.find((d) => d.id === i.parent)
    const lane = (desk?.y ?? i.y) + INTERN_LANE
    const exitX = i.x < this.scene.width / 2 ? -24 : this.scene.width + 24
    i.phase = 'saindo'
    i.since = this.t
    i.path = [
      { x: i.x, y: lane },
      { x: exitX, y: lane }
    ]
  }

  private updateInterns(dt: number): void {
    for (const i of [...this.interns.values()]) {
      if (i.phase === 'abrindo' && this.t - i.since >= STOOL_OPEN_S) {
        i.phase = 'trabalhando'
        i.since = this.t
      }
      if (i.phase === 'fechando' && this.t - i.since >= STOOL_FOLD_S) this.internLeaves(i)
      if (i.phase !== 'chegando' && i.phase !== 'saindo') continue
      const target = i.path[0]
      if (!target) {
        if (i.phase === 'saindo') this.interns.delete(i.seed)
        else {
          i.phase = 'abrindo'
          i.since = this.t
          i.facing = 'down'
        }
        continue
      }
      i.walkT += dt
      const dx = target.x - i.x
      const dy = target.y - i.y
      const dist = Math.hypot(dx, dy)
      const step = INTERN_SPEED * dt
      if (dist <= step) {
        i.x = target.x
        i.y = target.y
        i.path.shift()
      } else {
        i.x += (dx / dist) * step
        i.y += (dy / dist) * step
        i.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'
      }
    }
  }

  /** Pequena frase sobre o personagem (ex.: "recebido"), daqui a `delay` segundos; a mais nova cobre a anterior. */
  say(id: string, text: string, tone: Bubble['tone'], seconds: number, delay = 0): void {
    const from = this.t + delay
    this.says = this.says.filter((s) => s.until > this.t && !(s.id === id && s.from >= from))
    for (const s of this.says) if (s.id === id) s.until = Math.min(s.until, from)
    this.says.push({ id, text, tone, from, until: from + seconds })
  }

  hit(x: number, y: number): string | null {
    let best: string | null = null
    let dist = 20
    for (const a of this.actors.values()) {
      const d = Math.hypot(a.x - x, a.y - 18 - y)
      if (d < dist) {
        dist = d
        best = a.id
      }
    }
    return best
  }

  /** Quadro (nota) sob o ponto, se houver. */
  hitBoard(x: number, y: number): string | null {
    for (const b of this.scene.boards) if (x >= b.x - 33 && x <= b.x + 33 && y >= b.y - 72 && y <= b.y + 2) return b.id
    return null
  }

  bubbles(): Bubble[] {
    const out: Bubble[] = []
    for (const s of this.says) {
      const a = this.actors.get(s.id)
      if (!a || s.from > this.t || s.until <= this.t) continue
      const head = a.pose === 'sit' ? a.y - 38 : a.y - 34
      out.push({ id: s.id, x: a.x, y: head - 16, text: s.text, tone: s.tone })
    }
    return out
  }

  actorPos(id: string): ScenePoint | null {
    const a = this.actors.get(id)
    return a ? { x: a.x, y: a.y } : null
  }

  // ------------------------------------------------------------------ comportamento

  private startTrip(a: Actor, trip: Trip): void {
    if (trip.kind === 'archive') {
      const path = archiveRoute(this.scene, a.id)
      if (!path) return
      a.trip = trip
      a.state = 'going'
      a.pose = 'walk'
      a.path = path
      a.speed = Math.max(WALK_SPEED, pathLength(path) / ARCHIVE_WALK_S)
      // indo guardar um chamado: leva a pasta na mão
      a.carry = trip.mode === 'write' ? '#e8c97a' : null
      return
    }
    const route = walkRoute(this.scene, a.id, trip.to) ?? routeBetween(this.scene, a.id, trip.to)
    if (!route) return
    const target = this.scene.desks.find((d) => d.id === trip.to)
    const path = route.slice()
    if (target) path.push({ x: target.x + 20, y: target.y + 4 })
    a.trip = trip
    a.state = 'going'
    a.pose = 'walk'
    a.path = path
    a.speed = WALK_SPEED
    // recado leva o papel; cena pedida à mão vai de mãos vazias
    a.carry = trip.kind === 'send' && !trip.action ? (this.info.get(a.id)?.roleColor ?? '#d4a849') : null
    this.glow.set(edgeKey(a.id, trip.to), Infinity)
  }

  private arrive(a: Actor): void {
    if (a.state === 'going' && a.trip?.kind === 'archive') {
      a.state = 'visiting'
      a.pose = 'stand'
      a.facing = 'up'
      a.visitUntil = this.t + ARCHIVE_VISIT_S
      a.carry = null
      this.archiveOpenUntil = Math.max(this.archiveOpenUntil, a.visitUntil)
      this.say(a.id, a.trip.mode === 'write' ? 'arquivando' : 'consultando o arquivo', '', ARCHIVE_VISIT_S)
      return
    }
    if (a.state === 'going' && a.trip) {
      a.state = 'visiting'
      a.pose = 'stand'
      a.visitUntil = this.t + VISIT_S
      const isDesk = this.scene.desks.some((d) => d.id === a.trip!.to)
      a.facing = isDesk ? 'left' : 'up'
      if (isDesk && this.react(a, a.trip)) {
        a.carry = null
      } else if (isDesk) {
        this.say(a.id, 'mensagem', '', VISIT_S)
        this.say(a.trip.to, 'recebido', 'ok', 1.2)
      } else {
        this.ink.set(a.trip.to, Math.min(6, (this.ink.get(a.trip.to) ?? 0) + 1))
      }
      return
    }
    if (a.state === 'returning') {
      const seat = this.scene.desks.find((d) => d.id === a.id)
      if (seat) {
        a.x = seat.x
        a.y = seat.y
      }
      a.state = 'seated'
      a.pose = 'sit'
      a.facing = 'up'
      a.carry = null
      if (a.trip && a.trip.kind !== 'archive') this.glow.set(edgeKey(a.id, a.trip.to), this.t + 0.5)
      a.trip = null
      const next = a.queue.shift()
      if (next) this.startTrip(a, next)
    }
  }

  /**
   * Reprovou ou aprovou o colega: em vez de só entregar o papel, faz a cena. Bronca: reclama, levanta o
   * objeto e acerta a cabeça dele duas vezes (ele vê estrelas). Comemoração: braços para cima, confete e o
   * colega pula na cadeira.
   */
  private react(a: Actor, trip: Trip): boolean {
    const { to, mood, action } = trip
    if (!mood || (!action && this.reactions === 'desligado')) return false
    const t = this.t
    const o = T.office
    if (mood === 'complaint') {
      const chosen = action && action !== 'sorteio' && action !== 'comemorar' ? action : null
      const prop = chosen ?? (action || this.reactions === 'sorteio' || this.reactions === 'desligado' ? pick(PROPS) : this.reactions)
      a.act = { kind: 'bonk', prop, start: t, target: to }
      a.visitUntil = t + BONK_S
      const stab = prop === 'faca'
      this.say(a.id, pick(o.scold), 'bad', 1.4)
      for (const h of BONK_HITS) this.say(to, o.bonkSound[prop], stab ? 'blood' : 'hit', 0.45, h)
      this.say(to, pick(stab ? o.ouchStab : o.ouch), '', 1.8, BONK_HITS[BONK_HITS.length - 1]! + 0.5)
      const fx = stab ? 'sangue' : prop === 'mjolnir' ? 'raio' : 'estrelas'
      this.hurt.set(to, { hits: BONK_HITS.map((h) => t + h), until: t + (stab ? BLOOD_S : DIZZY_S), fx, seed: Math.random() * 1000 })
      return true
    }
    a.act = { kind: 'cheer', start: t, target: to }
    a.visitUntil = t + CHEER_S
    this.say(a.id, pick(o.cheer), 'ok', 1.3)
    this.say(to, pick(o.thanks), 'ok', 1.4, THANKS_AT)
    this.joy.set(to, { from: t + THANKS_AT, until: t + CHEER_S })
    return true
  }

  update(dt: number): void {
    this.t += dt
    for (const [id, h] of this.hurt) if (h.until < this.t) this.hurt.delete(id)
    for (const [id, j] of this.joy) if (j.until < this.t) this.joy.delete(id)
    this.updateInterns(dt)
    for (const a of this.actors.values()) {
      if (a.state === 'visiting' && this.t >= a.visitUntil && a.trip?.kind === 'archive') {
        const route = archiveRoute(this.scene, a.id)
        const seat = this.scene.desks.find((d) => d.id === a.id)
        // voltando da consulta com uma pasta do histórico
        a.carry = a.trip.mode === 'read' ? '#d4a849' : null
        a.state = 'returning'
        a.pose = 'walk'
        a.path = [...(route ?? []).slice().reverse(), ...(seat ? [{ x: seat.x, y: seat.y }] : [])]
        continue
      }
      if (a.state === 'visiting' && this.t >= a.visitUntil && a.trip) {
        const route = walkRoute(this.scene, a.trip.to, a.id) ?? routeBetween(this.scene, a.trip.to, a.id)
        const seat = this.scene.desks.find((d) => d.id === a.id)
        a.carry = null
        a.act = null
        a.state = 'returning'
        a.pose = 'walk'
        a.path = [...(route ?? []), ...(seat ? [{ x: seat.x, y: seat.y }] : [])]
        continue
      }
      if (a.pose !== 'walk') continue
      if (a.path.length === 0) {
        this.arrive(a)
        continue
      }
      a.walkT += dt
      const target = a.path[0]!
      const dx = target.x - a.x
      const dy = target.y - a.y
      const dist = Math.hypot(dx, dy)
      const step = a.speed * dt
      if (dist <= step) {
        a.x = target.x
        a.y = target.y
        a.path.shift()
        if (a.path.length === 0) this.arrive(a)
      } else {
        a.x += (dx / dist) * step
        a.y += (dy / dist) * step
        a.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'
      }
    }
  }

  // ------------------------------------------------------------------ desenho

  draw(g: CanvasRenderingContext2D): void {
    const t = this.t
    const px = (x: number, y: number, w: number, h: number, c: string): void => {
      g.fillStyle = c
      g.fillRect(Math.round(x), Math.round(y), w, h)
    }
    const scenery = this.currentScenery()
    scenery.back(g, px, t)
    this.drawPaths(px, t, scenery.paths)
    this.drawPuddles(g, px, t)
    const items: { y: number; o: number; f: () => void }[] = []
    for (const d of this.scene.desks) {
      const a = this.actors.get(d.id)
      const info = this.info.get(d.id)
      items.push({ y: d.y - 8, o: 0, f: () => this.drawDesk(g, px, d.x, d.y, info, t) })
      const seated = a && a.state === 'seated' && info?.activity !== 'off'
      if (!seated) items.push({ y: d.y, o: 1, f: () => drawChair(px, d.x, d.y, false) })
      if (a && info && info.activity !== 'off') items.push({ y: a.y, o: 2, f: () => this.drawActor(g, px, a, info, t) })
    }
    for (const i of this.interns.values()) items.push({ y: i.y, o: 2, f: () => this.drawIntern(g, px, i, t) })
    for (const b of this.scene.boards) items.push({ y: b.y, o: 0, f: () => this.drawBoard(g, px, b.x, b.y, b.id) })
    const arch = this.scene.archive
    if (arch) items.push({ y: arch.y, o: 0, f: () => drawArchive(g, px, arch.x, arch.y, this.t < this.archiveOpenUntil, this.hovered === ARCHIVE_ID) })
    items.sort((p, q) => p.y - q.y || p.o - q.o)
    for (const it of items) it.f()
    scenery.front(g, px, t)
    this.drawEffects(g, px, t)
  }

  private drawPaths(px: Px, t: number, style: PathStyle): void {
    for (const pass of [true, false]) {
      for (const e of this.scene.edges) {
        if (e.note !== pass) continue
        const lit = (this.glow.get(edgeKey(e.a, e.b)) ?? 0) > t
        for (let i = 0; i < e.path.length - 1; i++) drawSegment(px, e.path[i]!, e.path[i + 1]!, e.note, lit, t, style)
      }
    }
  }

  private drawBoard(g: CanvasRenderingContext2D, px: Px, bx: number, by: number, id: string): void {
    g.fillStyle = 'rgba(0,0,0,0.22)'
    g.beginPath()
    g.ellipse(bx, by + 1, 30, 3, 0, 0, Math.PI * 2)
    g.fill()
    px(bx - 25, by - 16, 2, 16, '#5f5a4d')
    px(bx + 23, by - 16, 2, 16, '#5f5a4d')
    px(bx - 28, by - 1, 8, 2, '#4a463c')
    px(bx + 20, by - 1, 8, 2, '#4a463c')
    px(bx - 32, by - 56, 64, 41, '#8d8573')
    px(bx - 30, by - 54, 60, 37, '#ece8dc')
    px(bx - 30, by - 54, 60, 5, '#5b8def')
    const ink = this.ink.get(id) ?? 0
    for (let i = 0; i < ink; i++) px(bx - 26, by - 45 + i * 5, 16 + ((i * 11 + 3) % 26), 2, '#3b4a6b')
    px(bx + 14, by - 46, 12, 10, '#f7e08a')
    px(bx + 16, by - 43, 8, 1, '#8d7b3a')
    px(bx + 16, by - 40, 6, 1, '#8d7b3a')
    px(bx - 28, by - 17, 56, 3, '#a39a85')
    px(bx - 18, by - 18, 8, 1, '#5b8def')
    px(bx - 6, by - 18, 8, 1, '#c0392b')
    if (id === this.selected || id === this.hovered) {
      g.strokeStyle = id === this.selected ? '#d4a849' : 'rgba(212,168,73,0.55)'
      g.lineWidth = 1
      g.strokeRect(bx - 34.5, by - 58.5, 69, 45)
    }
  }

  private drawDesk(g: CanvasRenderingContext2D, px: Px, x: number, seatY: number, info: AgentInfo | undefined, t: number): void {
    const hw = 32
    g.save()
    g.translate(0, seatY - 136)
    px(x - hw, 92, hw * 2, 16, '#9b7650')
    px(x - hw, 92, hw * 2, 2, '#b8916a')
    for (let k = 0; k < 3; k++) px(x - hw + 6 + k * 19, 98 + (k % 2) * 4, 12, 1, 'rgba(90,60,35,0.35)')
    px(x - hw, 108, hw * 2, 7, '#7a5a3c')
    px(x - hw, 115, hw * 2, 1, '#5f4530')
    px(x + hw - 22, 109, 18, 5, '#6b4f34')
    px(x + hw - 15, 111, 4, 1, '#d4a849')
    px(x - hw + 2, 116, 3, 14, '#4a3626')
    px(x + hw - 5, 116, 3, 14, '#4a3626')
    // monitores (1 a 6, escolhidos na aparência): o principal mostra a atividade; os outros acompanham
    const screens = monitorLayout(info?.look.monitors ?? 1)
    const main = mainMonitor(screens.length)
    const activity = info?.activity ?? 'off'
    screens.forEach((m, i) => {
      const mx = x + m.x
      const my = 86 + m.y
      px(mx, my, m.w, m.h, '#151925')
      px(mx + 1, my + 1, m.w - 2, 1, '#2f3650')
      if (m.y + m.h === 0) {
        // fileira de baixo: pé e base no tampo
        const big = m.w >= 26
        px(mx + m.w / 2 - (big ? 3 : 2), 86, big ? 6 : 4, 5, '#232838')
        px(mx + m.w / 2 - (big ? 8 : 5), 91, big ? 16 : 10, 2, '#2f3650')
      }
      g.save()
      g.beginPath()
      g.rect(mx + 2, my + 2, m.w - 4, m.h - 4)
      g.clip()
      drawScreen(px, i === main ? activity : sideScreen(activity, i < main ? i + 1 : i), info?.roleColor ?? '#7d8597', mx + 2, my + 2, m.w - 4, m.h - 4, t + i * 0.37)
      g.restore()
    })
    if (info?.sleeping) drawZs(px, x + 10, 86 + Math.min(...screens.map((m) => m.y)) - 4, t)
    if (info && info.activity !== 'off') {
      g.fillStyle = 'rgba(160, 200, 255, 0.07)'
      g.fillRect(x - 18, 93, 36, 6)
    }
    px(x - 11, 97, 22, 5, '#d6dae3')
    for (let k = 0; k < 5; k++) px(x - 10 + k * 4, 98, 3, 1, '#aab2c2')
    px(x + 14, 98, 3, 4, '#d6dae3')
    const role = info?.roleColor ?? '#7d8597'
    px(x - hw + 5, 95, 6, 7, role)
    px(x - hw + 5, 95, 6, 1, shade(role, 1.3))
    px(x - hw + 11, 97, 2, 3, role)
    if (info && (info.activity === 'typing' || info.activity === 'terminal')) {
      const st = Math.floor(t * 4) % 3
      px(x - hw + 7 + (st % 2), 92 - st, 1, 2, 'rgba(255,255,255,0.45)')
    }
    px(x + hw - 14, 94, 10, 7, '#f4f1e8')
    px(x + hw - 13, 96, 7, 1, '#9aa3b5')
    g.restore()
  }

  private drawActor(g: CanvasRenderingContext2D, px: Px, a: Actor, info: AgentInfo, t: number): void {
    const x = Math.round(a.x)
    const y = Math.round(a.y)
    const blink = t > a.blinkAt && t < a.blinkAt + 0.14
    if (t > a.blinkAt + 0.14) a.blinkAt = t + 2 + Math.random() * 4
    const walking = a.pose === 'walk'
    const frame = walking ? Math.floor(a.walkT * 8) % 4 : 0
    const breath = !walking && Math.floor(t * 1.6) % 2 === 1
    // levou bronca: sacode a cada pancada; foi comemorado: pula na cadeira
    const hurt = this.hurt.get(a.id)
    const joy = this.joy.get(a.id)
    const shake = hurt?.hits.some((h) => t >= h && t < h + 0.3) ? (Math.floor(t * 30) % 2 ? 1 : -1) : 0
    const hop = joy && t >= joy.from && Math.floor((t - joy.from) * 5) % 2 === 0 ? 2 : 0
    const act = a.state === 'visiting' ? a.act : null
    if (a.id === this.selected || a.id === this.hovered) {
      g.strokeStyle = a.id === this.selected ? '#d4a849' : 'rgba(212,168,73,0.55)'
      g.lineWidth = 1
      g.strokeRect(x - 11.5, y - 37.5, 23, 40)
    }
    if (a.pose === 'sit') {
      const tf = info.activity === 'typing' ? (Math.floor(t * 8) % 2 ? 1 : 3) : 0
      g.drawImage(sprite(info.look, 'sit', tf, false, false), 0, 0, 16, 22, x - 8 + shake, y - 38 + (breath ? 1 : 0) - hop, 16, 22)
      if (info.activity === 'reading') {
        px(x - 5, y - 21, 10, 6, '#f4f1e8')
        px(x - 4, y - 19, 7, 1, '#9aa3b5')
      }
      drawChair(px, x, y, true)
    } else {
      g.fillStyle = 'rgba(0,0,0,0.28)'
      g.beginPath()
      g.ellipse(x, y, 7, 2, 0, 0, Math.PI * 2)
      g.fill()
      // comemorando: de frente, braços para cima, pulando
      const cheerT = act?.kind === 'cheer' ? t - act.start : -1
      const view = cheerT >= 0 ? 'cheer' : a.facing === 'up' ? 'back' : a.facing === 'left' || a.facing === 'right' ? 'side' : 'front'
      const img = sprite(info.look, view, frame, breath, blink)
      const bob = walking && frame % 2 === 1 ? 1 : cheerT >= 0 && Math.floor(cheerT * 5) % 2 === 0 ? 2 : hop
      g.save()
      if (a.facing === 'left' && cheerT < 0) {
        g.translate(x + shake, 0)
        g.scale(-1, 1)
        g.drawImage(img, -8, y - 32 - bob)
      } else g.drawImage(img, x - 8 + shake, y - 32 - bob)
      g.restore()
      if (a.carry) {
        const hx = a.facing === 'left' ? x - 9 : x + 3
        px(hx, y - 16 - bob, 7, 8, '#f4f1e8')
        px(hx + 1, y - 14 - bob, 5, 1, a.carry)
        px(hx + 1, y - 12 - bob, 4, 1, a.carry)
        px(hx, y - 16 - bob, 7, 1, '#c9c2b0')
      }
    }
    if (hurt && hurt.fx !== 'sangue' && t >= hurt.hits[0]!) drawDizzy(px, x, headTop(a), t)
    if (act?.kind === 'bonk') this.drawBonk(px, a, act, info.look, t)
    if (act?.kind === 'cheer') {
      const other = this.actors.get(act.target)
      const cx = other ? (a.x + other.x) / 2 : a.x
      drawConfetti(px, cx, Math.min(headTop(a), other ? headTop(other) : headTop(a)), t - act.start)
    }
    // ícone da atividade (sentado e trabalhando, esperando você ou terminou)
    const key =
      a.state === 'seated' && info.activity !== 'idle' && info.activity !== 'off'
        ? info.activity
        : a.state === 'visiting' && a.trip?.kind === 'note'
          ? 'writing'
          : null
    if (key) drawActivityBubble(g, px, key, x, a.pose === 'sit' ? y - 38 : y - 34, t)
  }

  /** Estagiário: andando, abrindo/fechando o banquinho ou sentado nele trabalhando, com o balão de atividade. */
  private drawIntern(g: CanvasRenderingContext2D, px: Px, i: Intern, t: number): void {
    const x = Math.round(i.x)
    const y = Math.round(i.y)
    const blink = t > i.blinkAt && t < i.blinkAt + 0.14
    if (t > i.blinkAt + 0.14) i.blinkAt = t + 2 + Math.random() * 4
    if (i.seed === this.hovered) {
      g.strokeStyle = 'rgba(212,168,73,0.55)'
      g.lineWidth = 1
      g.strokeRect(x - 10.5, y - 36.5, 21, 38)
    }
    if (i.phase === 'trabalhando') {
      const breath = Math.floor(t * 1.6 + i.slot * 0.5) % 2 === 1
      const tf = i.tool === 'typing' ? (Math.floor(t * 8 + i.slot) % 2 ? 1 : 3) : 0
      g.drawImage(sprite(i.look, 'sit', tf, false, false), 0, 0, 16, 22, x - 8, y - 38 + (breath ? 1 : 0), 16, 22)
      if (i.tool === 'reading') {
        px(x - 5, y - 21, 10, 6, '#f4f1e8')
        px(x - 4, y - 19, 7, 1, '#9aa3b5')
      }
      drawStool(px, x, y, 1)
      drawActivityBubble(g, px, i.tool ?? 'thinking', x, y - 38, t)
      return
    }
    const open = i.phase === 'abrindo' ? Math.min(1, (t - i.since) / STOOL_OPEN_S) : i.phase === 'fechando' ? Math.max(0, 1 - (t - i.since) / STOOL_FOLD_S) : 0
    // abrindo ou fechando: o banquinho fica ao lado, na altura da mão
    if (i.phase === 'abrindo' || i.phase === 'fechando') drawStool(px, x + 9, y, open)
    g.fillStyle = 'rgba(0,0,0,0.28)'
    g.beginPath()
    g.ellipse(x, y, 7, 2, 0, 0, Math.PI * 2)
    g.fill()
    const walking = i.phase === 'chegando' || i.phase === 'saindo'
    const frame = walking ? Math.floor(i.walkT * 8) % 4 : 0
    const view = i.facing === 'up' ? 'back' : i.facing === 'left' || i.facing === 'right' ? 'side' : 'front'
    const img = sprite(i.look, view, frame, false, blink)
    const bob = walking && frame % 2 === 1 ? 1 : 0
    g.save()
    if (i.facing === 'left') {
      g.translate(x, 0)
      g.scale(-1, 1)
      g.drawImage(img, -8, y - 32 - bob)
    } else g.drawImage(img, x - 8, y - 32 - bob)
    g.restore()
    // saindo com o banquinho fechado debaixo do braço
    if (i.phase === 'saindo') px(i.facing === 'left' ? x - 7 : x + 5, y - 19 - bob, 2, 10, '#6b5233')
  }

  /** Poça de sangue no chão ao lado da cadeira de quem levou a facadinha: cresce a cada estocada e some devagar. */
  private drawPuddles(g: CanvasRenderingContext2D, px: Px, t: number): void {
    for (const [id, h] of this.hurt) {
      const a = this.actors.get(id)
      if (!a || h.fx !== 'sangue') continue
      g.globalAlpha = Math.max(0, Math.min(1, (h.until - t) / 3))
      for (const [k, hit] of h.hits.entries()) {
        if (t < hit + 0.3) continue
        const grow = Math.min(1, (t - hit - 0.3) / 1.5)
        drawPool(px, a.x + 10 - k * 6, a.y + 3 + k * 3, 3 + grow * (6 - k * 2), 1 + grow * (2 - k * 0.5))
      }
      g.globalAlpha = 1
    }
  }

  /** Por cima de tudo: o céu escurece enquanto o Mjölnir sobe; raios e clarão; sangue espirrando e na tela. */
  private drawEffects(g: CanvasRenderingContext2D, px: Px, t: number): void {
    const W = this.scene.width
    const H = this.scene.height
    for (const a of this.actors.values()) {
      if (a.state !== 'visiting' || a.act?.kind !== 'bonk' || a.act.prop !== 'mjolnir') continue
      const dark = keyframes(t - a.act.start, [
        [0.8, 0],
        [1.3, 0.35],
        [2.4, 0.35],
        [2.9, 0]
      ])
      if (dark > 0) {
        g.fillStyle = `rgba(12, 14, 40, ${dark})`
        g.fillRect(0, 0, W, H)
      }
    }
    for (const [id, h] of this.hurt) {
      const a = this.actors.get(id)
      if (!a) continue
      for (const [k, hit] of h.hits.entries()) {
        const life = t - hit
        if (life < 0) continue
        if (h.fx === 'raio' && life < BOLT_S) drawLightning(g, px, a.x, headTop(a), life, h.seed + k * 7, W, H)
        if (h.fx !== 'sangue') continue
        if (life < 1.2) drawBloodSpray(px, a.x + 5, torsoY(a), a.y + 2, life, h.seed + k * 13)
        if (life < SPLAT_S) drawSplatter(g, px, W, H, life, h.seed + k * 31)
      }
    }
  }

  /** Bronca: o braço com o jornal ou a galinha descendo na cabeça do colega, ou a luva saindo na mola. */
  private drawBonk(px: Px, a: Actor, act: Extract<Act, { kind: 'bonk' }>, look: Look, t: number): void {
    const p = t - act.start
    const x = Math.round(a.x)
    const y = Math.round(a.y)
    const target = this.actors.get(act.target)
    const hx = target ? Math.round(target.x) + 3 : x - 17
    const hy = target ? headTop(target) + 3 : y - 35
    if (act.prop === 'faca') {
      // estocadas no ombro do colega: recolhe, crava, tira, de novo
      const e = keyframes(p, [
        [0, 0],
        [1, 0],
        [1.35, -0.4],
        [1.5, 1],
        [1.68, 1],
        [1.85, 0],
        [2, -0.4],
        [2.1, 1],
        [2.3, 1],
        [2.6, 0]
      ])
      const tx = target ? Math.round(target.x) + 5 : x - 15
      const ty = target ? torsoY(target) : y - 28
      drawKnife(px, x - 1, y - 17, tx, ty, e, look, p >= BONK_HITS[0]!)
      return
    }
    if (act.prop === 'luva') {
      const e = keyframes(p, [
        [0, 0],
        [1.45, 0],
        [1.5, 1],
        [1.65, 1],
        [1.85, 0],
        [2.05, 0],
        [2.1, 1],
        [2.25, 1],
        [2.5, 0]
      ])
      // antes de soltar, a mola treme na mão
      const jitter = p > 1 && p < 2.5 && e === 0 ? Math.floor(t * 24) % 2 : 0
      drawSpringGlove(px, x - 4, y - 12, hx + 1, hy + 2, e, jitter)
    } else {
      const sx = x - 1
      const sy = y - 18
      const hit = Math.atan2(hy - sy, hx - sx)
      // apoiado no ombro; puxa mais para trás, desce na cabeça, de novo, e volta ao ombro
      const rest = -Math.PI / 2 + 0.6
      const back = -Math.PI / 2 + 1
      const ang = keyframes(p, [
        [0, rest],
        [1, rest],
        [1.3, back],
        [1.5, hit],
        [1.7, hit],
        [1.88, back],
        [2.1, hit],
        [2.35, hit],
        [2.7, rest]
      ])
      drawSwing(px, sx, sy, ang, Math.max(14, Math.min(30, Math.hypot(hx - sx, hy - sy))), act.prop, look)
    }
    if (BONK_HITS.some((h) => p >= h && p < h + 0.14)) drawBurst(px, hx, hy - 2)
  }
}

/** Altura do peito/ombro do personagem (onde a faca entra). */
function torsoY(a: Actor): number {
  return Math.round(a.pose === 'sit' ? a.y - 24 : a.y - 18)
}

/** Pseudoaleatório estável (mesmo valor para a mesma semente): os efeitos não guardam partículas. */
function noise(n: number): number {
  const v = Math.sin(n * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

/** Topo da cabeça do personagem (sentado fica mais alto, atrás da mesa). */
function headTop(a: Actor): number {
  return Math.round(a.pose === 'sit' ? a.y - 38 : a.y - 32)
}

/** Interpolação linear entre quadros-chave [instante, valor] (antes do primeiro e depois do último, fica parado). */
function keyframes(p: number, keys: [number, number][]): number {
  if (p <= keys[0]![0]) return keys[0]![1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!
    if (p <= t1) {
      const [t0, v0] = keys[i - 1]!
      return v0 + ((v1 - v0) * (p - t0)) / (t1 - t0)
    }
  }
  return keys[keys.length - 1]![1]
}

/** Braço (manga e mão) com o jornal enrolado ou a galinha de borracha, num ângulo a partir do ombro. */
function drawSwing(px: Px, sx: number, sy: number, ang: number, reach: number, prop: 'jornal' | 'galinha' | 'mjolnir', look: Look): void {
  const cx = Math.cos(ang)
  const cy = Math.sin(ang)
  const dot = (d: number, w: number, c: string): void => px(sx + cx * d - w / 2, sy + cy * d - w / 2, w, w, c)
  for (let d = 0; d < 4; d++) dot(d, 2, look.shirt)
  dot(4, 2, look.skin)
  dot(5, 2, look.skin)
  const len = Math.round(reach) - 6
  if (prop === 'mjolnir') {
    // cabo curto com tiras de couro e a cabeça de pedra atravessada na ponta
    const handle = Math.max(3, len - 6)
    for (let d = 6; d < 6 + handle; d++) dot(d, 2, (d - 6) % 2 ? '#3b2a1e' : '#7a5232')
    const nx = -cy
    const ny = cx
    const at = (d: number, k: number, w: number, c: string): void => px(sx + cx * d + nx * k, sy + cy * d + ny * k, w, w, c)
    const d0 = 6 + handle
    for (let d = d0; d < d0 + 6; d++) for (let k = -4; k <= 4; k++) at(d, k, 2, '#9aa3b5')
    for (let d = d0 + 1; d < d0 + 5; d++) for (let k = -3; k <= -1; k++) at(d, k, 1, '#dfe3ea')
    for (let k = -4; k <= 4; k++) {
      at(d0, k, 1, '#5b6270')
      at(d0 + 5, k, 1, '#5b6270')
    }
    for (let d = d0; d < d0 + 6; d++) {
      at(d, -4, 1, '#5b6270')
      at(d, 4, 1, '#5b6270')
    }
    return
  }
  if (prop === 'jornal') {
    for (let d = 6; d < 6 + len; d++) dot(d, 3, (d - 6) % 4 === 2 ? '#9aa3b5' : '#ece8dc')
    dot(6 + len, 2, '#c9c2b0')
    return
  }
  // segura pelos pés: corpo amarelo, pescoço fino e a cabeça com crista vermelha e bico laranja
  for (let d = 6; d < 6 + len - 2; d++) dot(d, d < 10 ? 3 : 2, '#f2d13c')
  const hx = sx + cx * (4 + len)
  const hy = sy + cy * (4 + len)
  px(hx - 2, hy - 2, 4, 4, '#f2d13c')
  px(hx - 1, hy - 4, 2, 2, '#e5534b')
  px(hx + (cx < 0 ? -4 : 2), hy - 1, 2, 1, '#e0884f')
  px(hx + (cx < 0 ? -1 : 0), hy - 1, 1, 1, '#1d2433')
}

/**
 * Faca: o braço sai do ombro e a ponta da lâmina vai até o colega (e = 0 na mão, 1 cravada; negativo = puxando
 * para trás). Depois da primeira estocada, a ponta fica vermelha.
 */
function drawKnife(px: Px, sx: number, sy: number, tx: number, ty: number, e: number, look: Look, bloody: boolean): void {
  const dist = Math.max(1, Math.hypot(tx - sx, ty - sy))
  const ux = (tx - sx) / dist
  const uy = (ty - sy) / dist
  // mão: perto do peito; na estocada, cabo (3) + guarda (1) + lâmina (6) chegam até o colega
  const hand = Math.max(3, 4 + e * (dist - 13))
  const dot = (d: number, w: number, c: string): void => px(sx + ux * d - w / 2, sy + uy * d - w / 2, w, w, c)
  for (let d = 0; d < hand - 1; d++) dot(d, 2, look.shirt)
  dot(hand - 1, 2, look.skin)
  for (let d = hand; d < hand + 3; d++) dot(d, 2, '#5b3a1e')
  dot(hand + 3, 3, '#5b6270')
  for (let d = hand + 4; d < hand + 10; d++) dot(d, d < hand + 8 ? 2 : 1, bloody && d >= hand + 7 ? '#b3121b' : '#dfe3ea')
}

/** Luva de boxe na mola: estica do peito até a cabeça do colega (e = 0 encolhida, 1 esticada). */
function drawSpringGlove(px: Px, cx: number, cy: number, tx: number, ty: number, e: number, jitter: number): void {
  const dist = Math.max(1, Math.hypot(tx - cx, ty - cy))
  const ux = (tx - cx) / dist
  const uy = (ty - cy) / dist
  const len = 3 + e * Math.max(0, dist - 6)
  px(cx - 2, cy - 1, 4, 3, '#5b6270')
  for (let d = 0; d < len; d++) {
    const off = Math.floor(d / 2) % 2 ? 1.5 : -1.5
    px(cx + ux * d - uy * off, cy + uy * d + ux * off, 1, 1, '#b9c0cf')
  }
  const gx = cx + ux * (len + 3) + jitter
  const gy = cy + uy * (len + 3)
  px(gx - ux * 3 - 1, gy - uy * 3 - 1, 2, 2, '#f4f1e8')
  px(gx - 3, gy - 2, 6, 5, '#d9413b')
  px(gx - 2, gy - 3, 4, 7, '#d9413b')
  px(gx - 2, gy - 2, 2, 1, '#f08a80')
}

/** Poça (elipse em pixels) com um brilho. */
function drawPool(px: Px, cx: number, cy: number, rx: number, ry: number): void {
  const r = Math.max(1, Math.round(ry))
  for (let dy = -r; dy <= r; dy++) {
    const hw = rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2))
    px(cx - hw, cy + dy, Math.max(1, Math.round(hw * 2)), 1, '#7d0a12')
  }
  px(cx - rx / 3, cy - ry / 2, Math.max(1, Math.round(rx / 3)), 1, '#b3121b')
}

/** Gotas de sangue espirrando a cada estocada; caem com gravidade até o chão (`life` = segundos desde a estocada). */
function drawBloodSpray(px: Px, ox: number, oy: number, floorY: number, life: number, seed: number): void {
  for (let i = 0; i < 14; i++) {
    const vx = (noise(seed + i * 1.7) - 0.3) * 80
    const vy = -(25 + noise(seed + i * 2.9) * 50)
    const x = ox + vx * life
    const y = oy + vy * life + 110 * life * life
    if (y > floorY + noise(seed + i * 3.7) * 6) continue
    const big = noise(seed + i * 5.3) > 0.5
    px(x, y, big ? 2 : 1, big ? 2 : 1, noise(seed + i * 7.1) > 0.4 ? '#c0141e' : '#7d0a12')
  }
}

/** Respingos de sangue na própria tela (como dano num jogo): vinheta vermelha e manchas nas beiradas que escorrem. */
function drawSplatter(g: CanvasRenderingContext2D, px: Px, W: number, H: number, life: number, seed: number): void {
  g.globalAlpha = life < 0.9 ? 1 : Math.max(0, 1 - (life - 0.9) / (SPLAT_S - 0.9))
  const grad = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75)
  grad.addColorStop(0, 'rgba(140, 0, 0, 0)')
  grad.addColorStop(1, `rgba(140, 0, 0, ${life < 0.15 ? 0.6 : 0.4})`)
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  for (let s = 0; s < 3; s++) {
    // perto de uma das beiradas, longe do meio da cena
    const side = Math.floor(noise(seed + s * 9.1) * 4)
    const u = 0.1 + noise(seed + s * 3.3) * 0.8
    const cx = side === 0 ? W * (0.04 + noise(seed + s) * 0.12) : side === 1 ? W * (0.84 + noise(seed + s) * 0.12) : W * u
    const cy = side === 2 ? H * (0.05 + noise(seed + s * 2) * 0.15) : side === 3 ? H * (0.8 + noise(seed + s * 2) * 0.12) : H * u
    const r = (8 + noise(seed + s * 5.5) * 10) * Math.min(1, life / 0.08)
    drawBlob(px, cx, cy, r, seed + s, life)
  }
  g.globalAlpha = 1
}

/** Mancha irregular com gotinhas em volta e três fios escorrendo. */
function drawBlob(px: Px, cx: number, cy: number, r: number, seed: number, life: number): void {
  const ri = Math.round(r)
  for (let dy = -ri; dy <= ri; dy++) {
    const wob = 1 + 0.22 * Math.sin(dy * 1.3 + seed) + 0.12 * Math.sin(dy * 3.1 + seed * 2)
    const hw = Math.sqrt(Math.max(0, r * r - dy * dy)) * wob
    px(cx - hw, cy + dy, Math.max(1, Math.round(hw * 2)), 1, '#9e0b14')
  }
  px(cx - r / 3, cy - r / 2, Math.max(1, Math.round(r / 4)), 1, '#c81d25')
  for (let i = 0; i < 6; i++) {
    const ang = noise(seed + i * 2.7) * Math.PI * 2
    const d = r + 2 + noise(seed + i * 3.9) * 6
    const w = noise(seed + i * 8.3) > 0.5 ? 2 : 1
    px(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, w, w, '#9e0b14')
  }
  for (let k = 0; k < 3; k++) {
    const dx = (noise(seed + k * 4.1) - 0.5) * r * 1.2
    const len = Math.round(Math.min(r * 1.6, life * 22) * (0.5 + noise(seed + k * 6.2)))
    px(cx + dx, cy + r * 0.6, 2, len, '#8a0a12')
    px(cx + dx - 0.5, cy + r * 0.6 + len, 3, 2, '#8a0a12')
  }
}

/** Raios do teto até a cabeça do colega (piscando e mudando de forma), clarão na tela e faíscas em volta. */
function drawLightning(g: CanvasRenderingContext2D, px: Px, cx: number, top: number, life: number, seed: number, W: number, H: number): void {
  if (life < 0.12) {
    g.fillStyle = `rgba(255, 252, 225, ${0.55 * (1 - life / 0.12)})`
    g.fillRect(0, 0, W, H)
  }
  const flick = Math.floor(life * 20)
  if (flick % 3 !== 2) {
    for (let b = 0; b < 3; b++) {
      const pts: ScenePoint[] = [{ x: cx + (noise(seed + b * 3.1) - 0.5) * 60, y: 0 }]
      const endX = cx + (b - 1) * 3
      const steps = 9
      for (let k = 1; k <= steps; k++) {
        const prev = pts[k - 1]!
        const x = k === steps ? endX : prev.x + (endX - prev.x) / (steps - k + 1) + (noise(seed + b * 17 + k * 5 + flick) - 0.5) * 12
        pts.push({ x, y: (top * k) / steps })
      }
      for (const [w, c] of [
        [3, '#ffe66b'],
        [1, '#ffffff']
      ] as const) {
        for (let k = 1; k < pts.length; k++) {
          const p = pts[k - 1]!
          const q = pts[k]!
          const n = Math.max(1, Math.ceil(Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y))))
          for (let i = 0; i <= n; i++) px(p.x + ((q.x - p.x) * i) / n - (w - 1) / 2, p.y + ((q.y - p.y) * i) / n, w, 1, c)
        }
      }
    }
  }
  for (let i = 0; i < 12; i++) {
    const ang = noise(seed + i * 2.3) * Math.PI * 2
    const r = 4 + life * 40 * (0.5 + noise(seed + i * 4.7))
    px(cx + Math.cos(ang) * r, top + 4 + Math.sin(ang) * r * 0.6, 1, 1, i % 2 ? '#fff6a8' : '#9fd8ff')
  }
}

const BURST = ['...#...', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.', '...#...']
/** Estouro amarelo no instante da pancada. */
function drawBurst(px: Px, x: number, y: number): void {
  for (let r = 0; r < BURST.length; r++) {
    for (let k = 0; k < 7; k++) {
      if (BURST[r]![k] === '#') px(x - 3 + k, y - 3 + r, 1, 1, Math.abs(r - 3) + Math.abs(k - 3) <= 1 ? '#ffffff' : '#ffd23f')
    }
  }
}

/** Estrelinhas girando em volta da cabeça de quem levou a bronca. */
function drawDizzy(px: Px, cx: number, top: number, t: number): void {
  for (let i = 0; i < 3; i++) {
    const ang = t * 5 + (i * Math.PI * 2) / 3
    const sx = Math.round(cx + Math.cos(ang) * 9)
    const sy = Math.round(top - 3 + Math.sin(ang) * 3)
    // sombra escura atrás para a estrela aparecer em cima da mesa e do monitor
    px(sx - 1, sy + 1, 5, 1, '#5a4310')
    px(sx + 1, sy - 1, 1, 5, '#5a4310')
    px(sx - 2, sy, 5, 1, '#ffd23f')
    px(sx, sy - 2, 1, 5, '#ffd23f')
    px(sx, sy, 1, 1, '#ffffff')
  }
}

const CONFETTI = ['#e5534b', '#d4a849', '#59b37a', '#5b8def', '#c2507a', '#f4f1e8']
/** Confete caindo sobre os dois na comemoração (p = segundos desde a chegada). */
function drawConfetti(px: Px, cx: number, top: number, p: number): void {
  for (let i = 0; i < 16; i++) {
    const life = p - 0.2 - (i % 5) * 0.1
    if (life < 0 || life > 1.5) continue
    const x = cx + ((i * 29) % 36) - 18 + Math.sin(life * 7 + i) * 2
    const y = top - 16 + life * 24 + ((i * 7) % 6)
    px(x, y, i % 2 ? 1 : 2, i % 2 ? 2 : 1, CONFETTI[i % CONFETTI.length]!)
  }
}

/** O que um monitor extra mostra: parado, desligado ou esperando, igual ao principal; trabalhando, outra coisa. */
function sideScreen(activity: AgentActivity, k: number): AgentActivity {
  if (activity === 'off' || activity === 'idle' || activity === 'waiting' || activity === 'attention') return activity
  const others = (['terminal', 'browser', 'reading', 'typing'] as const).filter((a) => a !== activity)
  return others[(k - 1) % others.length]!
}

/** Balãozinho com o ícone da atividade em cima da cabeça (`top` = topo do personagem). */
function drawActivityBubble(g: CanvasRenderingContext2D, px: Px, key: string, x: number, top: number, t: number): void {
  let by = top - 13
  const bg = key === 'waiting' || key === 'attention' ? '#f7d774' : '#f4f1e8'
  if ((key === 'waiting' || key === 'attention') && Math.floor(t * 3) % 2) by -= 1
  px(x - 7, by, 15, 11, '#1d2433')
  px(x - 6, by + 1, 13, 9, bg)
  px(x - 1, by + 11, 3, 1, '#1d2433')
  px(x, by + 12, 1, 1, '#1d2433')
  drawIcon(g, key, x - 3, by + 3, '#1d2433')
}

/** Banquinho dobrável: assento de lona e pernas em X (`open` 0 = fechado, uma ripa em pé; 1 = aberto). */
function drawStool(px: Px, x: number, y: number, open: number): void {
  const top = y - 14
  if (open <= 0.05) {
    px(x - 1, top, 2, 14, '#6b5233')
    return
  }
  const half = Math.max(1, Math.round(6 * open))
  for (let k = 0; k <= 10; k++) {
    const f = k / 10
    const dy = top + 3 + Math.round(f * 11)
    px(x - half + Math.round(f * half * 2), dy, 1, 1, '#5b4630')
    px(x + half - Math.round(f * half * 2), dy, 1, 1, '#5b4630')
  }
  px(x - half - 1, top, half * 2 + 3, 2, '#b0563b')
  px(x - half - 1, top + 2, half * 2 + 3, 1, '#7e3a28')
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

const ICON: Record<string, string[]> = {
  typing: ['.......', '#######', '#.#.#.#', '#######', '#.....#', '#######'],
  reading: ['.##.##.', '#..#..#', '#..#..#', '#..#..#', '.##.##.'],
  terminal: ['#......', '.#.....', '..#....', '.#.....', '#..###.'],
  browser: ['..###..', '.#.#.#.', '#######', '.#.#.#.', '..###..'],
  writing: ['.....##', '....###', '...###.', '..###..', '.###...', '##.....'],
  thinking: ['.......', '.......', '#.#.#..'],
  waiting: ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'],
  attention: ['..#..', '..#..', '..#..', '..#..', '.....', '..#..']
}

function drawIcon(g: CanvasRenderingContext2D, key: string, x: number, y: number, c: string): void {
  const rows = ICON[key]
  if (!rows) return
  g.fillStyle = c
  for (let r = 0; r < rows.length; r++) for (let k = 0; k < rows[r]!.length; k++) if (rows[r]![k] === '#') g.fillRect(x + k, y + r, 1, 1)
}

/**
 * Arquivo de gavetas de aço (histórico de chamados), visto como as mesas: tampo claro, frente com quatro
 * gavetas, sombra embaixo. Com alguém consultando, a segunda gaveta fica aberta, com as pastas à mostra.
 */
function drawArchive(g: CanvasRenderingContext2D, px: Px, x: number, y: number, open: boolean, hover: boolean): void {
  const left = x - 13
  g.fillStyle = 'rgba(0,0,0,0.22)'
  g.beginPath()
  g.ellipse(x, y + 1, 16, 3, 0, 0, Math.PI * 2)
  g.fill()
  // corpo: tampo, frente e lateral sombreada
  px(left - 1, y - 49, 28, 49, '#5b6270')
  px(left, y - 48, 26, 5, '#eef0f4')
  px(left, y - 43, 26, 43, '#cdd2da')
  px(left + 22, y - 43, 4, 43, '#aab1bc')
  for (let k = 0; k < 4; k++) {
    const dy = y - 41 + k * 10
    const isOpen = open && k === 1
    if (isOpen) {
      // gaveta puxada para fora: interior com as pastas e a frente mais embaixo
      px(left + 1, dy, 21, 6, '#6b7385')
      for (const [i, c] of ['#d4a849', '#5b8def', '#e5534b', '#59b37a', '#ece8dc'].entries()) px(left + 3 + i * 4, dy - 2 + (i % 2), 3, 4, c)
      px(left + 1, dy + 5, 21, 9, '#dde1e7')
      px(left + 1, dy + 13, 21, 1, '#8d95a6')
      px(left + 8, dy + 8, 7, 2, '#3a4050')
      continue
    }
    px(left + 1, dy, 21, 9, '#dde1e7')
    px(left + 1, dy, 21, 1, '#f4f6f9')
    px(left + 1, dy + 8, 21, 1, '#8d95a6')
    px(left + 9, dy + 2, 5, 2, '#f4f1e8')
    px(left + 9, dy + 2, 5, 1, '#b9c0cf')
    px(left + 8, dy + 5, 7, 2, '#3a4050')
  }
  px(left + 1, y - 1, 3, 2, '#3a4050')
  px(left + 22, y - 1, 3, 2, '#3a4050')
  if (hover) {
    g.strokeStyle = 'rgba(212,168,73,0.7)'
    g.lineWidth = 1
    g.strokeRect(left - 2.5, y - 50.5, 31, 53)
  }
}

function drawChair(px: Px, x: number, y: number, occupied: boolean): void {
  px(x - 9, y - 20, 18, 14, '#323d5a')
  px(x - 9, y - 20, 18, 2, '#43507a')
  px(x - 7, y - 16, 14, 1, '#2a334c')
  px(x - 7, y - 12, 14, 1, '#2a334c')
  px(x - 8, y - 6, 16, 3, '#2a334c')
  px(x - 1, y - 3, 2, 3, '#1c2232')
  px(x - 8, y, 16, 1, '#1c2232')
  px(x - 9, y + 1, 2, 2, '#11151f')
  px(x - 1, y + 1, 2, 2, '#11151f')
  px(x + 7, y + 1, 2, 2, '#11151f')
  if (!occupied) px(x - 8, y - 9, 16, 3, '#3a466a')
}

function drawSegment(px: Px, p: ScenePoint, q: ScenePoint, note: boolean, lit: boolean, t: number, style: PathStyle): void {
  const w = note ? 6 : 14
  const x = Math.min(p.x, q.x) - w / 2
  const y = Math.min(p.y, q.y) - w / 2
  const rw = Math.abs(q.x - p.x) + w
  const rh = Math.abs(q.y - p.y) + w
  if (note) {
    px(x, y, rw, rh, style.walk.edge)
    px(x + 1, y + 1, rw - 2, rh - 2, lit ? style.walk.lit : style.walk.fill)
    return
  }
  const c = style.carpet
  px(x, y, rw, rh, c.edge)
  px(x + 1, y + 1, rw - 2, rh - 2, lit ? mix(c.fill, c.lit, 0.3 + 0.2 * Math.sin(t * 9)) : c.fill)
  const along = rw >= rh
  if (c.dashes === 'stripes') {
    if (along) {
      for (let k = x + 3; k < x + rw - 4; k += 8) {
        px(k, y + 2, 4, 1, c.dash)
        px(k + 4, y + rh - 3, 4, 1, c.dash)
      }
    } else {
      for (let j = y + 3; j < y + rh - 4; j += 8) {
        px(x + 2, j, 1, 4, c.dash)
        px(x + rw - 3, j + 4, 1, 4, c.dash)
      }
    }
  } else if (c.dashes === 'stones') {
    // pedras de calçamento em duas fileiras desencontradas
    if (along) {
      for (let k = x + 2, i = 0; k < x + rw - 5; k += 6, i++) px(k + (i % 2) * 3, y + 2 + (i % 2) * 5, 4, 3, c.dash)
    } else {
      for (let j = y + 2, i = 0; j < y + rh - 5; j += 6, i++) px(x + 2 + (i % 2) * 5, j + (i % 2) * 3, 3, 4, c.dash)
    }
  } else if (along) {
    for (let k = x + 4; k < x + rw - 4; k += 6) px(k, y + rh / 2 - 1, 2, 2, c.dash)
  } else {
    for (let j = y + 4; j < y + rh - 4; j += 6) px(x + rw / 2 - 1, j, 2, 2, c.dash)
  }
}

/** "z z z" subindo devagar (agente hibernando). */
function drawZs(px: Px, x: number, y: number, t: number): void {
  const Z = ['###', '..#', '.#.', '#..', '###']
  for (let i = 0; i < 3; i++) {
    const phase = (t * 0.6 + i / 3) % 1
    const zx = x + i * 5 + Math.round(phase * 3)
    const zy = y - Math.round(phase * 14) - i * 2
    const c = phase < 0.75 ? '#9db4d8' : '#5d6e8c'
    for (let r = 0; r < Z.length; r++) for (let k = 0; k < 3; k++) if (Z[r]![k] === '#') px(zx + k, zy + r, 1, 1, c)
  }
}

function drawScreen(px: Px, s: AgentActivity, roleColor: string, x: number, y: number, w: number, h: number, t: number): void {
  if (s === 'off') {
    px(x, y, w, h, '#0b0d13')
    return
  }
  if (s === 'idle') {
    px(x, y, w, h, '#1f2537')
    px(x + 2, y + h - 3, 3, 1, roleColor)
    return
  }
  if (s === 'waiting' || s === 'attention') {
    const on = Math.floor(t * 2.5) % 2
    px(x, y, w, h, on ? '#f7e3a8' : '#3a3420')
    const rows = s === 'waiting' ? ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'] : ['..#..', '..#..', '..#..', '..#..', '.....', '..#..']
    for (let r = 0; r < rows.length; r++) for (let k = 0; k < 5; k++) if (rows[r]![k] === '#') px(x + 10 + k, y + 5 + r, 1, 1, on ? '#7a5a10' : '#f7e3a8')
    return
  }
  if (s === 'typing') {
    px(x, y, w, h, '#151a28')
    px(x, y, 4, h, '#1c2234')
    const n = Math.floor(t * 4) % 7
    const colors = ['#7ab0ff', '#e7bd5c', '#c9a0dc', '#8fd8b0', '#f4f1e8', '#7ab0ff', '#e7bd5c']
    for (let i = 0; i < 7; i++) {
      const len = 4 + ((i * 5 + n) % 13)
      px(x + 6 + (i % 3) * 2, y + 2 + i * 2, i === 6 ? Math.min(len, 2 + n * 2) : len, 1, colors[i]!)
    }
    return
  }
  if (s === 'reading') {
    px(x, y, w, h, '#e9ecf3')
    px(x + 3, y + 2, 12, 2, '#3b4a6b')
    for (let r = 0; r < 5; r++) px(x + 3, y + 6 + r * 2, 18 - (r % 2) * 6, 1, '#8590a8')
    return
  }
  if (s === 'terminal') {
    px(x, y, w, h, '#0c0f14')
    const off = Math.floor(t * 5) % 5
    for (let l = 0; l < 6; l++) px(x + 2, y + 2 + l * 3, 4 + (((l + off) * 7) % 18), 1, l === 5 ? '#e7bd5c' : '#5fd38d')
    return
  }
  if (s === 'browser') {
    px(x, y, w, h, '#f4f6fa')
    px(x, y, w, 3, '#2f62c9')
    px(x + 2, y + 1, 1, 1, '#e5534b')
    px(x + 4, y + 1, 1, 1, '#d4a849')
    px(x + 3, y + 6, 20, 3, '#c6cfdc')
    px(x + 3, y + 11, 14, 3, '#c6cfdc')
    px(x + 18, y + 13, 6, 3, '#2f62c9')
    if (Math.floor(t * 2) % 2) px(x + 14, y + 12, 2, 2, '#e5534b')
    return
  }
  if (s === 'writing') {
    px(x, y, w, h, '#fbfaf5')
    px(x + 3, y + 2, 14, 2, '#2d3a55')
    px(x + 3, y + 6, 9, 7, '#9bbcec')
    px(x + 14, y + 6, 9, 1, '#8590a8')
    px(x + 14, y + 9, 7, 1, '#8590a8')
    px(x + 14, y + 12, 8, 1, '#8590a8')
    return
  }
  // pensando
  px(x, y, w, h, '#1f2537')
  for (let d = 0; d < 3; d++) if (Math.floor(t * 3) % 3 >= d) px(x + 8 + d * 4, y + 8, 2, 2, '#d4a849')
}
