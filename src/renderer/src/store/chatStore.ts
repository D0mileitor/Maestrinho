import { create } from 'zustand'
import type { ChatAgent, ChatItem, ChatMeta, ChatSnapshot, ChatUpdate } from '@shared/chat'
import type { ChatRoute } from '@shared/chatWindow'
import { api, errorMessage } from '../lib/api'
import { IS_CHAT_WINDOW } from '../lib/windowKind'

/**
 * Chat com os agentes (painel lateral sobre o canvas), em abas de fichário: uma por terminal e o "Chat
 * geral", que junta as conversas de todos (e as mensagens entre eles). Cada aba acompanha o histórico
 * do agente no processo principal; a aba escolhida é lembrada por workspace neste computador.
 */

/** Aba do chat geral (as demais são ids de terminal). */
export const GENERAL_TAB = 'geral'

export interface Feed {
  mode: ChatSnapshot['mode'] | null
  /** Agente cujo histórico está sendo lido (claude, codex) — null no modo tela. */
  agent: ChatAgent | null
  order: string[]
  items: Record<string, ChatItem>
  omitted: number
  /** Modelo, esforço e modo de permissão da sessão. */
  meta: ChatMeta
  loading: boolean
  error: string | null
  /** Momento em que o agente terminou a última resposta (para rolar e avisar). */
  turnEndedAt: number
  /** O histórico diz que a última resposta terminou (mais exato que o silêncio da tela). */
  turnEnded: boolean
  /** Mensagens (respostas e recados entre agentes) que chegaram desde a última vez que você viu a aba. */
  unread: number
}

interface ChatState {
  open: boolean
  /** Workspace das abas. */
  dir: string | null
  /** Aba aberta: GENERAL_TAB ou o id de um terminal. */
  tab: string
  /** Nota aberta para leitura no painel (clique num quadro do escritório). */
  noteId: string | null
  /** Nota aberta pelo caminho, sem nó no canvas (ex.: historico/INDICE.md, pelo arquivo de gavetas). */
  noteFile: string | null
  feeds: Record<string, Feed>
  /** Último destinatário escrito no chat geral (o "@" vale até você mencionar outro). */
  generalTo: string | null
  /** (Janela principal) o chat está destacado numa janela própria: os pedidos vão para ela. */
  detached: boolean
  /** Destaca o chat numa janela própria, na aba atual. */
  detach(): void
  /** (Chat destacado) devolve o chat ao painel da janela principal. */
  dock(): void
  setOpen(open: boolean, dir: string | null): void
  /** Abre o chat já na aba deste terminal (ex.: clique no agente do escritório). */
  openFor(dir: string, id: string): void
  selectTab(tab: string): void
  /** Garante a conversa carregada destes terminais (abas abertas, chat geral). */
  ensure(ids: string[]): void
  /** Para de acompanhar terminais que saíram do workspace. */
  forget(ids: string[]): void
  /** Abre uma nota para leitura no painel. */
  openNote(dir: string, id: string): void
  /** Sai da leitura da nota e volta à conversa. */
  closeNote(): void
  /** Abre para leitura uma nota da pasta de notas pelo caminho (não precisa estar no canvas). */
  openNoteFile(dir: string, file: string): void
  markSent(id: string): void
  setGeneralTo(id: string | null): void
  apply(update: ChatUpdate): void
}

const keyFor = (dir: string): string => `maestrinho:chat:${dir}`

function remembered(dir: string): string {
  try {
    return localStorage.getItem(keyFor(dir)) || GENERAL_TAB
  } catch {
    return GENERAL_TAB
  }
}

