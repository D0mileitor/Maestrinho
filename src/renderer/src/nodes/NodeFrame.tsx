import { Handle, NodeResizer, Position } from '@xyflow/react'
import { useApp } from '../store/appStore'
import { useUi } from '../store/uiStore'
import { snap } from '../canvas/bridge'
import { hint } from '../hints/hint'

interface Props {
  id: string
  kind: string
  selected: boolean
  minWidth: number
  minHeight: number
  header: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Mostrar alças de conexão (shapes simples não conectam). */
  connectable?: boolean
  accent?: string
}

/**
 * Moldura comum dos nós: cabeçalho arrastável, corpo, alças de conexão nos quatro lados (modo
 * "loose": qualquer alça liga a qualquer alça) e redimensionamento com encaixe na grade.
 */
export function NodeFrame({
  id,
  kind,
  selected,
  minWidth,
  minHeight,
  header,
  children,
  className,
  connectable = true,
  accent
}: Props): React.JSX.Element {
  const updateNode = useApp((s) => s.updateNode)
  return (
    <div
      className={`node-frame kind-${kind}${selected ? ' selected' : ''}${className ? ` ${className}` : ''}`}
      style={accent ? ({ '--node-accent': accent } as React.CSSProperties) : undefined}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={minWidth}
        minHeight={minHeight}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
        onResizeEnd={(_e, p) =>
          updateNode(id, {
            position: { x: snap(p.x), y: snap(p.y) },
            size: { w: Math.max(minWidth, snap(p.width)), h: Math.max(minHeight, snap(p.height)) }
          })
        }
      />
      {connectable && (
        <>
          <Handle type="source" position={Position.Top} id="t" className="node-handle" {...hint('conexao.alca')} />
          <Handle type="source" position={Position.Right} id="r" className="node-handle" {...hint('conexao.alca')} />
          <Handle type="source" position={Position.Bottom} id="b" className="node-handle" {...hint('conexao.alca')} />
          <Handle type="source" position={Position.Left} id="l" className="node-handle" {...hint('conexao.alca')} />
        </>
      )}
      <div
        className="node-header node-drag"
        {...(kind === 'terminal' ? hint('no.terminal.cabecalho') : {})}
        onDoubleClick={(e) => {
          // Duplo clique numa área livre do cabeçalho do terminal: modo foco (painel elevado).
          if (kind !== 'terminal') return
          const el = e.target as HTMLElement
          if (el.closest('.node-name, .node-name-edit, button, input')) return
          useUi.getState().setLifted(id)
        }}
      >
        {header}
      </div>
      <div className="node-body">{children}</div>
    </div>
  )
}
