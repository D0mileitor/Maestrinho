import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CLI_NAME } from '@shared/constants'
import { useApp } from '../store/appStore'
import { api, errorMessage } from '../lib/api'
import { IconMore } from '../lib/icons'
import { t } from '../i18n'
import { terminalMenuText as tm } from '../i18n/roles'
import { hint } from '../hints/hint'
import type { HintKey } from '../i18n/hints'

interface Props {
  /** Id do nó de terminal. */
  id: string
  /** Nome atual do terminal. */
  name: string
}

interface MenuItem {
  key: string
  label: string
  /** Explicação do item (balão ao parar o mouse). */
  hint: HintKey
  danger?: boolean
  run: () => void
}

const MENU_MIN_W = 220
const GAP = 4
const EDGE = 8

/** Comando para outro agente falar com este terminal. */
export function sendCommandFor(name: string): string {
  return `${CLI_NAME} send ${name} ""`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 45,
  minWidth: MENU_MIN_W,
  padding: 4,
  display: 'grid',
  gap: 1,
  border: '1px solid var(--line)',
  borderRadius: 8,
  background: 'var(--surface)',
  boxShadow: 'var(--shadow)',
  fontFamily: 'var(--font-ui)',
  fontSize: 'calc(13px * var(--font-scale, 1))',
  color: 'var(--text)'
}
const itemStyle: React.CSSProperties = { display: 'block', width: '100%', padding: '6px 10px', color: 'var(--text)' }
const dangerItemStyle: React.CSSProperties = { ...itemStyle, color: 'var(--danger)' }
const separatorStyle: React.CSSProperties = { height: 1, margin: '3px 6px', background: 'var(--line)' }

/**
 * Botão "⋯" do cabeçalho do terminal e o menu de ações (Editar, Reiniciar, copiar nome/comando,
 * Fechar). O menu é renderizado em `document.body` (posição fixa, fora da escala do canvas), fecha
 * com Esc, Tab, clique fora, rolagem ou redimensionamento, e é navegável por setas, Home/End e pela
 * letra inicial de cada item.
 */
