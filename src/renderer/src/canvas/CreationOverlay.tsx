import { useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useApp, type FlowRect, type Tool } from '../store/appStore'
import { snap } from './bridge'
import { t } from '../i18n'

export type CreationTool = Exclude<Tool, 'select'>

interface Props {
  tool: CreationTool
  onCreate: (tool: CreationTool, rect: FlowRect, points?: [number, number][]) => void
  defaultSize: (tool: CreationTool) => { w: number; h: number }
}

/**
 * Camada de criação: com uma ferramenta ativa, arrastar define posição e tamanho do novo nó
 * (clique simples usa o tamanho padrão). No desenho livre o arraste coleta o traço; na seta,
 * define início e fim.
 */
export function CreationOverlay({ tool, onCreate, defaultSize }: Props): React.JSX.Element {
  const rf = useReactFlow()
  const setTool = useApp((s) => s.setTool)
  const ref = useRef<HTMLDivElement>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null)
  const [path, setPath] = useState<{ x: number; y: number }[]>([])
  const points = useRef<[number, number][]>([])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setTool('select')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setTool])

  const local = (e: React.PointerEvent): { x: number; y: number } => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const finish = (e: React.PointerEvent): void => {
    if (!start) return
    const r = ref.current!.getBoundingClientRect()
    const startScreen = { x: start.x + r.left, y: start.y + r.top }
    const end = { x: e.clientX, y: e.clientY }
    const a = rf.screenToFlowPosition(startScreen)
    const b = rf.screenToFlowPosition(end)
    const tiny = Math.abs(end.x - startScreen.x) < 8 && Math.abs(end.y - startScreen.y) < 8
    setStart(null)
    setCur(null)
    setPath([])

    if (tool === 'draw' || tool === 'arrow') {
      const pts: [number, number][] =
        tool === 'arrow'
          ? [
              [a.x, a.y],
              [b.x, b.y]
            ]
          : points.current
      points.current = []
      if (pts.length < 2 || tiny) {
        setTool('select')
        return
      }
      const pad = 10
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      const minX = Math.min(...xs) - pad
      const minY = Math.min(...ys) - pad
      const maxX = Math.max(...xs) + pad
      const maxY = Math.max(...ys) + pad
      const rect: FlowRect = { x: minX, y: minY, w: Math.max(80, maxX - minX), h: Math.max(60, maxY - minY) }
      const rel = pts.map(([x, y]) => [Math.round(x - minX), Math.round(y - minY)] as [number, number])
      onCreate(tool, rect, rel)
      setTool('select')
      return
    }

    const size = defaultSize(tool)
    const rect: FlowRect = tiny
      ? { x: snap(a.x), y: snap(a.y), w: size.w, h: size.h }
      : {
          x: snap(Math.min(a.x, b.x)),
          y: snap(Math.min(a.y, b.y)),
          w: Math.max(120, snap(Math.abs(b.x - a.x))),
          h: Math.max(60, snap(Math.abs(b.y - a.y)))
        }
    onCreate(tool, rect)
    setTool('select')
  }

  const box =
    start && cur && tool !== 'draw' && tool !== 'arrow'
      ? {
          left: Math.min(start.x, cur.x),
          top: Math.min(start.y, cur.y),
          width: Math.abs(cur.x - start.x),
          height: Math.abs(cur.y - start.y)
        }
      : null

  return (
    <div
      ref={ref}
      className={`creation-overlay tool-${tool}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = local(e)
        setStart(p)
        setCur(p)
        if (tool === 'draw') {
          const f = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
          points.current = [[f.x, f.y]]
          setPath([p])
        }
      }}
      onPointerMove={(e) => {
        if (!start) return
        const p = local(e)
        setCur(p)
        if (tool === 'draw') {
          const f = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
          const last = points.current[points.current.length - 1]
          if (!last || Math.hypot(f.x - last[0], f.y - last[1]) > 2) {
            points.current.push([f.x, f.y])
            setPath((prev) => [...prev, p])
          }
        }
      }}
      onPointerUp={finish}
    >
      <div className="creation-hint">{t.toolbar.hintDraw}</div>
      {box && <div className="creation-box" style={box} />}
      {tool === 'arrow' && start && cur && (
        <svg className="creation-svg">
          <line x1={start.x} y1={start.y} x2={cur.x} y2={cur.y} />
        </svg>
      )}
      {tool === 'draw' && path.length > 1 && (
        <svg className="creation-svg">
          <polyline points={path.map((p) => `${p.x},${p.y}`).join(' ')} />
        </svg>
      )}
    </div>
  )
}
