import { useEffect, useState } from 'react'
import { useApp } from '../store/appStore'
import { useUi } from '../store/uiStore'
import { TerminalHost } from './TerminalHost'
import { IconClose } from '../lib/icons'
import { hint } from '../hints/hint'

function useWindowSize(): { w: number; h: number } {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const onResize = (): void => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/**
 * Modo foco: o terminal "elevado" aparece num painel grande sobre o canvas. Fecha clicando fora,
 * no botão ou com Ctrl+B z (o Esc continua indo para o agente — no Claude Code ele interrompe).
 */
export function LiftOverlay(): React.JSX.Element | null {
  const liftedId = useUi((s) => s.liftedId)
  const setLifted = useUi((s) => s.setLifted)
  const node = useApp((s) => (liftedId ? s.active?.doc.nodes.find((n) => n.id === liftedId) : undefined))
  const setFocused = useApp((s) => s.setFocusedTerminal)
  const { w, h } = useWindowSize()

  // Nó apagado ou workspace trocado: sai do modo foco.
  useEffect(() => {
    if (liftedId && (!node || node.kind !== 'terminal')) setLifted(null)
  }, [liftedId, node, setLifted])

  if (!liftedId || !node || node.kind !== 'terminal') return null
  const panelW = Math.max(480, Math.round(w * 0.86))
  const panelH = Math.max(320, Math.round(h * 0.84))
  return (
    <div
      className="scrim lift-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setLifted(null)
      }}
    >
      <div className="lift-panel" style={{ width: panelW, height: panelH }} role="dialog" aria-label={`Terminal ${node.name} em foco`}>
        <div className="lift-head" onDoubleClick={() => setLifted(null)}>
          <strong>{node.name}</strong>
          <span className="muted">em foco — Ctrl+B z ou clique fora para voltar</span>
          <span className="spacer" />
          <button className="icon-btn" {...hint('no.terminal.foco.voltar')} aria-label="Voltar ao canvas" onClick={() => setLifted(null)}>
            <IconClose size={14} />
          </button>
        </div>
        <TerminalHost
          id={node.id}
          width={panelW - 2}
          height={panelH - 38}
          overlay
          onFocusChange={(focused) => {
            if (focused) setFocused(node.id)
          }}
        />
      </div>
    </div>
  )
}
