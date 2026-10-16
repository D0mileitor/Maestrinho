import { useEffect } from 'react'
import type { CanvasNode } from '@shared/schemas'
import { redo, undo, useApp, visibleNodes } from '../store/appStore'
import { copySelection, duplicateSelection, hasClipboard, pasteClipboard, tidySelection } from '../store/editing'
import { useUi } from '../store/uiStore'
import { canvasBridge, DEFAULT_TERMINAL_SIZE, snap } from '../canvas/bridge'
import { armPrefix, clearPrefix, focusIsTextEntry, isModifierKey, matchGlobal, prefixActive, type MatchedShortcut } from './shortcuts'
import { api } from './api'

function center(n: CanvasNode): { x: number; y: number } {
  return { x: n.position.x + n.size.w / 2, y: n.position.y + n.size.h / 2 }
}

/** Nó "atual": terminal focado, senão o primeiro selecionado. */
function currentNodeId(): string | null {
  const s = useApp.getState()
  return s.focusedTerminal ?? s.selection[0] ?? null
}

function terminalsInOrder(): string[] {
  return useUi.getState().jumpOrder
}

function focusNode(id: string): void {
  useApp.getState().requestFocus(id)
}

/** Vizinhos conectados em ordem determinística (ordem de leitura dos nós). */
function connectedNeighbors(id: string): string[] {
  const doc = useApp.getState().active?.doc
  if (!doc) return []
  const ids = new Set<string>()
  for (const e of doc.edges) {
    if (e.source === id) ids.add(e.target)
    if (e.target === id) ids.add(e.source)
  }
  const nodes = doc.nodes.filter((n) => ids.has(n.id))
  return nodes
    .sort((a, b) => (a.position.y === b.position.y ? a.position.x - b.position.x : a.position.y - b.position.y))
    .map((n) => n.id)
}

let lastConnectedHop: { origin: string; index: number } | null = null

function stepConnected(dir: 1 | -1): void {
  const cur = currentNodeId()
  if (!cur) return
  // Repetir o atalho percorre os vizinhos do nó de origem, em vez de "andar" pela cadeia.
  const origin = lastConnectedHop && connectedNeighbors(lastConnectedHop.origin).includes(cur) ? lastConnectedHop.origin : cur
  const neighbors = connectedNeighbors(origin)
  if (neighbors.length === 0) return
  const prevIndex = lastConnectedHop?.origin === origin ? lastConnectedHop.index : dir === 1 ? -1 : 0
  const index = (prevIndex + dir + neighbors.length) % neighbors.length
  lastConnectedHop = { origin, index }
  focusNode(neighbors[index]!)
}

/** Terminal mais próximo na direção indicada (cone de 45°), para Ctrl+B + setas. */
function spatialNeighbor(fromId: string, key: string): string | null {
  const doc = useApp.getState().active?.doc
  if (!doc) return null
  const nodes = visibleNodes(doc).filter((n) => n.kind === 'terminal')
  const from = nodes.find((n) => n.id === fromId)
  if (!from) return nodes[0]?.id ?? null
  const c = center(from)
  const dirs: Record<string, [number, number]> = {
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowDown: [0, 1],
    ArrowUp: [0, -1]
  }
  const d = dirs[key]
  if (!d) return null
  let best: { id: string; score: number } | null = null
  for (const n of nodes) {
    if (n.id === fromId) continue
    const p = center(n)
    const vx = p.x - c.x
    const vy = p.y - c.y
    const along = vx * d[0] + vy * d[1]
    if (along <= 0) continue
    const across = Math.abs(vx * d[1] - vy * d[0])
    if (across > along * 1.2) continue
    const score = along + across * 2
    if (!best || score < best.score) best = { id: n.id, score }
  }
  return best?.id ?? null
}

function cycleTerminal(dir: 1 | -1): void {
  const order = terminalsInOrder()
  if (order.length === 0) return
  const cur = currentNodeId()
  const idx = cur ? order.indexOf(cur) : -1
  const next = order[(idx + dir + order.length) % order.length]
  if (next) focusNode(next)
}

