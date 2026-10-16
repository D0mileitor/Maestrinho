import { useEffect, useMemo, useState } from 'react'
import { newId } from '@shared/ids'
import type { RoutinesState, RoutineView } from '@shared/ipc'
import { describeTrigger, parseRoutineSteps } from '@shared/routines'
import type { BoardColumn } from '@shared/board'
import { RoutineSchema, type Routine, type RoutineOutcome } from '@shared/schemas'
import { useApp } from '../store/appStore'
import { Dialog } from './Dialog'
import { api, errorMessage } from '../lib/api'
import { hint } from '../hints/hint'
import { RoutineTriggerFields } from './RoutineTriggerFields'
import { routinesText as RT } from '../i18n/routines'

const OUTCOME_LABEL: Record<RoutineOutcome, string> = {
  completed: 'concluída',
  terminalNotRunning: 'terminal parado',
  skippedBusy: 'pulada (agente ocupado)',
  skippedLimit: 'pulada (limite da assinatura)',
  skippedCap: 'pulada (limite de disparos por hora)',
  failed: 'falhou',
  cancelled: 'cancelada'
}

function relative(ts: number): string {
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const min = Math.round(abs / 60_000)
  const txt = min < 1 ? 'menos de 1 min' : min < 60 ? `${min} min` : `${Math.round(min / 60)} h`
  return diff >= 0 ? `em ${txt}` : `há ${txt}`
}

function blank(targetId: string): Routine {
  return RoutineSchema.parse({
    id: newId('rt'),
    name: 'Nova rotina',
    targetId: targetId || 'x',
    script: 'Rode os testes e me diga o resultado\n&&\nSe algo falhou, corrija',
    intervalMinutes: 10,
    createdAt: new Date().toISOString()
  })
}

