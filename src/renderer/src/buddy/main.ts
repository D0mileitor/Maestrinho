import { buddySlotX, type BuddyBridge, type BuddyCall } from '@shared/buddy'
import { sprite } from '../office/sprites'
import { t } from '../i18n'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import './buddy.css'

/**
 * Janela do personagem (fora do app), uma faixa transparente na parte de baixo da tela. Cada aviso é um
 * agente com balão em cima da cabeça; ficam lado a lado no canto direito (o mais recente no canto). Eles
 * entram andando pela direita, abrem espaço quando chega outro e, ao sair, viram e atravessam a tela
 * inteira andando para a esquerda — e seguem pelos outros monitores, na ordem do Windows (o main leva o
 * agente para a faixa do monitor à esquerda, onde ele entra pela direita, sem balão, e continua andando).
 * De tempos em tempos levantam os braços e pulam para chamar você.
 */

declare global {
  interface Window {
    maestrinhoBuddy: BuddyBridge
  }
}

const B = t.buddy
const bridge = window.maestrinhoBuddy
const stage = document.getElementById('stage')!
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const SCALE = 3
const CW = 16 * SCALE + 10
const CH = 32 * SCALE + 12
/** Velocidades em px/s: chegando/abrindo espaço e saindo pela esquerda. */
const WALK = 240
const LEAVE = 430

interface Card {
  /** Chave na lista (o terminal; agentes de passagem ganham uma chave própria). */
  key: string
  call: BuddyCall
  el: HTMLElement
  canvas: HTMLCanvasElement
  x: number
  target: number
  leaving: boolean
  /** Já chegou ao lugar alguma vez (o balão aparece e continua junto se ele andar de novo). */
  arrived: boolean
  walkT: number
  facingLeft: boolean
  /** Último "chamado" (braços para cima e pulo). */
  calledAt: number
}

const cards = new Map<string, Card>()
/** Ordem atual dos avisos (o primeiro fica no canto direito). */
let order: string[] = []
let idleSent = true
let passSeq = 0
let sentRects = ''

/** Informa ao main onde estão os balões e agentes clicáveis (só quando mudam). */
function reportRects(): void {
  const rects: { x: number; y: number; w: number; h: number }[] = []
  for (const card of cards.values()) {
    if (card.leaving) continue
    const parts = card.arrived ? [card.el.querySelector('.bubble')!, card.canvas] : [card.canvas]
    for (const el of parts) {
      const r = el.getBoundingClientRect()
      rects.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
    }
  }
  const key = JSON.stringify(rects)
  if (key === sentRects) return
  sentRects = key
  bridge.rects(rects)
}

function build(call: BuddyCall, key = call.terminalId): Card {
  const el = document.createElement('article')
  el.innerHTML = `
    <div class="bubble">
      <div class="who"><span class="dot"></span><b class="name"></b><span class="role"></span></div>
      <div class="headline"></div>
      <div class="text"></div>
      <div class="actions">
        <button type="button" class="open"></button>
        <button type="button" class="dismiss"></button>
      </div>
    </div>
    <canvas class="agent"></canvas>`
  const canvas = el.querySelector('canvas')!
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(CW * dpr)
  canvas.height = Math.round(CH * dpr)
  canvas.style.width = `${CW}px`
  canvas.style.height = `${CH}px`
  const card: Card = {
    key,
    call,
    el,
    canvas,
    x: window.innerWidth + 20,
    target: window.innerWidth + 20,
    leaving: false,
    arrived: false,
    walkT: 0,
    facingLeft: true,
    calledAt: performance.now() / 1000
  }
  const open = (): void => bridge.action({ terminalId: card.call.terminalId, action: 'open' })
  el.querySelector<HTMLButtonElement>('.open')!.addEventListener('click', open)
  canvas.addEventListener('click', open)
  el.querySelector<HTMLButtonElement>('.dismiss')!.addEventListener('click', () => bridge.action({ terminalId: card.call.terminalId, action: 'dismiss' }))
  fill(card)
  return card
}

function fill(card: Card): void {
  const { call, el } = card
  el.className = `card k-${call.kind}`
  el.style.setProperty('--c', call.roleColor || '#7d8597')
  el.querySelector('.name')!.textContent = call.name
  el.querySelector('.role')!.textContent = call.roleName
  el.querySelector('.headline')!.textContent = call.headline
  el.querySelector('.text')!.textContent = call.text
  const openBtn = el.querySelector<HTMLButtonElement>('.open')!
  openBtn.textContent = B.open
  openBtn.title = B.openTitle(call.name)
  const dismiss = el.querySelector<HTMLButtonElement>('.dismiss')!
  dismiss.textContent = '×'
  dismiss.title = B.dismiss
  dismiss.setAttribute('aria-label', B.dismiss)
  card.canvas.title = B.openTitle(call.name)
}

