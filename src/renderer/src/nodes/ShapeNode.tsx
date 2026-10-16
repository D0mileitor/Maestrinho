import { memo, useEffect, useRef, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { useApp } from '../store/appStore'
import { snap } from '../canvas/bridge'
import type { ShapeRFNode } from '../canvas/types'

/** Caminho suave (curvas quadráticas pelos pontos médios) para traços livres. */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return ''
  let d = `M ${points[0]![0]} ${points[0]![1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]!
    const [nx, ny] = points[i + 1]!
    d += ` Q ${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`
  }
  const last = points[points.length - 1]!
  d += ` L ${last[0]} ${last[1]}`
  return d
}

function ShapeNodeImpl({ id, data, selected, width, height }: NodeProps<ShapeRFNode>): React.JSX.Element {
  const node = data.node
  const updateNode = useApp((s) => s.updateNode)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.text)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const w = width ?? node.size.w
  const h = height ?? node.size.h
  const color = node.color || 'var(--text-2)'
  const markerId = `arrow-${id}`

  useEffect(() => {
    if (editing) {
      taRef.current?.focus()
      taRef.current?.select()
    }
  }, [editing])

  const commitText = (): void => {
    setEditing(false)
    if (draft !== node.text) updateNode(id, { text: draft })
  }

  const textual = node.shape === 'text' || node.shape === 'rect' || node.shape === 'ellipse'
  const pts = node.points ?? []
  const vbW = Math.max(1, ...pts.map((p) => p[0])) + 10
  const vbH = Math.max(1, ...pts.map((p) => p[1])) + 10

  return (
    <div
      className={`shape-node node-drag shape-${node.shape}${selected ? ' selected' : ''}`}
      style={{ width: w, height: h, '--shape-color': color } as React.CSSProperties}
      onDoubleClick={(e) => {
        if (!textual) return
        e.stopPropagation()
        setDraft(node.text)
        setEditing(true)
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={40}
        minHeight={24}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
        onResizeEnd={(_e, p) =>
          updateNode(id, {
            position: { x: snap(p.x), y: snap(p.y) },
            size: { w: Math.max(80, Math.round(p.width)), h: Math.max(60, Math.round(p.height)) }
          })
        }
      />
      {(node.shape === 'arrow' || node.shape === 'drawing') && pts.length > 1 && (
        <svg className="shape-svg" viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="none">
          {node.shape === 'arrow' && (
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
              </marker>
            </defs>
          )}
          <path
            d={node.shape === 'arrow' ? `M ${pts[0]![0]} ${pts[0]![1]} L ${pts[1]![0]} ${pts[1]![1]}` : smoothPath(pts)}
            fill="none"
            stroke={color}
            strokeWidth={node.strokeWidth ?? 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            markerEnd={node.shape === 'arrow' ? `url(#${markerId})` : undefined}
          />
        </svg>
      )}
      {textual &&
        (editing ? (
          <textarea
            ref={taRef}
            className="shape-text-edit nodrag nowheel"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setDraft(node.text)
                setEditing(false)
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitText()
            }}
          />
        ) : (
          <div className="shape-text">{node.text}</div>
        ))}
    </div>
  )
}

export const ShapeNode = memo(ShapeNodeImpl)
