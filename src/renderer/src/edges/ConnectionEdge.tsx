import { memo, useEffect, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { useApp } from '../store/appStore'
import type { ConnectionRFEdge } from '../canvas/types'
import { IconClose } from '../lib/icons'
import { hint } from '../hints/hint'

const PULSE_MS = 1100

/**
 * Conexão entre nós (permissão bidirecional). Quando uma mensagem passa, um pulso percorre o cabo
 * no sentido remetente → destinatário.
 */
function ConnectionEdgeImpl(props: EdgeProps<ConnectionRFEdge>): React.JSX.Element {
  const { id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } = props
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const pulse = useApp((s) => s.edgePulses[id])
  const applyOps = useApp((s) => s.applyOps)
  const [activeAt, setActiveAt] = useState<number | null>(null)

  useEffect(() => {
    if (!pulse || Date.now() - pulse.at > PULSE_MS) return
    setActiveAt(pulse.at)
    const timer = setTimeout(() => setActiveAt(null), PULSE_MS + 150)
    return () => clearTimeout(timer)
  }, [pulse])

  const forward = pulse ? pulse.from === source : true

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        className={`conn-edge${selected ? ' selected' : ''}${activeAt ? ' active' : ''}`}
      />
      {activeAt !== null && (
        <circle key={activeAt} r={4.5} className="conn-pulse">
          <animateMotion
            dur={`${PULSE_MS}ms`}
            repeatCount="1"
            fill="freeze"
            path={path}
            keyPoints={forward ? '0;1' : '1;0'}
            keyTimes="0;1"
            calcMode="linear"
          />
        </circle>
      )}
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="edge-remove nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            {...hint('conexao.remover')}
            aria-label="Remover conexão"
            onClick={() => void applyOps([{ op: 'removeEdges', ids: [id] }])}
          >
            <IconClose size={12} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const ConnectionEdge = memo(ConnectionEdgeImpl)