function sync(calls: BuddyCall[]): void {
  const keep = new Set(calls.map((c) => c.terminalId))
  for (const card of cards.values()) {
    if (keep.has(card.call.terminalId) || card.leaving) continue
    // Sai: o balão some e ele atravessa a tela andando para a esquerda.
    card.leaving = true
    card.target = -CW - 40
    card.el.classList.add('leaving')
    if (reduced) card.x = card.target
  }
  calls.forEach((call, i) => {
    let card = cards.get(call.terminalId)
    if (!card || card.leaving) {
      if (card) card.el.remove()
      card = build(call)
      cards.set(call.terminalId, card)
      stage.appendChild(card.el)
    } else if (card.call.at !== call.at) {
      card.call = call
      fill(card)
      card.calledAt = -10
    }
    card.target = buddySlotX(i, window.innerWidth)
    if (reduced) card.x = card.target
  })
  if (calls.length) idleSent = false
}

function draw(card: Card, now: number, moving: boolean): void {
  const g = card.canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, CW, CH)
  g.imageSmoothingEnabled = false
  const every = card.call.kind === 'waiting' ? 2.6 : 4.2
  if (!moving && !card.leaving && now - card.calledAt > every) card.calledAt = now
  const sinceCall = now - card.calledAt
  const calling = !reduced && !moving && !card.leaving && sinceCall < 0.9
  const cheer = calling && Math.floor(sinceCall / 0.18) % 2 === 0
  const x0 = 5
  const y0 = 8 + (cheer ? -4 : 0)
  g.fillStyle = 'rgba(0,0,0,0.25)'
  g.beginPath()
  g.ellipse(x0 + 8 * SCALE, CH - 6, 7 * SCALE * (cheer ? 0.8 : 1), 4, 0, 0, Math.PI * 2)
  g.fill()
  const look = card.call.look
  if (moving) {
    // De lado andando; o desenho olha para a direita, então espelha para ir à esquerda.
    const img = sprite(look, 'side', Math.floor(card.walkT * 10) % 4, false, false)
    if (card.facingLeft) {
      g.save()
      g.translate(x0 + 16 * SCALE, y0)
      g.scale(-1, 1)
      g.drawImage(img, 0, 0, 16, 32, 0, 0, 16 * SCALE, 32 * SCALE)
      g.restore()
    } else {
      g.drawImage(img, 0, 0, 16, 32, x0, y0, 16 * SCALE, 32 * SCALE)
    }
    return
  }
  const breath = Math.floor(now * 1.6) % 2 === 1
  const blink = now % 3.7 < 0.12
  g.drawImage(sprite(look, cheer ? 'cheer' : 'front', 0, !cheer && breath, blink), 0, 0, 16, 32, x0, y0, 16 * SCALE, 32 * SCALE)
}

let last = performance.now() / 1000
function frame(): void {
  const now = performance.now() / 1000
  const dt = Math.min(0.05, now - last)
  last = now
  for (const card of [...cards.values()]) {
    const dx = card.target - card.x
    const moving = Math.abs(dx) > 0.5
    if (moving) {
      const step = Math.min(Math.abs(dx), (card.leaving ? LEAVE : WALK) * dt)
      card.x += Math.sign(dx) * step
      card.facingLeft = dx < 0
      card.walkT += dt
    } else {
      card.x = card.target
      if (card.leaving) {
        card.el.remove()
        cards.delete(card.key)
        // Saiu pela borda esquerda: o main o leva para o monitor seguinte (se houver).
        bridge.exited(card.call.terminalId)
        continue
      }
      card.arrived = true
    }
    card.el.style.transform = `translateX(${Math.round(card.x)}px)`
    card.el.classList.toggle('arrived', card.arrived && !card.leaving)
    draw(card, now, moving)
  }
  reportRects()
  if (cards.size === 0 && !idleSent) {
    idleSent = true
    bridge.idle()
  }
  requestAnimationFrame(frame)
}

// Mudou a largura da tela (outro monitor): reposiciona a fila na ordem dos avisos.
window.addEventListener('resize', () => {
  order.forEach((id, i) => {
    const card = cards.get(id)
    if (card && !card.leaving) card.target = buddySlotX(i, window.innerWidth)
  })
})

// Agente de passagem (veio do monitor à direita): entra pela direita, sem balão, e atravessa.
bridge.onWalk((call) => {
  const card = build(call, `passagem:${call.terminalId}:${++passSeq}`)
  card.leaving = true
  card.arrived = true
  card.target = -CW - 40
  card.el.classList.add('leaving')
  if (reduced) card.x = card.target
  cards.set(card.key, card)
  stage.appendChild(card.el)
  idleSent = false
})

bridge.onCalls((calls) => {
  order = calls.map((c) => c.terminalId)
  sync(calls)
})
bridge.ready()
requestAnimationFrame(frame)