function nextAttention(): void {
  const s = useApp.getState()
  const doc = s.active?.doc
  if (!doc) return
  const order = terminalsInOrder()
  const pending = order.filter((id) => s.attention[id])
  if (pending.length === 0) {
    s.toast('info', 'Nenhum terminal aguardando você.')
    return
  }
  const cur = currentNodeId()
  const idx = cur ? pending.indexOf(cur) : -1
  focusNode(pending[(idx + 1) % pending.length]!)
}

async function switchWorkspace(dir: 1 | -1): Promise<void> {
  const s = useApp.getState()
  const list = s.workspaces.filter((w) => w.exists)
  if (list.length < 2) return
  const idx = list.findIndex((w) => w.dir === s.active?.dir)
  const next = list[(idx + dir + list.length) % list.length]
  if (next) await s.openWorkspace(next.dir)
}

function newTerminalNear(id: string | null): void {
  const s = useApp.getState()
  const doc = s.active?.doc
  const bridge = canvasBridge()
  if (!doc || !bridge) return
  const from = id ? doc.nodes.find((n) => n.id === id) : undefined
  const pos = from
    ? { x: snap(from.position.x + from.size.w + 40), y: snap(from.position.y) }
    : (() => {
        const c = bridge.viewportCenter()
        return { x: snap(c.x - DEFAULT_TERMINAL_SIZE.w / 2), y: snap(c.y - DEFAULT_TERMINAL_SIZE.h / 2) }
      })()
  s.setDialog({ kind: 'presetPicker', rect: { ...pos, ...DEFAULT_TERMINAL_SIZE } })
}

function runGlobal(m: MatchedShortcut): void {
  const s = useApp.getState()
  const ui = useUi.getState()
  const bridge = canvasBridge()
  switch (m.action) {
    case 'palette':
      s.setPalette(!s.paletteOpen)
      break
    case 'nextAttention':
      nextAttention()
      break
    case 'jumpTerminal': {
      const id = terminalsInOrder()[(m.digit ?? 1) - 1]
      if (id) focusNode(id)
      break
    }
    case 'nextConnected':
      stepConnected(1)
      break
    case 'prevConnected':
      stepConnected(-1)
      break
    case 'prevWorkspace':
      void switchWorkspace(-1)
      break
    case 'nextWorkspace':
      void switchWorkspace(1)
      break
    case 'zoomIn':
      bridge?.zoomIn()
      break
    case 'zoomOut':
      bridge?.zoomOut()
      break
    case 'fitView':
      bridge?.fitView()
      break
    case 'prefix':
      armPrefix()
      break
    case 'toggleSidebar':
      s.setSidebar(!s.sidebarOpen)
      break
    case 'toggleMinimap':
      ui.setMinimap(!ui.minimapOpen)
      break
    case 'settings':
      s.setDialog({ kind: 'settings' })
      break
  }
}

/** Comandos após o prefixo (estilo tmux). */
function runPrefix(e: KeyboardEvent): void {
  const s = useApp.getState()
  const cur = currentNodeId()
  const key = e.key
  if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'b') {
    // Ctrl+B duas vezes: envia Ctrl+B literal ao terminal focado.
    if (s.focusedTerminal) api.send('pty:write', { id: s.focusedTerminal, data: '\x02' })
    return
  }
  if (/^[1-9]$/.test(key)) {
    const id = terminalsInOrder()[Number(key) - 1]
    if (id) focusNode(id)
    return
  }
  switch (key) {
    case 'n':
      cycleTerminal(1)
      break
    case 'p':
      cycleTerminal(-1)
      break
    case 'o':
      stepConnected(1)
      break
    case 'ArrowRight':
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'ArrowDown': {
      const next = cur ? spatialNeighbor(cur, key) : terminalsInOrder()[0]
      if (next) focusNode(next)
      break
    }
    case 'z': {
      // Como o zoom de painel do tmux: alterna o modo foco do terminal atual.
      const ui = useUi.getState()
      if (ui.liftedId) ui.setLifted(null)
      else if (cur && useApp.getState().active?.doc.nodes.find((n) => n.id === cur)?.kind === 'terminal') ui.setLifted(cur)
      break
    }
    case 'c':
      newTerminalNear(cur)
      break
    case 'x':
      if (cur) s.confirmRemoveNodes([cur])
      break
    case ',':
      if (cur) useUi.getState().requestRename(cur)
      break
    case 'w':
    case 's':
      s.setPalette(true)
      break
  }
}

