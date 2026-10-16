import { useEffect } from 'react'
import { create } from 'zustand'
import type { UsageReport } from '@shared/usage'
import { api } from '../lib/api'

interface UsageStore {
  report: UsageReport | null
  loading: boolean
  /** Painel de uso aberto (o botão fica na barra de título). */
  open: boolean
  setOpen(open: boolean): void
  refresh(): Promise<void>
}

let listening = false
/** Pedido de leitura enquanto outra estava em andamento (ex.: o painel abriu): lê de novo ao terminar. */
let again = false

export const useUsage = create<UsageStore>((set, get) => ({
  report: null,
  loading: false,
  open: false,
  setOpen(open) {
    set({ open })
    if (open) void get().refresh()
  },
  async refresh() {
    if (!listening) {
      listening = true
      // Pausa automática por limite começou/acabou: atualiza na hora (sem esperar o próximo ciclo).
      api.on('usage:changed', () => void get().refresh())
    }
    if (get().loading) {
      again = true
      return
    }
    set({ loading: true })
    try {
      // O uso por agente lê os históricos: só com o painel aberto.
      set({ report: await api.invoke('usage:get', { agents: get().open }) })
    } catch {
      // mantém a última leitura; o painel mostra quando ela foi feita
    } finally {
      set({ loading: false })
      if (again) {
        again = false
        void get().refresh()
      }
    }
  }
}))

/** Mantém o uso atualizado: a cada minuto com o painel aberto, a cada 5 minutos com ele fechado. */
export function useUsagePolling(): void {
  const open = useUsage((s) => s.open)
  useEffect(() => {
    if (!open) void useUsage.getState().refresh()
    const timer = setInterval(() => void useUsage.getState().refresh(), open ? 60_000 : 300_000)
    return () => clearInterval(timer)
  }, [open])
}
