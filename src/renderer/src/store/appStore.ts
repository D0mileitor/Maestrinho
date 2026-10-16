import { create } from 'zustand'
import type { AppInfo, WorkspaceListItem, WorkspaceOp, WorkspaceOpenResult } from '@shared/ipc'
import type { TerminalRuntimeInfo } from '@shared/runtime'
import type { AppConfig, CanvasNode, WorkspaceDoc } from '@shared/schemas'
import type { TeamPreview } from '@shared/team'
import { applyWorkspaceOps } from '@shared/workspaceOps'
import { historyEntry, type HistoryEntry } from '@shared/history'
import { api, errorMessage } from '../lib/api'
import { useUi } from './uiStore'
import { useChat } from './chatStore'

/** Pilhas de desfazer/refazer por workspace (só operações do usuário). */
const MAX_HISTORY = 100
const histories = new Map<string, { past: HistoryEntry[]; future: HistoryEntry[] }>()

function stacks(dir: string): { past: HistoryEntry[]; future: HistoryEntry[] } {
  let h = histories.get(dir)
  if (!h) {
    h = { past: [], future: [] }
    histories.set(dir, h)
  }
  return h
}

function recordHistory(dir: string, doc: WorkspaceDoc, ops: WorkspaceOp[]): void {
  const entry = historyEntry(doc, ops)
  if (!entry) return
  const h = stacks(dir)
  h.past.push(entry)
  if (h.past.length > MAX_HISTORY) h.past.shift()
  h.future = []
}

/** Desfaz a última ação do usuário no workspace ativo. */
export function undo(): boolean {
  const s = useApp.getState()
  const dir = s.active?.dir
  if (!dir) return false
  const h = stacks(dir)
  const entry = h.past.pop()
  if (!entry) return false
  h.future.push(entry)
  void s.applyOps(entry.undo, { record: false })
  return true
}

export function redo(): boolean {
  const s = useApp.getState()
  const dir = s.active?.dir
  if (!dir) return false
  const h = stacks(dir)
  const entry = h.future.pop()
  if (!entry) return false
  h.past.push(entry)
  void s.applyOps(entry.redo, { record: false })
  return true
}

export type Tool = 'select' | 'terminal' | 'note' | 'text' | 'rect' | 'arrow' | 'draw' | 'portal'

export interface FlowRect {
  x: number
  y: number
  w: number
  h: number
}

export interface ActiveWorkspace {
  dir: string
  doc: WorkspaceDoc
  isGitRepo: boolean
}

export interface Toast {
  id: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export type DialogState =
  | { kind: 'none' }
  | { kind: 'presetPicker'; rect: FlowRect }
  | { kind: 'presets' }
  | { kind: 'roles' }
  | { kind: 'settings' }
  | { kind: 'routines' }
  | { kind: 'partituras' }
  | { kind: 'noteCreate'; rect: FlowRect }
  | { kind: 'portalCreate'; rect: FlowRect }
  | { kind: 'floorCreate' }
  | { kind: 'floorManage'; floorId: string }
  | { kind: 'editTerminal'; id: string; tab?: 'look' }
  | {
      kind: 'confirm'
      title: string
      body: string
      confirmLabel: string
      danger?: boolean
      onConfirm: () => void | Promise<void>
    }
  | { kind: 'corrupted'; dir: string; error: string; backups: string[] }
  | { kind: 'teamImport'; preview: TeamPreview }

interface AppState {
  ready: boolean
  info: AppInfo | null
  config: AppConfig | null
  theme: 'dark' | 'light'
  workspaces: WorkspaceListItem[]
  active: ActiveWorkspace | null
  runtime: Record<string, TerminalRuntimeInfo>
  /** Terminais que terminaram uma tarefa e ainda não foram vistos. */
  attention: Record<string, boolean>
  focusedTerminal: string | null
  /** O terminal que você está vendo, em qualquer janela do app (o desta ou o do chat destacado). */
  seenFocus: string | null
  selection: string[]
  tool: Tool
  dialog: DialogState
  paletteOpen: boolean
  toasts: Toast[]
  sidebarOpen: boolean
  /** Conexões com mensagem passando (edgeId -> instante do último pulso). */
  edgePulses: Record<string, { at: number; from: string }>
  /** Pedido para centralizar/focar um nó (consumido pelo canvas). */
  focusRequest: { id: string; at: number } | null
  /** Último resumo do assistente (opcional) por terminal. */
  summaries: Record<string, string>