function remember(dir: string, tab: string): void {
  try {
    localStorage.setItem(keyFor(dir), tab)
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
}

function indexItems(items: ChatItem[]): { order: string[]; byKey: Record<string, ChatItem> } {
  const order: string[] = []
  const byKey: Record<string, ChatItem> = {}
  for (const item of items) {
    if (!(item.key in byKey)) order.push(item.key)
    byKey[item.key] = item
  }
  return { order, byKey }
}

function emptyFeed(): Feed {
  return { mode: null, agent: null, order: [], items: {}, omitted: 0, meta: {}, loading: true, error: null, turnEndedAt: 0, turnEnded: false, unread: 0 }
}

/** Conta como "não lida" a resposta do agente e o recado de outro agente (não as ferramentas). */
function counts(item: ChatItem): boolean {
  return item.kind === 'assistant' || item.kind === 'orq'
}

/** A aba está à vista (você está lendo esta conversa agora)? */
function viewing(s: ChatState, id: string): boolean {
  return s.open && !s.noteId && !s.noteFile && (s.tab === id || s.tab === GENERAL_TAB)
}

/** Na janela principal com o chat destacado, o pedido vai para a janela do chat (e ela vem para a frente). */
function routed(r: ChatRoute): boolean {
  if (IS_CHAT_WINDOW || !useChat.getState().detached) return false
  void api.invoke('chat:route', r).catch(() => undefined)
  return true
}

export const useChat = create<ChatState>()((set, get) => {
  const load = async (id: string): Promise<void> => {
    set({ feeds: { ...get().feeds, [id]: emptyFeed() } })
    try {
      const snap = await api.invoke('chat:open', { id })
      const cur = get().feeds[id]
      if (!cur) return
      const { order, byKey } = indexItems(snap.items)
      set({ feeds: { ...get().feeds, [id]: { ...cur, mode: snap.mode, agent: snap.agent, order, items: byKey, omitted: snap.omitted, meta: snap.meta, loading: false } } })
    } catch (err) {
      const cur = get().feeds[id]
      if (!cur) return
      set({ feeds: { ...get().feeds, [id]: { ...cur, loading: false, error: errorMessage(err) } } })
    }
  }

  const closeAll = (): void => {
    for (const id of Object.keys(get().feeds)) void api.invoke('chat:close', { id }).catch(() => undefined)
    set({ feeds: {} })
  }

  return {
    open: false,
    dir: null,
    tab: GENERAL_TAB,
    noteId: null,
    noteFile: null,
    feeds: {},
    generalTo: null,
    detached: false,

    detach() {
      const s = get()
      if (!s.dir || IS_CHAT_WINDOW) return
      const target = { dir: s.dir, tab: s.tab }
      // Fecha o painel daqui antes: as conversas passam a ser acompanhadas pela janela nova.
      closeAll()
      set({ open: false, noteId: null, noteFile: null, detached: true })
      void api.invoke('chat:detach', target).catch(() => set({ detached: false }))
    },

    dock() {
      const s = get()
      if (IS_CHAT_WINDOW && s.dir) void api.invoke('chat:dock', { dir: s.dir, tab: s.tab })
    },

    setOpen(open, dir) {
      if (open && dir && routed({ kind: 'show', dir })) return
      if (!open || !dir) {
        closeAll()
        set({ open: false, noteId: null, noteFile: null })
        return
      }
      const s = get()
      if (s.dir !== dir) {
        closeAll()
        set({ open: true, dir, tab: remembered(dir), noteId: null, noteFile: null, generalTo: null })
        return
      }
      set({ open: true })
    },

    openFor(dir, id) {
      if (routed({ kind: 'agent', dir, id })) return
      const s = get()
      if (s.dir !== dir) {
        closeAll()
        set({ dir, generalTo: null })
      }
      remember(dir, id)
      const feed = get().feeds[id]
      set({ open: true, tab: id, noteId: null, noteFile: null, feeds: feed ? { ...get().feeds, [id]: { ...feed, unread: 0 } } : get().feeds })
      // Conversa fechada (ou com erro): carrega de novo.
      if (!feed || (!feed.loading && feed.mode === null)) void load(id)
    },

    selectTab(tab) {
      const s = get()
      if (s.dir) remember(s.dir, tab)
      if (IS_CHAT_WINDOW && s.dir) void api.invoke('chat:tab', { dir: s.dir, tab }).catch(() => undefined)
      const feed = tab === GENERAL_TAB ? undefined : s.feeds[tab]
      set({ tab, noteId: null, noteFile: null, feeds: feed ? { ...s.feeds, [tab]: { ...feed, unread: 0 } } : s.feeds })
    },

    ensure(ids) {
      const feeds = get().feeds
      for (const id of ids) {
        const f = feeds[id]
        if (!f || (!f.loading && f.mode === null)) void load(id)
      }
    },

    forget(ids) {
      if (ids.length === 0) return
      const feeds = { ...get().feeds }
      for (const id of ids) {
        if (!feeds[id]) continue
        void api.invoke('chat:close', { id }).catch(() => undefined)
        delete feeds[id]
      }
      set({ feeds })
    },

    openNote(dir, id) {
      if (routed({ kind: 'note', dir, id })) return
      if (get().dir !== dir) {
        closeAll()
        set({ dir, tab: remembered(dir), generalTo: null })
      }
      set({ open: true, noteId: id, noteFile: null })
    },

    openNoteFile(dir, file) {
      if (routed({ kind: 'noteFile', dir, file })) return
      if (get().dir !== dir) {
        closeAll()
        set({ dir, tab: remembered(dir), generalTo: null })
      }
      set({ open: true, noteId: null, noteFile: file })
    },

    closeNote() {
      set({ noteId: null, noteFile: null })
    },

    markSent(id) {
      const f = get().feeds[id]
      if (f) set({ feeds: { ...get().feeds, [id]: { ...f, turnEnded: false } } })
    },

    setGeneralTo(id) {
      set({ generalTo: id })
    },

    apply(update) {
      const s = get()
      const f = s.feeds[update.id]
      if (!f) return
      let next: Feed = f
      if (update.reset) {
        const { order, byKey } = indexItems(update.items)
        next = { ...next, order, items: byKey, omitted: 0, meta: update.meta ?? {} }
        // Começou na tela (o terminal ainda não tinha sessão): agora lê o histórico.
        if (update.agent) next = { ...next, mode: 'transcript', agent: update.agent, loading: false, error: null }
      } else {
        if (update.meta) next = { ...next, meta: { ...next.meta, ...update.meta } }
        if (update.items.length) {
          const order = [...next.order]
          const items = { ...next.items }
          let fresh = 0
          for (const item of update.items) {
            if (!(item.key in items)) {
              order.push(item.key)
              if (counts(item)) fresh++
            }
            items[item.key] = item
          }
          // Pedido novo (seu ou de outro agente): começa outra resposta.
          const prompt = update.items.some((i) => i.kind === 'user' || i.kind === 'orq')
          next = { ...next, order, items, turnEnded: prompt ? false : next.turnEnded, unread: viewing(s, update.id) ? 0 : next.unread + fresh }
        }
      }
      if (update.turnEnded) next = { ...next, turnEndedAt: Date.now(), turnEnded: true }
      set({ feeds: { ...s.feeds, [update.id]: next } })
    }
  }
})

api.on('chat:update', (u) => useChat.getState().apply(u))

if (IS_CHAT_WINDOW) {
  // Pedidos da janela principal (clique num agente do escritório, nota, aviso do personagem).
  api.on('chat:route', (r) => {
    const st = useChat.getState()
    if (r.kind === 'agent') st.openFor(r.dir, r.id)
    else if (r.kind === 'note') st.openNote(r.dir, r.id)
    else if (r.kind === 'noteFile') st.openNoteFile(r.dir, r.file)
  })
} else {
  void api
    .invoke('chat:windowOpen')
    .then((open) => useChat.setState({ detached: open }))
    .catch(() => undefined)
  api.on('chat:windowState', ({ open, reopen }) => {
    useChat.setState({ detached: open })
    // Devolvido pela janela destacada: o painel reabre aqui, na mesma aba.
    if (!open && reopen) {
      useChat.getState().setOpen(true, reopen.dir)
      useChat.getState().selectTab(reopen.tab)
    }
  })
}