/** Rotinas do workspace: prompts agendados enviados a um terminal (passos separados por "&&"). */
export function RoutinesDialog(): React.JSX.Element | null {
  const active = useApp((s) => s.active)
  const setDialog = useApp((s) => s.setDialog)
  const toast = useApp((s) => s.toast)
  const [state, setState] = useState<RoutinesState | null>(null)
  const [draft, setDraft] = useState<Routine | null>(null)
  const [, setTick] = useState(0)
  const [columns, setColumns] = useState<BoardColumn[]>([])
  const dir = active?.dir ?? ''
  const terminals = useMemo(
    () => (active?.doc.nodes ?? []).flatMap((n) => (n.kind === 'terminal' ? [{ id: n.id, name: n.name }] : [])),
    [active]
  )

  useEffect(() => {
    if (!dir) return
    void api.invoke('routines:list', { dir }).then(setState).catch((e) => toast('error', errorMessage(e)))
    void api
      .invoke('board:get', { dir })
      .then((b) => setColumns(b.columns))
      .catch(() => setColumns([]))
    const off = api.on('routines:changed', (e) => {
      if (e.dir === dir) setState({ routines: e.routines, history: e.history })
    })
    const t = setInterval(() => setTick((x) => x + 1), 20_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [dir, toast])

  if (!active) return null
  const close = (): void => setDialog({ kind: 'none' })
  const nameOf = (id: string): string => terminals.find((t) => t.id === id)?.name ?? '(terminal removido)'
  const columnName = (id: string): string => columns.find((c) => c.id === id)?.name ?? id

  const save = async (): Promise<void> => {
    if (!draft) return
    const parsed = RoutineSchema.safeParse(draft)
    if (!parsed.success) {
      toast('error', parsed.error.issues[0]?.message ?? 'rotina inválida')
      return
    }
    try {
      setState(await api.invoke('routines:save', { dir, routine: parsed.data }))
      setDraft(null)
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  const toggle = async (r: RoutineView): Promise<void> => {
    const { nextRunAt: _n, running: _r, ...routine } = r
    try {
      setState(await api.invoke('routines:save', { dir, routine: { ...routine, enabled: !r.enabled } }))
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  const steps = draft ? parseRoutineSteps(draft.script).length : 0

  return (
    <Dialog
      title="Rotinas"
      lead="Prompts enviados automaticamente a um terminal, a cada N minutos ou quando algo acontece (um agente termina, manda uma reprovação, um cartão muda de coluna, arquivos mudam). Uma linha com apenas && separa passos: cada passo só é enviado quando o agente termina o anterior."
      wide
      onClose={close}
    >
      {!draft && (
        <>
          {terminals.length === 0 && <p className="muted">Crie um terminal no canvas para poder agendar rotinas.</p>}
          {terminals.length > 0 && state && state.routines.length === 0 && (
            <p className="muted">
              Nenhuma rotina neste workspace. Exemplo: a cada 30 minutos, pedir ao agente para rodar os testes e corrigir o que
              falhar.
            </p>
          )}
          <ul className="routine-list">
            {(state?.routines ?? []).map((r) => (
              <li key={r.id} className={`routine-item${r.enabled ? '' : ' paused'}`}>
                <div className="routine-main">
                  <strong>{r.name}</strong>
                  <span className="muted">
                    {nameOf(r.targetId)}, {describeTrigger(r, nameOf, columnName)}, {parseRoutineSteps(r.script).length} passo(s)
                  </span>
                  <span className="routine-status">
                    {r.running ? (
                      <span className="chip chip-badge running">
                        rodando passo {r.running.step}/{r.running.total}
                      </span>
                    ) : r.enabled && r.trigger.kind !== 'interval' ? (
                      <span className="muted">{RT.waiting}</span>
                    ) : r.enabled ? (
                      <span className="muted">próxima {relative(r.nextRunAt)}</span>
                    ) : (
                      <span className="muted">pausada</span>
                    )}
                  </span>
                </div>
                <div className="routine-actions">
                  {r.running ? (
                    <button className="btn" {...hint('dialogo.rotinas.cancelar')} onClick={() => void api.invoke('routines:cancel', { dir, id: r.id })}>
                      Cancelar
                    </button>
                  ) : (
                    <button
                      className="btn"
                      {...hint('dialogo.rotinas.executar')}
                      onClick={() =>
                        void api.invoke('routines:runNow', { dir, id: r.id }).catch((e) => toast('error', errorMessage(e)))
                      }
                    >
                      Executar agora
                    </button>
                  )}
                  <button className="btn" {...hint(r.enabled ? 'dialogo.rotinas.pausar' : 'dialogo.rotinas.retomar')} onClick={() => void toggle(r)}>
                    {r.enabled ? 'Pausar' : 'Retomar'}
                  </button>
                  <button
                    className="btn"
                    {...hint('dialogo.rotinas.editar')}
                    onClick={() => {
                      const { nextRunAt: _n, running: _r, ...routine } = r
                      setDraft(routine)
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className="btn btn-danger"
                    {...hint('dialogo.rotinas.excluir')}
                    onClick={() => {
                      if (window.confirm(`Excluir a rotina "${r.name}"?`)) {
                        void api.invoke('routines:delete', { dir, id: r.id }).then(setState)
                      }
                    }}
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {(state?.history.length ?? 0) > 0 && (
            <section className="routine-history">
              <h3>Últimas execuções</h3>
              <ul>
                {state!.history.slice(0, 8).map((h, i) => (
                  <li key={`${h.at}-${i}`}>
                    <span>{new Date(h.at).toLocaleString('pt-BR')}</span> <strong>{h.name}</strong>{' '}
                    <span className={`outcome ${h.outcome}`}>{OUTCOME_LABEL[h.outcome]}</span>{' '}
                    <span className="muted">
                      {h.stepsSent}/{h.stepsTotal} passo(s){h.detail ? `, ${h.detail}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="dialog-actions">
            <button className="btn" {...hint('dialogo.rotinas.fechar')} onClick={close}>
              Fechar
            </button>
            <button
              className="btn btn-primary"
              disabled={terminals.length === 0}
              {...hint('dialogo.rotinas.nova')}
              onClick={() => setDraft(blank(terminals[0]?.id ?? ''))}
            >
              Nova rotina
            </button>
          </div>
        </>
      )}

      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="form-row">
            <label className="field">
              <span>Nome</span>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field" {...hint('dialogo.rotinas.alvo')}>
              <span>Terminal alvo</span>
              <select className="select" value={draft.targetId} onChange={(e) => setDraft({ ...draft, targetId: e.target.value })}>
                {terminals.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <RoutineTriggerFields draft={draft} setDraft={setDraft} terminals={terminals} columns={columns} />
          <label className="field" {...hint('dialogo.rotinas.prompt')}>
            <span>Prompt ({steps} passo{steps === 1 ? '' : 's'})</span>
            <textarea
              className="textarea mono"
              rows={8}
              value={draft.script}
              onChange={(e) => setDraft({ ...draft, script: e.target.value })}
            />
            <small>Separe passos com uma linha contendo apenas &&.</small>
          </label>
          {draft.trigger.kind === 'interval' && (
            <label className="check" {...hint('dialogo.rotinas.pularOcupado')}>
              <input type="checkbox" checked={draft.skipIfBusy} onChange={(e) => setDraft({ ...draft, skipIfBusy: e.target.checked })} />
              <span>Pular o disparo se o agente estiver trabalhando</span>
            </label>
          )}
          <label className="check" {...hint('dialogo.rotinas.notificar')}>
            <input type="checkbox" checked={draft.notifyOnRun} onChange={(e) => setDraft({ ...draft, notifyOnRun: e.target.checked })} />
            <span>Notificar ao terminar cada execução</span>
          </label>
          <label className="check" {...hint('dialogo.rotinas.ativa')}>
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            <span>Ativa</span>
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn" {...hint('dialogo.rotinas.voltar')} onClick={() => setDraft(null)}>
              Voltar
            </button>
            <button type="submit" className="btn btn-primary" disabled={steps === 0} {...hint('dialogo.rotinas.salvar')}>
              Salvar rotina
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