  init(): Promise<void>
  toast(level: Toast['level'], message: string): void
  dismissToast(id: number): void
  setDialog(d: DialogState): void
  setTool(tool: Tool): void
  setSidebar(open: boolean): void
  setPalette(open: boolean): void
  setSelection(ids: string[]): void
  setFocusedTerminal(id: string | null): void
  requestFocus(id: string): void
  toggleTheme(): void

  pickAndOpenWorkspace(): Promise<void>
  openWorkspace(dir: string): Promise<void>
  restoreBackup(dir: string, backup: string): Promise<void>
  closeWorkspace(dir: string): Promise<void>
  forgetWorkspace(dir: string): Promise<void>

  /** Aplica operações (otimista) e envia ao main. `record: false` = não entra no desfazer. */
  applyOps(ops: WorkspaceOp[], opts?: { record?: boolean }): Promise<void>
  updateNode(id: string, patch: Partial<CanvasNode>): void
  addNodes(nodes: CanvasNode[]): void
  removeNodes(ids: string[]): void
  confirmRemoveNodes(ids: string[]): void
}

let toastSeq = 0

function resolveTheme(pref: 'dark' | 'light' | 'system' | undefined): 'dark' | 'light' {
  if (pref === 'light' || pref === 'dark') return pref
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyThemeToDocument(theme: 'dark' | 'light'): void {
  document.documentElement.dataset['theme'] = theme
  // Botões do sistema na barra de título nas cores do tema.
  api.send('ui:theme', { theme })
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  info: null,
  config: null,
  theme: 'dark',
  workspaces: [],
  active: null,
  runtime: {},
  attention: {},
  focusedTerminal: null,
  seenFocus: null,
  selection: [],
  tool: 'select',
  dialog: { kind: 'none' },
  paletteOpen: false,
  toasts: [],
  sidebarOpen: true,
  edgePulses: {},
  focusRequest: null,
  summaries: {},

  async init() {
    const [info, config, workspaces, active, infos] = await Promise.all([
      api.invoke('app:info'),
      api.invoke('config:get'),
      api.invoke('workspace:list'),
      api.invoke('workspace:active'),
      api.invoke('pty:infoAll')
    ])
    const theme = resolveTheme(config.settings.theme)
    applyThemeToDocument(theme)
    const runtime: Record<string, TerminalRuntimeInfo> = {}
    for (const i of infos) runtime[i.id] = i
    set({ info, config, workspaces, active: active ? toActive(active) : null, runtime, theme, ready: true })

    api.on('config:changed', (cfg) => {
      const nextTheme = resolveTheme(cfg.settings.theme)
      applyThemeToDocument(nextTheme)
      set({ config: cfg, theme: nextTheme })
    })
    api.on('workspace:listChanged', (list) => set({ workspaces: list }))
    api.on('workspace:activated', ({ dir }) => {
      const cur = get().active
      if (dir === null) {
        set({ active: null })
      } else if (!cur || cur.dir !== dir) {
        void api.invoke('workspace:active').then((res) => set({ active: res ? toActive(res) : null, selection: [] }))
      }
    })
    api.on('workspace:ops', ({ dir, ops }) => {
      const cur = get().active
      if (!cur || cur.dir !== dir) return
      set({ active: { ...cur, doc: applyWorkspaceOps(cur.doc, ops) } })
    })
    api.on('pty:info', (info) => {
      const prev = get().runtime[info.id]
      const patch: Partial<AppState> = { runtime: { ...get().runtime, [info.id]: info } }
      if (info.attentionSeq > (prev?.attentionSeq ?? 0) && get().seenFocus !== info.id) {
        patch.attention = { ...get().attention, [info.id]: true }
      }
      set(patch)
    })
    // Você está vendo este terminal em alguma janela: o "!" dele some aqui também.
    api.on('attention:focus', ({ id }) => {
      const patch: Partial<AppState> = { seenFocus: id }
      if (id && get().attention[id]) {
        const next = { ...get().attention }
        delete next[id]
        patch.attention = next
      }
      set(patch)
    })
    api.on('app:toast', ({ level, message }) => get().toast(level, message))
    api.on('summary:ready', ({ id, summary }) => {
      const node = get().active?.doc.nodes.find((n) => n.id === id)
      const name = node && node.kind === 'terminal' ? node.name : 'agente'
      set({ summaries: { ...get().summaries, [id]: summary } })
      get().toast('info', `Resumo de ${name}: ${summary}`)
    })
    api.on('edge:activity', ({ from, to }) => {
      const doc = get().active?.doc
      if (!doc) return
      const edge = doc.edges.find((e) => (e.source === from && e.target === to) || (e.source === to && e.target === from))
      if (!edge) return
      set({ edgePulses: { ...get().edgePulses, [edge.id]: { at: Date.now(), from } } })
    })
    api.on('chat:openAgent', ({ dir, id }) => {
      useUi.getState().presetView(dir, 'office')
      const show = (): void => useChat.getState().openFor(dir, id)
      if (get().active?.dir !== dir) void get().openWorkspace(dir).then(show)
      else show()
    })
    api.on('canvas:focusNode', ({ dir, id }) => {
      const cur = get().active
      if (cur && cur.dir !== dir) void get().openWorkspace(dir).then(() => get().requestFocus(id))
      else get().requestFocus(id)
    })
    window.matchMedia?.('(prefers-color-scheme: light)').addEventListener('change', () => {
      const pref = get().config?.settings.theme
      if (pref === 'system') {
        const th = resolveTheme('system')
        applyThemeToDocument(th)
        set({ theme: th })
      }
    })

    // Último workspace estava corrompido: o main não o abriu; oferece restauração.
    const last = config.settings.lastWorkspace
    if (!active && last && workspaces.some((w) => w.dir === last && w.exists)) {
      await get().openWorkspace(last)
    }
  },

  toast(level, message) {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, level, message }].slice(-5) })
    setTimeout(() => get().dismissToast(id), level === 'error' ? 9000 : 5000)
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((x) => x.id !== id) })
  },
  setDialog(dialog) {
    set({ dialog })
  },
  setTool(tool) {
    set({ tool })
  },
  setSidebar(open) {
    set({ sidebarOpen: open })
  },
  setPalette(open) {
    set({ paletteOpen: open })
  },
  setSelection(ids) {
    const cur = get().selection
    if (cur.length === ids.length && cur.every((x, i) => x === ids[i])) return
    set({ selection: ids })
  },
  setFocusedTerminal(id) {
    if (get().focusedTerminal === id && get().seenFocus === id) return
    // O main usa para o aviso com o personagem (acompanha o "!" e sai quando você abre o terminal).
    api.send('ui:focusedTerminal', { id })
    const patch: Partial<AppState> = { focusedTerminal: id, seenFocus: id }
    if (id && get().attention[id]) {
      const next = { ...get().attention }
      delete next[id]
      patch.attention = next
    }
    set(patch)
  },
  requestFocus(id) {
    // Focar um nó é coisa do canvas: sai do escritório.
    useUi.getState().setView('canvas')
    set({ focusRequest: { id, at: Date.now() } })
  },
  toggleTheme() {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    applyThemeToDocument(next)
    set({ theme: next })
    void api.invoke('config:setSettings', { theme: next })
  },

  async pickAndOpenWorkspace() {
    const dir = await api.invoke('workspace:pickDirectory')
    if (dir) await get().openWorkspace(dir)
  },
  async openWorkspace(dir) {
    try {
      const res = await api.invoke('workspace:open', { dir })
      if (res.corrupted) {
        set({ dialog: { kind: 'corrupted', dir: res.dir, error: res.corrupted.error, backups: res.corrupted.backups } })
        return
      }
      set({ active: toActive(res), selection: [], tool: 'select' })
    } catch (err) {
      get().toast('error', errorMessage(err))
    }
  },
  async restoreBackup(dir, backup) {
    try {
      const res = await api.invoke('workspace:restoreBackup', { dir, backup })
      set({ active: toActive(res), dialog: { kind: 'none' } })
      if (res.restoredFrom) get().toast('info', `Workspace restaurado do backup ${res.restoredFrom}.`)
    } catch (err) {
      get().toast('error', errorMessage(err))
    }
  },
  async closeWorkspace(dir) {
    await api.invoke('workspace:close', { dir })
    if (get().active?.dir === dir) {
      const res = await api.invoke('workspace:active')
      set({ active: res ? toActive(res) : null })
    }
  },
  async forgetWorkspace(dir) {
    await api.invoke('workspace:forget', { dir })
    if (get().active?.dir === dir) {
      const res = await api.invoke('workspace:active')
      set({ active: res ? toActive(res) : null })
    }
  },

  async applyOps(ops, opts) {
    const cur = get().active
    if (!cur || ops.length === 0) return
    if (opts?.record !== false) recordHistory(cur.dir, cur.doc, ops)
    set({ active: { ...cur, doc: applyWorkspaceOps(cur.doc, ops) } })
    try {
      await api.invoke('workspace:applyOps', { dir: cur.dir, ops })
    } catch (err) {
      get().toast('error', errorMessage(err))
      // Ressincroniza com a fonte da verdade.
      const res = await api.invoke('workspace:active')
      if (res && res.dir === cur.dir) set({ active: toActive(res) })
    }
  },
  updateNode(id, patch) {
    void get().applyOps([{ op: 'updateNode', id, patch }])
  },
  addNodes(nodes) {
    void get().applyOps([{ op: 'addNodes', nodes }])
  },
  removeNodes(ids) {
    if (ids.length === 0) return
    void get().applyOps([{ op: 'removeNodes', ids }])
    set({ selection: get().selection.filter((s) => !ids.includes(s)) })
  },
  confirmRemoveNodes(ids) {
    const doc = get().active?.doc
    if (!doc || ids.length === 0) return
    const nodes = doc.nodes.filter((n) => ids.includes(n.id))
    const running = nodes.filter((n) => n.kind === 'terminal' && get().runtime[n.id]?.status === 'running')
    if (running.length === 0) {
      get().removeNodes(ids)
      return
    }
    const names = running.map((n) => (n.kind === 'terminal' ? n.name : n.id)).join(', ')
    set({
      dialog: {
        kind: 'confirm',
        title: running.length === 1 ? 'Fechar terminal?' : `Fechar ${running.length} terminais?`,
        body: `O processo de ${names} será encerrado e ${nodes.length === 1 ? 'o nó removido' : 'os nós removidos'} do canvas.`,
        confirmLabel: running.length === 1 ? 'Fechar terminal' : 'Fechar terminais',
        danger: true,
        onConfirm: () => get().removeNodes(ids)
      }
    })
  }
}))

function toActive(res: WorkspaceOpenResult): ActiveWorkspace {
  return { dir: res.dir, doc: res.doc, isGitRepo: res.isGitRepo }
}

/** Nós do floor ativo. */
export function visibleNodes(doc: WorkspaceDoc): CanvasNode[] {
  const floor = doc.activeFloorId
  return doc.nodes.filter((n) => (n.floorId ?? undefined) === (floor ?? undefined))
}
