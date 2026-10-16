import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { hint } from '../hints/hint'
import type { HintKey } from '../i18n/hints'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  /** Atalho mostrado à direita do item. */
  hint?: string
  /** Explicação do item (balão ao parar o mouse). */
  help?: HintKey
}

interface MenuState {
  open: { x: number; y: number; items: (MenuItem | 'sep')[] } | null
  show(x: number, y: number, items: (MenuItem | 'sep')[]): void
  hide(): void
}

export const useContextMenu = create<MenuState>((set) => ({
  open: null,
  show: (x, y, items) => set({ open: { x, y, items } }),
  hide: () => set({ open: null })
}))

/** Menu de contexto flutuante (botão direito). Fecha com Esc, clique fora ou ao escolher. */
export function ContextMenu(): React.JSX.Element | null {
  const open = useContextMenu((s) => s.open)
  const hide = useContextMenu((s) => s.hide)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) hide()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', hide)
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', hide)
    }
  }, [open, hide])

  if (!open) return null
  // Mantém o menu dentro da janela.
  const x = Math.min(open.x, window.innerWidth - 230)
  const y = Math.min(open.y, window.innerHeight - open.items.length * 30 - 16)
  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: x, top: y }}>
      {open.items.map((it, i) =>
        it === 'sep' ? (
          <div key={`sep-${i}`} className="ctx-sep" role="separator" />
        ) : (
          <button
            key={it.label}
            role="menuitem"
            className={`ctx-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            {...(it.help ? hint(it.help) : {})}
            onClick={() => {
              hide()
              it.onSelect()
            }}
          >
            <span>{it.label}</span>
            {it.hint && <span className="ctx-hint">{it.hint}</span>}
          </button>
        )
      )}
    </div>
  )
}