export function TerminalMenu({ id, name }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const initialFocus = useRef<'first' | 'last'>('first')
  const menuId = useId()

  const close = useCallback((refocus: boolean): void => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const openMenu = (focus: 'first' | 'last'): void => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    initialFocus.current = focus
    setPos({ top: r.bottom + GAP, left: Math.max(EDGE, r.right - MENU_MIN_W) })
    setOpen(true)
  }

  // Ajusta a posição ao tamanho real (vira para cima perto da borda) e foca o primeiro/último item.
  useLayoutEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const r = triggerRef.current?.getBoundingClientRect()
    if (!menu || !r) return
    const w = menu.offsetWidth
    const h = menu.offsetHeight
    let top = r.bottom + GAP
    if (top + h > window.innerHeight - EDGE) top = Math.max(EDGE, r.top - h - GAP)
    const left = Math.max(EDGE, Math.min(r.right - w, window.innerWidth - w - EDGE))
    setPos((p) => (p.top === top && p.left === left ? p : { top, left }))
    const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    const target = initialFocus.current === 'last' ? items[items.length - 1] : items[0]
    target?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node && Boolean(menuRef.current?.contains(target) || triggerRef.current?.contains(target))
    const onPointerDown = (e: PointerEvent): void => {
      if (!inside(e.target)) close(false)
    }
    const onWheel = (e: WheelEvent): void => {
      if (!inside(e.target)) close(false)
    }
    const onWindowChange = (): void => close(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('wheel', onWheel, { capture: true, passive: true })
    window.addEventListener('resize', onWindowChange)
    window.addEventListener('blur', onWindowChange)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('resize', onWindowChange)
      window.removeEventListener('blur', onWindowChange)
    }
  }, [open, close])

  const toast = (level: 'info' | 'error', message: string): void => useApp.getState().toast(level, message)
  const isRemote = useApp((s) => {
    const n = s.active?.doc.nodes.find((x) => x.id === id)
    return n?.kind === 'terminal' && s.config?.presets.find((p) => p.id === n.presetId)?.remoteOrq === true
  })

  const hibernated = useApp((s) => {
    const n = s.active?.doc.nodes.find((x) => x.id === id)
    return n?.kind === 'terminal' && n.hibernated === true
  })

  const items: MenuItem[] = [
    {
      key: 'edit',
      label: tm.edit,
      hint: 'no.terminal.menu.editar',
      run: () => {
        close(false)
        useApp.getState().setDialog({ kind: 'editTerminal', id })
      }
    },
    {
      key: 'restart',
      label: tm.restart,
      hint: 'no.terminal.reiniciar',
      run: () => {
        close(true)
        void api.invoke('pty:restart', { id }).catch((err: unknown) => toast('error', errorMessage(err)))
      }
    },
    {
      key: 'newSession',
      label: tm.newSession,
      hint: 'no.terminal.menu.novaConversa',
      run: () => {
        close(true)
        void api.invoke('pty:newSession', { id }).catch((err: unknown) => toast('error', errorMessage(err)))
      }
    },
    hibernated
      ? {
          key: 'wake',
          label: t.hibernate.menuWake,
          hint: 'no.terminal.acordar',
          run: () => {
            close(true)
            void api.invoke('pty:wake', { id }).catch((err: unknown) => toast('error', errorMessage(err)))
          }
        }
      : {
          key: 'hibernate',
          label: t.hibernate.menuSleep,
          hint: 'no.terminal.menu.hibernar',
          run: () => {
            close(true)
            void api.invoke('pty:hibernate', { id }).catch((err: unknown) => toast('error', errorMessage(err)))
          }
        },
    ...(isRemote
      ? [
          {
            key: 'remoteOrq',
            label: t.ssh.activate,
            hint: 'no.terminal.menu.orqRemoto' as const,
            run: () => {
              close(true)
              void api
                .invoke('pty:remoteBootstrap', { id })
                .then(() => toast('info', t.ssh.activated))
                .catch((err: unknown) => toast('error', errorMessage(err)))
            }
          }
        ]
      : []),
    {
      key: 'copyName',
      label: tm.copyName,
      hint: 'no.terminal.menu.copiarNome',
      run: () => {
        close(true)
        void copyText(name).then((ok) => toast(ok ? 'info' : 'error', ok ? tm.copiedName(name) : tm.copyFailed))
      }
    },
    {
      key: 'copySend',
      label: tm.copySend,
      hint: 'no.terminal.menu.copiarComando',
      run: () => {
        const cmd = sendCommandFor(name)
        close(true)
        void copyText(cmd).then((ok) => toast(ok ? 'info' : 'error', ok ? tm.copiedSend(cmd) : tm.copyFailed))
      }
    },
    {
      key: 'close',
      label: tm.close,
      hint: 'no.terminal.fechar',
      danger: true,
      run: () => {
        close(false)
        useApp.getState().confirmRemoveNodes([id])
      }
    }
  ]

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Nada de teclas do menu chegando ao nó (React Flow) ou ao canvas.
    e.stopPropagation()
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (buttons.length === 0) return
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const focusAt = (i: number): void => buttons[(i + buttons.length) % buttons.length]?.focus()
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusAt(current + 1)
        return
      case 'ArrowUp':
        e.preventDefault()
        focusAt(current < 0 ? buttons.length - 1 : current - 1)
        return
      case 'Home':
        e.preventDefault()
        focusAt(0)
        return
      case 'End':
        e.preventDefault()
        focusAt(buttons.length - 1)
        return
      case 'Escape':
      case 'Tab':
        e.preventDefault()
        close(true)
        return
    }
    // Letra inicial: vai para o próximo item que começa com ela.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const key = fold(e.key)
      for (let step = 1; step <= items.length; step++) {
        const i = (current + step) % items.length
        if (fold(items[i]!.label).startsWith(key)) {
          e.preventDefault()
          focusAt(i)
          return
        }
      }
    }
  }

  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn nodrag"
        {...hint('no.terminal.menu')}
        aria-label={tm.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            e.stopPropagation()
            openMenu(e.key === 'ArrowUp' ? 'last' : 'first')
          }
        }}
      >
        <IconMore size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={tm.label(name)}
            className="nodrag nowheel nopan"
            style={{ ...menuStyle, top: pos.top, left: pos.left }}
            onKeyDown={onMenuKeyDown}
            onClick={stop}
            onDoubleClick={stop}
            onMouseDown={stop}
            onPointerDown={stop}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            {items.map((item) => (
              <Fragment key={item.key}>
                {item.danger && <div role="separator" style={separatorStyle} />}
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="list-item"
                  {...hint(item.hint)}
                  style={item.danger ? dangerItemStyle : itemStyle}
                  onClick={item.run}
                >
                  {item.label}
                </button>
              </Fragment>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
