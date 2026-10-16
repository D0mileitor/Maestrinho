import { memo, useEffect, useMemo, useState } from 'react'
import { HUB_DRAG_TYPE, type HubEntry, type HubPreview } from '@shared/hub'
import { useApp } from '../store/appStore'
import { useUi } from '../store/uiStore'
import { api, errorMessage } from '../lib/api'
import { canvasBridge } from '../canvas/bridge'
import { IconHub } from '../lib/icons'
import { describeReport } from '../dialogs/PartiturasDialog'
import { t } from '../i18n'
import { paineisHintsDin as PH } from '../i18n/hints/paineis'
import { hint, hintOf } from '../hints/hint'
import '../styles/hub.css'

const H = t.hub

/** Insere uma partitura do catálogo no canvas, com o canto superior esquerdo em `position`. */
export async function insertFromHub(id: string, position: { x: number; y: number }): Promise<void> {
  const st = useApp.getState()
  const dir = st.active?.dir
  if (!dir) return
  try {
    const r = await api.invoke('hub:insert', { dir, id, position })
    st.toast(r.presetFallbacks.length ? 'warn' : 'info', `"${r.name}": ${describeReport(r)}`)
  } catch (err) {
    st.toast('error', errorMessage(err))
  }
}

type Load = { status: 'loading' } | { status: 'ready'; items: HubEntry[]; total: number } | { status: 'error'; message: string }

/** Painel das partituras prontas (catálogo embutido no app): busca, etiquetas e cartões para arrastar ao canvas. */
export function HubPanel(): React.JSX.Element | null {
  const open = useUi((s) => s.hubOpen)
  if (!open) return null
  return <Panel />
}

function Panel(): React.JSX.Element {
  const presets = useApp((s) => s.config?.presets)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    const timer = setTimeout(
      () => {
        setLoad((l) => (l.status === 'ready' ? l : { status: 'loading' }))
        api
          .invoke('hub:list', { q })
          .then((page) => alive && setLoad({ status: 'ready', items: page.items, total: page.total }))
          .catch((err) => alive && setLoad({ status: 'error', message: errorMessage(err) }))
      },
      q ? 250 : 0
    )
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q])

  const presetLabel = useMemo(() => new Map((presets ?? []).map((p) => [p.id, p.label])), [presets])
  const items = useMemo(() => (load.status === 'ready' ? load.items : []), [load])
  const tags = useMemo(() => {
    const count = new Map<string, number>()
    for (const e of items) for (const tg of e.tags) count.set(tg, (count.get(tg) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12)
  }, [items])
  const shown = tag ? items.filter((e) => e.tags.includes(tag)) : items

  const insertCentered = (id: string): void => {
    const c = canvasBridge()?.viewportCenter() ?? { x: 0, y: 0 }
    void insertFromHub(id, { x: Math.round(c.x - 600), y: Math.round(c.y - 300) })
  }

  return (
    <aside className="hub-panel" aria-label={H.title}>
      <header className="hub-head">
        <IconHub size={15} className="muted" />
        <strong>{H.title}</strong>
        <span className="spacer" />
        <button type="button" className="icon-btn" {...hint('hub.fechar')} aria-label={H.close} onClick={() => useUi.getState().setHubOpen(false)}>
          ×
        </button>
      </header>
      <div className="hub-search">
        <input className="input" value={q} placeholder={H.search} spellCheck={false} {...hint('hub.buscar')} onChange={(e) => setQ(e.target.value)} />
        {tags.length > 0 && (
          <div className="hub-tags">
            {tags.map(([tg, n]) => (
              <button
                key={tg}
                type="button"
                className={`hub-tag${tg === tag ? ' on' : ''}`}
                aria-pressed={tg === tag}
                {...hintOf(PH.hubEtiqueta(tg, n, tg === tag))}
                onClick={() => setTag(tg === tag ? '' : tg)}
              >
                {tg} <small>{n}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="hub-list">
        {load.status === 'loading' && <p className="hub-empty">{H.loading}</p>}
        {load.status === 'error' && <p className="hub-empty">{load.message}</p>}
        {load.status === 'ready' && shown.length === 0 && <p className="hub-empty">{q || tag ? H.noMatch : H.emptyCatalog}</p>}
        {shown.map((e) => (
          <Card key={e.id} entry={e} presetLabel={presetLabel} onInsert={() => insertCentered(e.id)} />
        ))}
      </div>
      <footer className="hub-foot">
        {load.status === 'ready' ? H.footer(load.total) : ''}
      </footer>
    </aside>
  )
}

const Card = memo(function Card({ entry, presetLabel, onInsert }: { entry: HubEntry; presetLabel: Map<string, string>; onInsert: () => void }): React.JSX.Element {
  const agents = entry.presets.map((p) => presetLabel.get(p) ?? p).join(', ')
  return (
    <article
      className="hub-card"
      draggable
      {...hintOf(PH.hubCartao(entry.name))}
      onDragStart={(e) => {
        e.dataTransfer.setData(HUB_DRAG_TYPE, entry.id)
        e.dataTransfer.setData('text/plain', entry.name)
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <Preview preview={entry.preview} />
      <h4>{entry.name}</h4>
      {entry.description && <p className="hub-desc">{entry.description}</p>}
      <p className="hub-meta">
        {H.meta(entry.agents, entry.notes.length)}
        {agents && ` · ${agents}`}
      </p>
      {entry.roles.length > 0 && <p className="hub-roles">{entry.roles.join(' · ')}</p>}
      <div className="hub-card-foot">
        <span className="hub-card-tags">
          {entry.tags.slice(0, 4).map((tg) => (
            <span key={tg} className="hub-chip">
              {tg}
            </span>
          ))}
        </span>
        <button type="button" className="btn btn-ghost hub-insert" {...hint('hub.inserir')} onClick={onInsert}>
          {H.insert}
        </button>
      </div>
    </article>
  )
})

/** Miniatura do desenho da partitura (terminais na cor do papel, notas, portais e conexões). */
function Preview({ preview }: { preview: HubPreview }): React.JSX.Element | null {
  const { nodes, edges } = preview
  if (nodes.length === 0) return null
  const W = 100
  const Hh = 46
  const maxX = Math.max(...nodes.map((n) => n.x + n.w))
  const maxY = Math.max(...nodes.map((n) => n.y + n.h))
  const k = Math.min((W - 6) / (maxX || 1), (Hh - 6) / (maxY || 1))
  const ox = (W - maxX * k) / 2
  const oy = (Hh - maxY * k) / 2
  const box = nodes.map((n) => ({ ...n, x: ox + n.x * k, y: oy + n.y * k, w: n.w * k, h: n.h * k }))
  return (
    <svg className="hub-preview" viewBox={`0 0 ${W} ${Hh}`} aria-hidden="true">
      {edges.map(([a, b], i) => {
        const p = box[a]
        const q = box[b]
        if (!p || !q) return null
        return <line key={i} x1={p.x + p.w / 2} y1={p.y + p.h / 2} x2={q.x + q.w / 2} y2={q.y + q.h / 2} />
      })}
      {box.map((n, i) => (
        <rect key={i} className={`k-${n.kind}`} x={n.x} y={n.y} width={n.w} height={n.h} rx={1.2} style={n.kind === 'terminal' && n.color ? { fill: n.color } : undefined}>
          <title>{n.label}</title>
        </rect>
      ))}
    </svg>
  )
}
