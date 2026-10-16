import { useEffect } from 'react'
import { hintText, type HintKey } from '../i18n/hints'
import { keyParts, parseHintText, type HintText } from './content'
import { KEYS_SEP } from './hint'
import { placeHint } from './place'
import '../styles/hints.css'

/** Espera antes do primeiro hint; passando de um botão para outro logo em seguida, o próximo aparece na hora. */
const SHOW_DELAY = 450
const FOCUS_DELAY = 250
const WARM_MS = 450
const SELECTOR = '[data-hint], [data-hint-title], [title], [data-hint-auto]'
/** Em menus o hint abre ao lado do item, para não cobrir os vizinhos. */
const IN_MENU = '[role^="menuitem"], [role="option"], [role="menu"] *, [role="listbox"] *'

/**
 * Tira o `title` nativo (guardado em `data-hint-auto`) para o Windows não mostrar o balão dele junto com o
 * nosso; vale também para os ancestrais, senão o navegador cai no title de quem está por fora.
 */
function adoptTitles(el: Element): void {
  for (let p: Element | null = el; p; p = p.parentElement?.closest('[title]') ?? null) {
    const title = p.getAttribute('title')
    if (title === null) continue
    p.removeAttribute('title')
    if (!title.trim()) continue
    p.setAttribute('data-hint-auto', title)
    // botão só com ícone: o title era o nome dele para leitores de tela
    if (!p.getAttribute('aria-label') && !p.textContent?.trim()) p.setAttribute('aria-label', title.split('\n')[0]!)
  }
}

function readHint(el: Element): HintText | null {
  const key = el.getAttribute('data-hint')
  if (key && key in hintText) return hintText[key as HintKey]
  const title = el.getAttribute('data-hint-title')
  if (title) {
    const body = el.getAttribute('data-hint-body')
    const keys = el.getAttribute('data-hint-keys')
    return { title, ...(body ? { body } : {}), ...(keys ? { keys: keys.split(KEYS_SEP) } : {}) }
  }
  const auto = el.getAttribute('data-hint-auto')
  return auto ? parseHintText(auto) : null
}

/**
 * Hints do Maestrinho: um único balão para o app inteiro, no lugar do title nativo. Lê `data-hint` (registro
 * em i18n/hints), `data-hint-title`/`-body`/`-keys` (texto montado na hora) ou o `title` comum dos elementos.
 */
export function HintLayer(): null {
  useEffect(() => {
    const tip = document.createElement('div')
    tip.className = 'hint'
    tip.setAttribute('role', 'tooltip')
    const head = tip.appendChild(document.createElement('div'))
    head.className = 'hint-head'
    const titleEl = head.appendChild(document.createElement('span'))
    titleEl.className = 'hint-title'
    const staff = head.appendChild(document.createElement('span'))
    staff.className = 'hint-staff'
    staff.setAttribute('aria-hidden', 'true')
    const keysEl = head.appendChild(document.createElement('span'))
    keysEl.className = 'hint-keys'
    const bodyEl = tip.appendChild(document.createElement('div'))
    bodyEl.className = 'hint-body'
    const arrow = tip.appendChild(document.createElement('span'))
    arrow.className = 'hint-arrow'
    document.body.appendChild(tip)

    let anchor: Element | null = null
    let pending: Element | null = null
    /** Clicou no elemento: não mostra de novo até o mouse sair dele. */
    let muted: Element | null = null
    let timer = 0
    let raf = 0
    let visible = false
    let lastHide = 0
    /** Chegou ao elemento pelo Tab (campos de texto contam como foco de teclado até num clique; aí não mostra). */
    let tabbing = false

    const render = (h: HintText): void => {
      titleEl.textContent = h.title
      bodyEl.textContent = h.body ?? ''
      bodyEl.hidden = !h.body
      keysEl.replaceChildren()
      for (const combo of h.keys ?? []) {
        const group = keysEl.appendChild(document.createElement('span'))
        group.className = 'hint-combo'
        for (const k of keyParts(combo)) {
          const kbd = group.appendChild(document.createElement('kbd'))
          kbd.className = 'kbd'
          kbd.textContent = k
        }
      }
      keysEl.hidden = !h.keys?.length
    }
    const place = (): void => {
      if (!anchor || !anchor.isConnected) return hide()
      const r = anchor.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return hide()
      const p = placeHint(
        { x: r.left, y: r.top, w: r.width, h: r.height },
        { w: tip.offsetWidth, h: tip.offsetHeight },
        { w: window.innerWidth, h: window.innerHeight },
        anchor.matches(IN_MENU) ? 'side' : 'vertical'
      )
      tip.style.transform = `translate(${p.x}px, ${p.y}px)`
      tip.dataset.side = p.side
      const across = p.side === 'left' || p.side === 'right'
      arrow.style.left = across ? '' : `${p.arrow - 4}px`
      arrow.style.top = across ? `${p.arrow - 4}px` : ''
      raf = requestAnimationFrame(place)
    }
    const show = (el: Element): void => {
      pending = null
      const h = readHint(el)
      if (!h) return
      cancelAnimationFrame(raf)
      anchor = el
      render(h)
      tip.classList.add('on')
      visible = true
      place()
    }
    function hide(): void {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      pending = null
      if (visible) lastHide = performance.now()
      visible = false
      anchor = null
      tip.classList.remove('on')
    }
    const schedule = (el: Element, delay: number): void => {
      if (el === anchor || el === pending) return
      adoptTitles(el)
      const warm = visible || performance.now() - lastHide < WARM_MS
      hide()
      pending = el
      timer = window.setTimeout(() => show(el), warm ? 0 : delay)
    }

    const onOver = (e: PointerEvent): void => {
      const el = e.target instanceof Element ? e.target.closest(SELECTOR) : null
      if (el !== muted) muted = null
      if (!el) {
        if (visible || pending) hide()
        return
      }
      if (el === muted || e.buttons) {
        // mesmo sem mostrar, o title nativo não pode aparecer
        adoptTitles(el)
        return
      }
      schedule(el, SHOW_DELAY)
    }
    const onOut = (e: PointerEvent): void => {
      if (!e.relatedTarget) {
        muted = null
        hide()
      }
    }
    const onDown = (): void => {
      tabbing = false
      muted = anchor ?? pending
      hide()
    }
    const onFocus = (e: FocusEvent): void => {
      const el = e.target instanceof Element ? e.target.closest(SELECTOR) : null
      if (el && tabbing) schedule(el, FOCUS_DELAY)
    }
    const onBlur = (e: FocusEvent): void => {
      if (e.target instanceof Element && (e.target.closest(SELECTOR) === anchor || e.target.closest(SELECTOR) === pending)) hide()
    }
    const onKey = (e: KeyboardEvent): void => {
      tabbing = e.key === 'Tab' || (tabbing && e.key === 'Shift')
      if (e.key !== 'Tab' && e.key !== 'Shift') hide()
    }
    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointerout', onOut, true)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('focusin', onFocus, true)
    document.addEventListener('focusout', onBlur, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('wheel', hide, { capture: true, passive: true })
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('focusin', onFocus, true)
      document.removeEventListener('focusout', onBlur, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('wheel', hide, { capture: true })
      window.removeEventListener('blur', hide)
      tip.remove()
    }
  }, [])
  return null
}
