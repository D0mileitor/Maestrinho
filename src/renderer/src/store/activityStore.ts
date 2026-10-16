import { useEffect } from 'react'
import { create } from 'zustand'
import { AWAY_MS, summarizeAway, type ActivityEvent, type AwaySummary } from '@shared/activity'
import { api } from '../lib/api'

const SEEN_KEY = 'maestrinho:atividade:visto'
/** Eventos mantidos na interface (o main guarda até 1000). */
const KEEP = 500

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0
  } catch {
    return 0
  }
}

interface ActivityStore {
  events: ActivityEvent[]
  /** Maior id já visto no painel (o resto conta como novidade). */
  seenId: number
  open: boolean
  /** Resumo mostrado ao voltar depois de um tempo fora. */
  away: AwaySummary | null
  init(): void
  setOpen(open: boolean): void
  showAway(since: number): void
  closeAway(): void
}

let started = false

export const useActivity = create<ActivityStore>((set, get) => ({
  events: [],
  seenId: readSeen(),
  open: false,
  away: null,
  init() {
    if (started) return
    started = true
    api.on('activity:new', (e) => set((s) => ({ events: [...s.events.slice(-(KEEP - 1)), e] })))
    void api
      .invoke('activity:list', {})
      .then((list) => set({ events: list.slice(-KEEP) }))
      .catch(() => undefined)
  },
  setOpen(open) {
    set({ open })
    if (!open) return
    // Abrir o painel marca tudo como visto.
    const last = get().events.at(-1)?.id ?? 0
    set({ seenId: last, away: null })
    try {
      localStorage.setItem(SEEN_KEY, String(last))
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  },
  showAway(since) {
    const summary = summarizeAway(get().events, since, Date.now())
    if (summary.total > 0) set({ away: summary })
  },
  closeAway() {
    set({ away: null })
  }
}))

/**
 * Detecta a volta depois de um tempo sem usar o app (janela sem foco ou computador parado): a primeira
 * interação depois de AWAY_MS mostra o resumo do que aconteceu nesse meio-tempo.
 */
export function useAwayWatch(): void {
  useEffect(() => {
    useActivity.getState().init()
    let lastActive = Date.now()
    let lastMove = 0
    const touch = (): void => {
      const now = Date.now()
      if (now - lastActive >= AWAY_MS) useActivity.getState().showAway(lastActive)
      lastActive = now
    }
    // Mover o mouse também é voltar, mas sem conferir a cada pixel.
    const move = (): void => {
      const now = Date.now()
      if (now - lastMove < 5000) return
      lastMove = now
      touch()
    }
    window.addEventListener('pointerdown', touch, true)
    window.addEventListener('keydown', touch, true)
    window.addEventListener('wheel', touch, { capture: true, passive: true })
    window.addEventListener('focus', touch)
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', touch, true)
      window.removeEventListener('keydown', touch, true)
      window.removeEventListener('wheel', touch, true)
      window.removeEventListener('focus', touch)
      window.removeEventListener('pointermove', move)
    }
  }, [])
}
