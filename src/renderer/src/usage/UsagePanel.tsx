import { useEffect, useRef, useState } from 'react'
import { agentShares, currentPercent, peakPercent, usageSeverity, type AgentUsage, type ProviderUsage, type UsagePause, type UsageWindow } from '@shared/usage'
import { useApp } from '../store/appStore'
import { useUsage, useUsagePolling } from '../store/usageStore'
import { IconGauge } from '../lib/icons'
import { usageText as U } from '../i18n/usage'
import { hint } from '../hints/hint'
import '../styles/usage.css'

/** Dados com mais de uma hora: avisa que o agente precisa estar aberto para atualizar. */
const STALE_MS = 60 * 60_000

/** Botão da barra de cima: medidor e o maior uso atual entre os provedores. */
export function UsageButton(): React.JSX.Element {
  useUsagePolling()
  const open = useUsage((s) => s.open)
  const report = useUsage((s) => s.report)
  const peak = report ? peakPercent(report, Date.now()) : null
  const shown = peak === null ? null : Math.round(peak)
  return (
    <button
      type="button"
      className={`tool-btn usage-btn${open ? ' active' : ''}${shown === null ? '' : ` ${usageSeverity(shown)}`}`}
      data-usage-toggle=""
      {...hint('topo.uso')}
      aria-label={shown === null ? U.open : `${U.open}. ${U.peak(shown)}`}
      aria-pressed={open}
      onClick={() => useUsage.getState().setOpen(!open)}
    >
      <IconGauge size={16} />
      {shown !== null && <span className="usage-peak">{shown}%</span>}
    </button>
  )
}

/** Painel com o uso da assinatura de cada provedor encontrado neste computador. */
export function UsagePanel(): React.JSX.Element | null {
  const open = useUsage((s) => s.open)
  if (!open) return null
  return <Panel />
}

function Panel(): React.JSX.Element {
  const report = useUsage((s) => s.report)
  const loading = useUsage((s) => s.loading)
  const ref = useRef<HTMLElement>(null)

  // Fecha com Esc ou clicando fora (o botão da barra alterna sozinho).
  useEffect(() => {
    const close = (): void => useUsage.getState().setOpen(false)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    const onDown = (e: PointerEvent): void => {
      const target = e.target instanceof Element ? e.target : null
      if (target && (ref.current?.contains(target) || target.closest('[data-usage-toggle]'))) return
      close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [])

  const now = Date.now()
  const [period, setPeriod] = useState<'session' | 'week'>('session')
  const agents = report?.agents ?? null
  return (
    <aside ref={ref} className="usage-panel" role="dialog" aria-label={U.title}>
      <header className="usage-head">
        <IconGauge size={15} />
        <strong>{U.title}</strong>
        <span className="spacer" />
        <button
          type="button"
          className="icon-btn"
          disabled={loading}
          {...hint('uso.atualizar')}
          aria-label={U.refresh}
          onClick={() => void useUsage.getState().refresh()}
        >
          ↻
        </button>
        <button type="button" className="icon-btn" {...hint('uso.fechar')} aria-label={U.close} onClick={() => useUsage.getState().setOpen(false)}>
          ×
        </button>
      </header>
      <div className="usage-body">
        {report?.pause && <p className="usage-paused">{pauseText(report.pause)}</p>}
        {report && report.providers.length > 0 ? (
          report.providers.map((p) => (
            <Provider key={p.provider} usage={p} now={now} agents={agents} period={period} onPeriod={setPeriod} />
          ))
        ) : (
          <p className="usage-empty">{report ? U.empty : '…'}</p>
        )}
      </div>
      <footer className="usage-foot">
        <span>{U.footer}</span>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            useUsage.getState().setOpen(false)
            useApp.getState().setDialog({ kind: 'settings' })
          }}
        >
          {U.settingsLink}
        </button>
      </footer>
    </aside>
  )
}

function pauseText(p: UsagePause): string {
  const window = U.pauseWindow(p.kind, p.scope)
  return U.paused(U.providers[p.provider] ?? p.provider, Math.round(p.percent), window, p.until)
}

interface ProviderProps {
  usage: ProviderUsage
  now: number
  /** null = ainda não lido (o painel acabou de abrir). */
  agents: AgentUsage[] | null
  period: 'session' | 'week'
  onPeriod(period: 'session' | 'week'): void
}

