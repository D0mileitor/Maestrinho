import { z } from 'zod'
import type { Look } from './schemas'

/**
 * Aviso com o personagem: quando o app está minimizado (ou sem foco), o próprio agente aparece no canto
 * da tela com um balão. Aqui ficam o formato do aviso e as regras puras da fila; a janela é do main.
 */

export type BuddyKind = 'done' | 'waiting' | 'message'

export interface BuddyCall {
  terminalId: string
  name: string
  roleName: string
  roleColor: string
  look: Look
  kind: BuddyKind
  /** Frase curta do balão ("Terminei!", "Preciso de você!", título do orq notify). */
  headline: string
  /** Detalhe: resumo, última linha da tela ou a pergunta que o agente fez. */
  text: string
  at: number
  /**
   * Início da contagem de 1 minuto. Ausente = ainda não conta (o computador está bloqueado: o agente
   * espera você desbloquear e só então o minuto começa).
   */
  since?: number
}

/** Quantos personagens aparecem de uma vez (os mais recentes). */
export const BUDDY_MAX = 3
/**
 * A janela ocupa a faixa de baixo da tela inteira (transparente, o clique atravessa): os agentes ficam
 * lado a lado no canto direito e, ao sair, atravessam a tela andando para a esquerda.
 */
export const BUDDY_HEIGHT = 310
/** Largura de cada agente com o balão em cima. */
export const BUDDY_CARD_W = 272
export const BUDDY_MARGIN = 8
/**
 * Cada agente fica na tela por até 1 minuto; sem "Abrir" nem "×", sai sozinho andando para a esquerda
 * (o terminal continua marcado no app).
 */
export const BUDDY_MAX_AGE_MS = 60 * 1000
const MAX_TEXT = 220

/** Posição (borda esquerda) do agente na fila: o mais recente (0) fica no canto direito. */
export function buddySlotX(index: number, screenWidth: number): number {
  return screenWidth - BUDDY_MARGIN - (index + 1) * BUDDY_CARD_W
}

export function clipBuddyText(text: string, max = MAX_TEXT): string {
  const clean = text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * Última linha de saída de verdade da tela de um terminal: pula o prompt do shell (PowerShell, cmd, bash)
 * e a linha do comando digitado, que não dizem nada no balão. Vazio = nada útil.
 */
export function lastOutputLine(screen: string): string {
  const lines = screen
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!
    if (l.length < 300 && /[$#%>]$/.test(l)) continue // prompt esperando comando
    if (/^(?:PS )?[A-Za-z]:\\[^>]*>/.test(l) || /^[\w.-]+@[\w.-]+:[^$#]*[$#]\s/.test(l)) continue // comando digitado
    return clipBuddyText(l)
  }
  return ''
}

/** Markdown da resposta do agente em texto corrido para o balão (sem blocos de código, títulos, ênfases). */
export function plainSummary(markdown: string): string {
  return clipBuddyText(
    markdown
      .replace(/```[\s\S]*?(```|$)/g, ' ')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
      .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, ' ')
      .replace(/\|/g, ' ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|\*|_|`)/g, '')
      .replace(/^>\s?/gm, '')
  )
}

/** O aviso novo entra primeiro; o mesmo terminal substitui o anterior; ficam no máximo BUDDY_MAX. */
export function mergeCalls(list: readonly BuddyCall[], call: BuddyCall): BuddyCall[] {
  return [call, ...list.filter((c) => c.terminalId !== call.terminalId)].slice(0, BUDDY_MAX)
}

/** Saem os que já ficaram o minuto inteiro; quem ainda não começou a contar (tela bloqueada) fica. */
export function expireCalls(list: readonly BuddyCall[], now: number, maxAgeMs = BUDDY_MAX_AGE_MS): BuddyCall[] {
  return list.filter((c) => c.since === undefined || now - c.since < maxAgeMs)
}

/** Tela desbloqueada: o minuto de todos começa agora (inclusive de quem já estava contando). */
export function restartCountdown(list: readonly BuddyCall[], now: number): BuddyCall[] {
  return list.map((c) => ({ ...c, since: now }))
}

/** Tela bloqueada: ninguém conta até desbloquear. */
export function pauseCountdown(list: readonly BuddyCall[]): BuddyCall[] {
  return list.map(({ since: _since, ...c }) => c)
}

/** Quando o próximo agente deve sair (null = ninguém contando). */
export function nextExpiry(list: readonly BuddyCall[], maxAgeMs = BUDDY_MAX_AGE_MS): number | null {
  const ends = list.flatMap((c) => (c.since === undefined ? [] : [c.since + maxAgeMs]))
  return ends.length ? Math.min(...ends) : null
}

/** Retângulo de um monitor (coordenadas da área de trabalho do Windows). */
export interface DisplayBox {
  id: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * Monitor seguinte ao sair andando para a esquerda, na ordem em que os monitores estão arrumados no
 * Windows: o que fica inteiro à esquerda e mais perto; empatando, o mais alinhado na vertical. null =
 * este já é o da ponta esquerda (o agente sai da tela de vez).
 */
export function leftNeighbor(displays: readonly DisplayBox[], fromId: number): DisplayBox | null {
  const from = displays.find((d) => d.id === fromId)
  if (!from) return null
  const midY = (d: DisplayBox): number => d.y + d.height / 2
  const left = displays.filter((d) => d.id !== fromId && d.x + d.width <= from.x + 1)
  left.sort((a, b) => b.x + b.width - (a.x + a.width) || Math.abs(midY(a) - midY(from)) - Math.abs(midY(b) - midY(from)))
  return left[0] ?? null
}

/** Mensagens da janela do personagem para o main (validadas). */
export const BuddyActionSchema = z.object({
  terminalId: z.string().min(1).max(64),
  action: z.enum(['open', 'dismiss'])
})
export type BuddyAction = z.infer<typeof BuddyActionSchema>
/**
 * Onde estão os balões e os agentes clicáveis (coordenadas da janela). O main confere a posição real do
 * mouse e só nessas áreas a janela aceita clique; no resto, o clique atravessa.
 */
export const BuddyRectsSchema = z.object({
  rects: z
    .array(z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite().min(0), h: z.number().finite().min(0) }))
    .max(12)
})
export type BuddyRect = z.infer<typeof BuddyRectsSchema>['rects'][number]

/** O ponto (coordenadas da janela) cai em alguma área clicável? */
export function hitsAny(rects: readonly BuddyRect[], x: number, y: number): boolean {
  return rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
}
/** O agente saiu pela borda esquerda deste monitor (o main o leva para o monitor seguinte). */
export const BuddyExitedSchema = z.object({ terminalId: z.string().min(1).max(64) })

/** Ponte exposta pelo preload da janela do personagem (só isto, nada do resto do app). */
export interface BuddyBridge {
  onCalls(listener: (calls: BuddyCall[]) => void): () => void
  action(a: BuddyAction): void
  /** Áreas clicáveis atuais (balões e agentes que não estão saindo). */
  rects(rects: BuddyRect[]): void
  ready(): void
  /** Todos os agentes já saíram da tela (o main pode esconder a janela). */
  idle(): void
  /** Agente de passagem: entra pela direita deste monitor, sem balão, e atravessa para a esquerda. */
  onWalk(listener: (call: BuddyCall) => void): () => void
  /** Um agente saiu pela borda esquerda deste monitor. */
  exited(terminalId: string): void
}
