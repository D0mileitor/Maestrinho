import { useApp } from '../store/appStore'
import { IconLayers, IconPlus } from '../lib/icons'
import { hint, hintOf } from '../hints/hint'
import type { HintText } from '../hints/content'
import { hintText } from '../i18n/hints'

/** Abas de floors (térreo + ambientes isolados em git worktree). Detalhes na Fase 5. */
export function FloorTabs(): React.JSX.Element | null {
  const active = useApp((s) => s.active)
  const applyOps = useApp((s) => s.applyOps)
  const setDialog = useApp((s) => s.setDialog)
  if (!active) return null
  const floors = active.doc.floors
  const current = active.doc.activeFloorId
  if (floors.length === 0 && !active.isGitRepo) return null
  const manage = (floorId: string): void => setDialog({ kind: 'floorManage', floorId })
  const floorHint: HintText = hintText['floors.floor']
  return (
    <div className="floor-tabs" role="tablist" aria-label="Floors">
      <IconLayers size={14} className="muted" />
      <button
        role="tab"
        aria-selected={!current}
        className={`floor-tab${!current ? ' active' : ''}`}
        {...hint('floors.terreo')}
        onClick={() => void applyOps([{ op: 'setActiveFloor', floorId: null }])}
      >
        Térreo
      </button>
      {floors.map((f) => (
        <div
          key={f.id}
          className={`floor-tab-wrap${current === f.id ? ' active' : ''}`}
          onContextMenu={(e) => {
            e.preventDefault()
            manage(f.id)
          }}
        >
          <button
            role="tab"
            aria-selected={current === f.id}
            className={`floor-tab${current === f.id ? ' active' : ''}`}
            {...hintOf({ title: f.name, body: [`branch ${f.branch}`, floorHint.body].filter(Boolean).join('\n') })}
            onClick={() => void applyOps([{ op: 'setActiveFloor', floorId: f.id }])}
            onDoubleClick={() => manage(f.id)}
          >
            {f.name}
          </button>
          <button
            className="floor-tab-close"
            {...hint('floors.descartar')}
            aria-label={`Descartar o floor ${f.name}`}
            onClick={() => manage(f.id)}
          >
            ×
          </button>
        </div>
      ))}
      {active.isGitRepo && (
        <button className="icon-btn" {...hint('floors.novo')} aria-label="Novo floor" onClick={() => setDialog({ kind: 'floorCreate' })}>
          <IconPlus size={13} />
        </button>
      )}
    </div>
  )
}
