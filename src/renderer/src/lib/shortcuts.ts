/**
 * Mapa de atalhos e estado do prefixo estilo tmux.
 *
 * - Globais: valem mesmo com o foco dentro de um terminal (são interceptados antes do xterm).
 * - Canvas: só valem quando o foco não está em terminal, campo de texto ou editor.
 * - Prefixo (padrão Ctrl+B, como no tmux): Ctrl+B e depois n/p, 1-9, setas, o, z, c, x, ",".
 *   Ctrl+B duas vezes envia um Ctrl+B literal ao terminal.
 */

export type GlobalAction =
  | 'palette'
  | 'nextAttention'
  | 'jumpTerminal'
  | 'nextConnected'
  | 'prevConnected'
  | 'prevWorkspace'
  | 'nextWorkspace'
  | 'zoomIn'
  | 'zoomOut'
  | 'fitView'
  | 'prefix'
  | 'toggleSidebar'
  | 'toggleMinimap'
  | 'settings'

export interface MatchedShortcut {
  action: GlobalAction
  digit?: number
}

function isCtrl(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey
}

/** Reconhece atalhos globais (não inclui a tecla seguinte ao prefixo). */
export function matchGlobal(e: KeyboardEvent): MatchedShortcut | null {
  if (e.type !== 'keydown') return null
  const k = e.key.toLowerCase()
  if (isCtrl(e) && !e.shiftKey && (k === 'k' || k === 'p')) return { action: 'palette' }
  if (isCtrl(e) && e.shiftKey && k === 'a') return { action: 'nextAttention' }
  if (isCtrl(e) && !e.shiftKey && /^[1-9]$/.test(e.key)) return { action: 'jumpTerminal', digit: Number(e.key) }
  if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key === 'ArrowRight') return { action: 'nextConnected' }
  if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key === 'ArrowLeft') return { action: 'prevConnected' }
  if (isCtrl(e) && !e.shiftKey && e.key === 'ArrowUp') return { action: 'prevWorkspace' }
  if (isCtrl(e) && !e.shiftKey && e.key === 'ArrowDown') return { action: 'nextWorkspace' }
  if (isCtrl(e) && (e.key === '=' || e.key === '+')) return { action: 'zoomIn' }
  if (isCtrl(e) && e.key === '-') return { action: 'zoomOut' }
  if (isCtrl(e) && !e.shiftKey && e.key === '0') return { action: 'fitView' }
  if (isCtrl(e) && !e.shiftKey && k === 'b') return { action: 'prefix' }
  if (isCtrl(e) && e.shiftKey && k === 'b') return { action: 'toggleSidebar' }
  if (isCtrl(e) && e.shiftKey && k === 'm') return { action: 'toggleMinimap' }
  if (isCtrl(e) && !e.shiftKey && e.key === ',') return { action: 'settings' }
  return null
}

let prefixUntil = 0

export function armPrefix(ms = 2500): void {
  prefixUntil = Date.now() + ms
}

export function clearPrefix(): void {
  prefixUntil = 0
}

export function prefixActive(): boolean {
  return Date.now() < prefixUntil
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])

/** Usado pelo xterm: true = o app trata a tecla e ela não deve ir para o processo. */
export function isGlobalShortcut(e: KeyboardEvent): boolean {
  if (e.type !== 'keydown') return false
  if (prefixActive() && !MODIFIER_KEYS.has(e.key)) return true
  return matchGlobal(e) !== null
}

export function isModifierKey(e: KeyboardEvent): boolean {
  return MODIFIER_KEYS.has(e.key)
}

/** O foco está num lugar que consome teclas (terminal, campo, editor de nota)? */
export function focusIsTextEntry(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el.closest('.xterm')) return true
  // Menus abertos (⋯ do terminal, menu de contexto) tratam as próprias teclas.
  if (el.closest('[role="menu"]')) return true
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}