function Provider({ usage, now, agents, period, onPeriod }: ProviderProps): React.JSX.Element {
  const age = usage.updatedAt === null ? null : Math.max(0, now - usage.updatedAt)
  const stale = age !== null && age > STALE_MS
  return (
    <section className="usage-provider">
      <div className="usage-provider-head">
        <strong>{U.providers[usage.provider] ?? usage.provider}</strong>
        {usage.plan && <span className="usage-plan">{usage.plan}</span>}
        <span className="spacer" />
        {age !== null && <span className={`usage-updated${stale ? ' stale' : ''}`}>{U.updated(age)}</span>}
      </div>
      {usage.windows.map((w, i) => (
        <WindowRow key={`${w.kind}:${w.scope ?? ''}:${i}`} w={w} now={now} />
      ))}
      {stale && U.stale[usage.provider] && <p className="usage-note">{U.stale[usage.provider]}</p>}
      {agents && <Agents agents={agents.filter((a) => a.provider === usage.provider)} period={period} onPeriod={onPeriod} />}
    </section>
  )
}

function windowLabel(w: UsageWindow): string {
  if (w.kind === 'session') return U.session
  if (w.kind === 'weekly') return U.weekly(w.scope)
  return U.other(w.windowMinutes, w.scope)
}

function resetLabel(w: UsageWindow, now: number): string {
  if (w.resetsAt === null) return w.kind === 'session' && w.usedPercent === 0 ? U.notStarted : ''
  if (w.resetsAt <= now) return U.reset
  return w.resetsAt - now < 24 * 60 * 60_000 ? U.resetsIn(w.resetsAt - now) : U.resetsAt(w.resetsAt)
}

function WindowRow({ w, now }: { w: UsageWindow; now: number }): React.JSX.Element {
  const percent = currentPercent(w, now)
  const label = windowLabel(w)
  const reset = resetLabel(w, now)
  return (
    <div className={`usage-window ${usageSeverity(percent)}`}>
      <div className="usage-window-line">
        <span>{label}</span>
        <strong>{Math.round(percent)}%</strong>
      </div>
      <div className="usage-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <span style={{ width: `${percent}%` }} />
      </div>
      {reset && <div className="usage-reset">{reset}</div>}
    </div>
  )
}

/** Divisão do uso entre os terminais de agente deste provedor (pelo peso dos tokens no período). */
function Agents({ agents, period, onPeriod }: { agents: AgentUsage[]; period: 'session' | 'week'; onPeriod(p: 'session' | 'week'): void }): React.JSX.Element {
  const shares = agentShares(agents, period)
  const rows = agents.filter((a) => a[period].weight > 0).sort((a, b) => (shares.get(b.terminalId) ?? 0) - (shares.get(a.terminalId) ?? 0))
  const workspaces = new Set(agents.map((a) => a.workspace))
  return (
    <div className="usage-agents">
      <div className="usage-agents-head">
        <span>{U.byAgent}</span>
        <span className="usage-period" role="group">
          <button type="button" aria-pressed={period === 'session'} onClick={() => onPeriod('session')}>
            {U.periodSession}
          </button>
          <button type="button" aria-pressed={period === 'week'} onClick={() => onPeriod('week')}>
            {U.periodWeek}
          </button>
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="usage-note">{U.noAgents}</p>
      ) : (
        rows.map((a) => {
          const share = shares.get(a.terminalId) ?? 0
          const t = a[period]
          return (
            <div key={a.terminalId} className="usage-agent">
              <div className="usage-window-line">
                <span className="usage-agent-name">
                  {a.name}
                  {workspaces.size > 1 && <small> · {a.workspace}</small>}
                </span>
                <strong>{Math.round(share)}%</strong>
              </div>
              <div className="usage-bar thin" role="meter" aria-label={a.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)}>
                <span style={{ width: `${share}%` }} />
              </div>
              <div className="usage-reset">
                {a.model ? `${a.model} · ` : ''}
                {U.tokens(t.input + t.cacheWrite, t.output, t.cacheRead)}
              </div>
            </div>
          )
        })
      )}
      {rows.length > 0 && <p className="usage-note">{U.agentsNote}</p>}
    </div>
  )
}
