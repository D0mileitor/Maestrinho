import { create } from 'zustand'

/** Estado transitório de interface (não persistido e não compartilhado com o main). */
interface UiState {
  /** Pedido de edição inline do nome de um nó (F2, atalho tmux). */
  renameRequest: { id: string; at: number } | null
  /** Exibir selos 1-9 nos terminais (enquanto Ctrl está pressionado). */
  showJumpBadges: boolean
  /** Ordem de leitura dos terminais visíveis (para Ctrl+1..9). */
  jumpOrder: string[]
  minimapOpen: boolean
  /** Nó de origem de uma conexão iniciada com Ctrl+L (aguardando clique no alvo). */
  connectFrom: string | null
  /** Terminal "elevado" (modo foco, em painel grande sobre o canvas). */
  liftedId: string | null
  /** Visão do workspace: canvas, escritório (pixel art), quadro de chamados ou mudanças. Lembrada por workspace. */
  view: WorkspaceView
  viewDir: string | null
  /** Painel das partituras prontas aberto sobre o canvas. */
  hubOpen: boolean
  setHubOpen(v: boolean): void
  setView(view: WorkspaceView): void
  /** Deixa a visão do workspace `dir` já escolhida (vale ao abri-lo, mesmo que ainda não seja o ativo). */
  presetView(dir: string, view: WorkspaceView): void
  loadView(dir: string | null): void
  setLifted(id: string | null): void
  requestRename(id: string): void
  setJumpBadges(v: boolean): void
  setJumpOrder(ids: string[]): void
  setMinimap(v: boolean): void
  setConnectFrom(id: string | null): void
}

const viewKey = (dir: string): string => `maestrinho:view:${dir}`

export const VIEWS = ['canvas', 'office', 'board', 'changes'] as const
export type WorkspaceView = (typeof VIEWS)[number]

export const useUi = create<UiState>((set, get) => ({
  renameRequest: null,
  showJumpBadges: false,
  jumpOrder: [],
  minimapOpen: true,
  connectFrom: null,
  liftedId: null,
  view: 'canvas',
  viewDir: null,
  hubOpen: false,
  setHubOpen: (v) => set({ hubOpen: v }),
  setView: (view) => {
    if (get().view === view) return
    set({ view })
    const dir = get().viewDir
    try {
      if (dir) localStorage.setItem(viewKey(dir), view)
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  },
  presetView: (dir, view) => {
    try {
      localStorage.setItem(viewKey(dir), view)
    } catch {
      // sem armazenamento: vale só para o workspace já aberto
    }
    if (get().viewDir === dir) set({ view })
  },
  loadView: (dir) => {
    let view: WorkspaceView = 'canvas'
    try {
      const saved = dir ? localStorage.getItem(viewKey(dir)) : null
      if (saved && (VIEWS as readonly string[]).includes(saved)) view = saved as WorkspaceView
    } catch {
      // ignora
    }
    set({ viewDir: dir, view })
  },
  setLifted: (id) => set({ liftedId: id }),
  requestRename: (id) => set({ renameRequest: { id, at: Date.now() } }),
  setJumpBadges: (v) => {
    if (get().showJumpBadges !== v) set({ showJumpBadges: v })
  },
  setJumpOrder: (ids) => {
    const cur = get().jumpOrder
    if (cur.length === ids.length && cur.every((x, i) => x === ids[i])) return
    set({ jumpOrder: ids })
  },
  setMinimap: (v) => set({ minimapOpen: v }),
  setConnectFrom: (id) => set({ connectFrom: id })
}))
