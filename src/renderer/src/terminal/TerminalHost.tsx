import { useEffect, useLayoutEffect, useRef } from 'react'
import { useSettledZoom } from '../canvas/bridge'
import { useUi } from '../store/uiStore'
import { acquireTerminal, releaseTerminal, type TerminalController } from './registry'
import { hint } from '../hints/hint'

interface Props {
  id: string
  /** Tamanho da área do terminal em unidades do canvas (ou pixels, no modo foco). */
  width: number
  height: number
  onFocusChange?: (focused: boolean) => void
  /** Renderizado fora do canvas (modo foco): sem contra-escala de zoom. */
  overlay?: boolean
}

const MIN_RENDER_ZOOM = 0.5
const MAX_RENDER_ZOOM = 2.5

/**
 * Hospeda o xterm dentro de um nó do canvas.
 *
 * Contra-escala: o React Flow aplica `scale(zoom)` ao canvas inteiro. Aqui, a superfície do xterm
 * tem tamanho `largura × zoom` e recebe `scale(1/zoom)`; a escala líquida fica 1. Assim a fonte
 * é renderizada no tamanho real (nítida em qualquer zoom) e as coordenadas do mouse batem com as
 * células (seleção correta).
 *
 * No modo foco o mesmo xterm é movido para o painel elevado; o nó mostra só um aviso.
 */
export function TerminalHost({ id, width, height, onFocusChange, overlay = false }: Props): React.JSX.Element {
  const settled = useSettledZoom((s) => s.zoom)
  const lifted = useUi((s) => s.liftedId === id)
  const hidden = lifted && !overlay
  const zoom = overlay ? 1 : Math.min(MAX_RENDER_ZOOM, Math.max(MIN_RENDER_ZOOM, settled))
  const surfaceRef = useRef<HTMLDivElement>(null)
  const ctrlRef = useRef<TerminalController | null>(null)
  const layoutRef = useRef({ width, height, zoom })
  layoutRef.current = { width, height, zoom }
  const focusCb = useRef(onFocusChange)
  focusCb.current = onFocusChange

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface || hidden) return
    const ctrl = acquireTerminal(id)
    ctrlRef.current = ctrl
    ctrl.mount(surface)
    const off = ctrl.onFocusChange(() => focusCb.current?.(ctrl.isFocused()))
    const raf = requestAnimationFrame(() => {
      const l = layoutRef.current
      ctrl.layout(l.width, l.height, l.zoom)
      void ctrl.start()
      if (overlay) ctrl.focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      off()
      ctrlRef.current = null
      releaseTerminal(id)
    }
  }, [id, hidden, overlay])

  useLayoutEffect(() => {
    ctrlRef.current?.layout(width, height, zoom)
  }, [width, height, zoom])

  if (hidden) {
    return (
      <div className="term-viewport term-lifted" style={{ width, height }}>
        <span>Em foco no painel elevado</span>
        <button className="btn" {...hint('no.terminal.foco.voltar')} onClick={() => useUi.getState().setLifted(null)}>
          Voltar ao canvas
        </button>
      </div>
    )
  }

  return (
    <div className="term-viewport nodrag nowheel nopan" style={{ width, height }}>
      <div
        ref={surfaceRef}
        className="term-surface"
        style={{
          width: width * zoom,
          height: height * zoom,
          transform: `scale(${1 / zoom})`
        }}
      />
    </div>
  )
}
