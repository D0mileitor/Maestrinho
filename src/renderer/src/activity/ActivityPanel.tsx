import { useEffect, useRef } from 'react'
import type { ActivityEvent } from '@shared/activity'
import { useActivity } from '../store/activityStore'
import { useApp } from '../store/appStore'
import { IconActivity } from '../lib/icons'
import { activityText as A } from '../i18n/activity'
import { hint } from '../hints/hint'
import '../styles/activity.css'

function when(at: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`
}

/** Leva até o terminal do evento (trocando de workspace se preciso). */
function goTo(e: ActivityEvent): void {
  const id = e.terminalId
  if (!id || !e.dir) return
  useActivity.getState().setOpen(false)
  const s = useApp.getState()
  if (s.active?.dir !== e.dir) void s.openWorkspace(e.dir).then(() => useApp.getState().requestFocus(id))
  else s.requestFocus(id)
}

/** Botão da barra de título: abre a linha do tempo; o número são as novidades desde a última vez. */
export function ActivityButton(): React.JSX.Element {
  const open = useActivity((s) => s.open)
  const unseen = useActivity((s) => s.events.filter((e) => e.id > s.seenId).length)
  return (
    <button
      type="button"
      className={`tool-btn activity-btn${open ? ' active' : ''}`}
      data-activity-toggle=""
      {...hint('topo.atividade')}
      aria-label={unseen ? `${A.open}: ${A.unseen(unseen)}` : A.open}
      aria-pressed={open}
      onClick={() => useActivity.getState().setOpen(!open)}
    >
      <IconActivity size={15} />
      {unseen > 0 && <span className="activity-count">{unseen > 99 ? '99+' : unseen}</span>}
    </button>
  )
}

/** Linha do tempo: o que aconteceu nos workspaces, do mais recente para o mais antigo. */
export function ActivityPanel(): React.JSX.Element | null {
  const open = useActivity((s) => s.open)
  if (!open) return null
  return <Panel />
}

function Panel(): React.JSX.Element {
  const events = useActivity((s) => s.events)
  const workspaces = useApp((s) => s.workspaces)
  const ref = useRef<HTMLElement>(null)
  const names = new Map(workspaces.map((w) => [w.dir, w.name]))
  const many = new Set(events.map((e) => e.dir).filter(Boolean)).size > 1

  useEffect(() => {
    const close = (): void => useActivity.getState().setOpen(false)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    const onDown = (e: PointerEvent): void => {
      const t = e.target instanceof Element ? e.target : null
      if (t && (ref.current?.contains(t) || t.closest('[data-activity-toggle]'))) return
      close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [])

  const list = [...events].reverse()
  return (
    <aside ref={ref} className="activity-panel" role="dialog" aria-label={A.title}>
      <header className="activity-head">
        <IconActivity size={15} />
        <strong>{A.title}</strong>
        <span className="spacer" />
        <button type="button" className="icon-btn" aria-label={A.close} onClick={() => useActivity.getState().setOpen(false)}>
          ×
        </button>
      </header>
      {list.length === 0 ? (
        <p className="activity-empty">{A.empty}</p>
      ) : (
        <ul className="activity-list">
          {list.map((e) => (
            <li key={e.id} className={`activity-item ${e.kind}`}>
              <time>{when(e.at)}</time>
              <button type="button" className="activity-text" disabled={!e.terminalId} onClick={() => goTo(e)}>
                {A.line(e)}
                {e.mood && <span className={`activity-mood ${e.mood}`}>{A.mood[e.mood]}</span>}
                {many && e.dir && <small> · {names.get(e.dir) ?? e.dir}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

/** Resumo ao voltar depois de um tempo fora (some ao fechar ou ao abrir a linha do tempo). */
export function AwayCard(): React.JSX.Element | null {
  const away = useActivity((s) => s.away)
  if (!away) return null
  return (
    <aside className="away-card" role="status">
      <strong>{A.awayTitle(away.minutes)}</strong>
      <ul>
        {A.awayLines(away).map((l, i) => (
          <li key={i} className={l.warn ? 'warn' : ''}>
            {l.text}
          </li>
        ))}
      </ul>
      <div className="away-actions">
        <button type="button" className="btn" onClick={() => useActivity.getState().closeAway()}>
          {A.dismiss}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => useActivity.getState().setOpen(true)}>
          {A.seeTimeline}
        </button>
      </div>
    </aside>
  )
}
