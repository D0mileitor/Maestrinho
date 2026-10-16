import { useId } from 'react'
import { useStore } from '@xyflow/react'
import { GRID } from './bridge'

/** Altura de um "sistema": 5 linhas (4 intervalos de grade) + respiro até a próxima pauta. */
const STAFF_SPAN = GRID * 4
const STAFF_PERIOD = STAFF_SPAN + GRID * 3

/**
 * Fundo do canvas desenhado como pautas musicais: grupos de cinco linhas horizontais alinhadas à
 * grade de 20 unidades. Bem discreto; some quando o zoom é muito pequeno.
 */
export function StaffBackground(): React.JSX.Element | null {
  const [, ty, zoom] = useStore((s) => s.transform)
  const pid = useId().replace(/:/g, '')
  if (zoom < 0.22) return null
  const period = STAFF_PERIOD * zoom
  const gap = GRID * zoom
  const offset = ((ty % period) + period) % period
  const opacity = Math.min(1, (zoom - 0.22) / 0.4)
  return (
    <svg className="staff-bg" aria-hidden="true" style={{ opacity }}>
      <defs>
        <pattern id={pid} x={0} y={offset} width={32} height={period} patternUnits="userSpaceOnUse">
          {[0, 1, 2, 3, 4].map((i) => (
            <line key={i} x1={0} x2={32} y1={i * gap + 0.5} y2={i * gap + 0.5} stroke="var(--staff)" strokeWidth={1} />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${pid})`} />
    </svg>
  )
}