/** Atalhos que só valem com o canvas focado (nunca roubam teclas de terminal ou campo de texto). */
function runCanvasKey(e: KeyboardEvent): boolean {
  // No escritório os atalhos do canvas (apagar, copiar, ferramentas...) não valem: os nós estão escondidos.
  if (useUi.getState().view !== 'canvas') return false
  const s = useApp.getState()
  if (!s.active || s.dialog.kind !== 'none' || s.paletteOpen) return false
  const ctrl = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  if (ctrl && !e.shiftKey && k === 't') {
    newTerminalNear(null)
    return true
  }
  if (ctrl && e.shiftKey && k === 't') {
    tidySelection()
    return true
  }
  if (ctrl && !e.shiftKey && k === 'z') {
    if (!undo()) s.toast('info', 'Nada para desfazer.')
    return true
  }
  if (ctrl && ((e.shiftKey && k === 'z') || (!e.shiftKey && k === 'y'))) {
    if (!redo()) s.toast('info', 'Nada para refazer.')
    return true
  }
  if (ctrl && !e.shiftKey && k === 'c') {
    const n = copySelection()
    if (n) s.toast('info', n === 1 ? '1 nó copiado.' : `${n} nós copiados.`)
    return true
  }
  if (ctrl && !e.shiftKey && k === 'v') {
    if (hasClipboard()) pasteClipboard()
    return true
  }
  if (ctrl && !e.shiftKey && k === 'd') {
    duplicateSelection()
    return true
  }
  if ((ctrl && k === 'w') || e.key === 'Delete' || e.key === 'Backspace') {
    if (s.selection.length) s.confirmRemoveNodes(s.selection)
    return true
  }
  if (ctrl && k === 'l') {
    const sel = s.selection[0]
    if (sel) useUi.getState().setConnectFrom(sel)
    return true
  }
  if (ctrl && e.key === '\\') {
    const sel = s.selection[0]
    if (sel) canvasBridge()?.centerOnNode(sel, true)
    return true
  }
  if (e.key === 'F2') {
    const sel = s.selection[0]
    if (sel) useUi.getState().requestRename(sel)
    return true
  }
  if (e.key === 'Escape') {
    useUi.getState().setConnectFrom(null)
    s.setTool('select')
    return false
  }
  if (ctrl || e.altKey) return false
  const tools: Record<string, Parameters<typeof s.setTool>[0]> = {
    v: 'select',
    t: 'terminal',
    n: 'note',
    l: 'text',
    b: 'rect',
    a: 'arrow',
    d: 'draw',
    p: 'portal'
  }
  const tool = tools[k]
  if (tool) {
    s.setTool(tool)
    return true
  }
  return false
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    let ctrlTimer: ReturnType<typeof setTimeout> | null = null
    const ui = useUi.getState

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Control') {
        if (!ctrlTimer) ctrlTimer = setTimeout(() => ui().setJumpBadges(true), 450)
        return
      }
      if (ctrlTimer) {
        clearTimeout(ctrlTimer)
        ctrlTimer = null
      }
      if (prefixActive() && !isModifierKey(e)) {
        e.preventDefault()
        e.stopPropagation()
        clearPrefix()
        runPrefix(e)
        return
      }
      const m = matchGlobal(e)
      if (m) {
        e.preventDefault()
        e.stopPropagation()
        runGlobal(m)
        return
      }
      if (focusIsTextEntry()) return
      if (runCanvasKey(e)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Control') {
        if (ctrlTimer) clearTimeout(ctrlTimer)
        ctrlTimer = null
        ui().setJumpBadges(false)
      }
    }
    const onBlur = (): void => {
      if (ctrlTimer) clearTimeout(ctrlTimer)
      ctrlTimer = null
      ui().setJumpBadges(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
