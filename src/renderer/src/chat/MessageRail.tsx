import { useEffect, useRef, useState } from 'react'
import { currentIndex, outlineText, tickWindow } from '@shared/chatOutline'
import { t } from '../i18n'
import { hint } from '../hints/hint'

const c = t.chat

export interface RailItem {
  /** Igual ao `data-user-key` da mensagem na conversa. */
  key: string
  text: string
  hasImages: boolean
  /** Chat geral: para quem foi. */
  to?: { name: string; color: string | undefined }
}

function messageEl(scroller: HTMLElement, key: string): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(`[data-user-key="${CSS.escape(key)}"]`)
}

/** Posição da mensagem dentro da área rolável. */
function offsetIn(scroller: HTMLElement, el: HTMLElement): number {
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
}

/**
 * Régua das suas mensagens no canto do chat: um traço por mensagem (o da atual destacado); passando
 * o mouse, a lista com o começo de cada uma; clicando, o chat rola até ela.
 */
export function MessageRail({ scroller, items }: { scroller: React.RefObject<HTMLDivElement | null>; items: RailItem[] }): React.JSX.Element | null {
  const [active, setActive] = useState(-1)
  const list = useRef<HTMLDivElement>(null)
  const keys = items.map((i) => i.key).join('\n')

  useEffect(() => {
    const el = scroller.current
    if (!el || items.length < 2) return
    let raf = 0
    const update = (): void => {
      raf = 0
      const tops = items.map((i) => {
        const m = messageEl(el, i.key)
        return m ? offsetIn(el, m) : Number.POSITIVE_INFINITY
      })
      setActive(currentIndex(tops, el.scrollTop, el.clientHeight, el.scrollHeight - el.scrollTop - el.clientHeight < 4))
    }
    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `keys` resume a lista de mensagens
  }, [scroller, keys])

  if (items.length < 2) return null

  const jump = (key: string): void => {
    const el = scroller.current
    const m = el && messageEl(el, key)
    if (!el || !m) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: Math.max(0, offsetIn(el, m) - 12), behavior: smooth ? 'smooth' : 'auto' })
    m.classList.remove('chat-jump-flash')
    void m.offsetWidth
    m.classList.add('chat-jump-flash')
    window.setTimeout(() => m.classList.remove('chat-jump-flash'), 1600)
  }

  // Ao abrir a lista, a mensagem atual fica à vista nela.
  const revealActive = (): void => {
    const box = list.current
    const row = box?.querySelector<HTMLElement>('[aria-current="true"]')
    if (box && row) box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2
  }

  const [start, end] = tickWindow(items.length, Math.max(active, 0))
  return (
    <nav className="chat-rail" aria-label={c.jumpNav} onMouseEnter={revealActive} onFocus={revealActive}>
      <div className="chat-rail-ticks" aria-hidden="true" {...hint('chat.regua')}>
        {items.slice(start, end).map((it, i) => (
          <span key={it.key} className={start + i === active ? 'on' : undefined} />
        ))}
      </div>
      <div className="chat-rail-list" ref={list}>
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            aria-current={i === active ? 'true' : undefined}
            onClick={(e) => {
              jump(it.key)
              // Com o mouse, a lista fecha quando ele sai (pelo teclado, o foco fica nela para seguir navegando).
              if (e.detail > 0) e.currentTarget.blur()
            }}
          >
            {it.to && (
              <strong className="chat-rail-to" style={it.to.color ? { color: it.to.color } : undefined}>
                @{it.to.name}
              </strong>
            )}
            <span className="chat-rail-text">{outlineText(it.text) || (it.hasImages ? c.jumpImage : '…')}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
