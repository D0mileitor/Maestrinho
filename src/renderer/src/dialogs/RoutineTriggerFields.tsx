import type { BoardColumn } from '@shared/board'
import type { Routine, RoutineTrigger } from '@shared/schemas'
import { describeInterval } from '@shared/routines'
import { routinesText as R } from '../i18n/routines'
import { hint } from '../hints/hint'

type Kind = RoutineTrigger['kind']

/** Gatilho padrão ao trocar o tipo (com o primeiro terminal/coluna como sugestão). */
function defaultTrigger(kind: Kind, terminals: { id: string }[], columns: BoardColumn[]): RoutineTrigger {
  switch (kind) {
    case 'interval':
      return { kind }
    case 'agentDone':
      return { kind, sourceId: terminals[0]?.id ?? 'x' }
    case 'message':
      return { kind, mood: 'any' }
    case 'boardColumn':
      return { kind, column: columns[0]?.id ?? 'x' }
    case 'fileChange':
      return { kind, pattern: 'src/**' }
  }
}

/** "Quando": intervalo (como antes) ou um acontecimento no workspace, com os campos de cada tipo. */
export function RoutineTriggerFields({
  draft,
  setDraft,
  terminals,
  columns
}: {
  draft: Routine
  setDraft(r: Routine): void
  terminals: { id: string; name: string }[]
  columns: BoardColumn[]
}): React.JSX.Element {
  const t = draft.trigger
  const set = (trigger: RoutineTrigger): void => setDraft({ ...draft, trigger })
  const terminalSelect = (value: string | undefined, onChange: (v: string | undefined) => void, any?: string): React.JSX.Element => (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      {any && <option value="">{any}</option>}
      {terminals.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </select>
  )

  return (
    <>
      <label className="field" {...hint('dialogo.rotinas.quando')}>
        <span>{R.when}</span>
        <select className="select" value={t.kind} onChange={(e) => set(defaultTrigger(e.target.value as Kind, terminals, columns))}>
          {(Object.keys(R.kinds) as Kind[]).map((k) => (
            <option key={k} value={k} disabled={k === 'boardColumn' && columns.length === 0}>
              {R.kinds[k]}
            </option>
          ))}
        </select>
      </label>

      {t.kind === 'interval' && (
        <label className="field" {...hint('dialogo.rotinas.intervalo')}>
          <span>{R.intervalLabel}</span>
          <div className="inline">
            <input
              className="input narrow"
              type="number"
              min={1}
              max={10080}
              value={draft.intervalMinutes}
              onChange={(e) => setDraft({ ...draft, intervalMinutes: Math.max(1, Number(e.target.value) || 1) })}
            />
            {[10, 30, 60, 240, 1440].map((m) => (
              <button
                type="button"
                key={m}
                className="btn btn-ghost"
                {...hint('dialogo.rotinas.intervaloPronto')}
                onClick={() => setDraft({ ...draft, intervalMinutes: m })}
              >
                {describeInterval(m)}
              </button>
            ))}
          </div>
        </label>
      )}

      {t.kind === 'agentDone' && (
        <label className="field" {...hint('dialogo.rotinas.quemTerminar')}>
          <span>{R.source}</span>
          {terminalSelect(t.sourceId, (v) => set({ ...t, sourceId: v ?? t.sourceId }))}
        </label>
      )}

      {t.kind === 'message' && (
        <div className="form-row">
          <label className="field" {...hint('dialogo.rotinas.mensagemDe')}>
            <span>{R.from}</span>
            {terminalSelect(t.fromId, (v) => set({ ...t, fromId: v }), R.anyAgent)}
          </label>
          <label className="field" {...hint('dialogo.rotinas.mensagemPara')}>
            <span>{R.to}</span>
            {terminalSelect(t.toId, (v) => set({ ...t, toId: v }), R.anyAgent)}
          </label>
          <label className="field" {...hint('dialogo.rotinas.tom')}>
            <span>{R.mood}</span>
            <select className="select" value={t.mood} onChange={(e) => set({ ...t, mood: e.target.value as 'any' | 'complaint' | 'praise' })}>
              <option value="any">{R.moods.any}</option>
              <option value="complaint">{R.moods.complaint}</option>
              <option value="praise">{R.moods.praise}</option>
            </select>
          </label>
        </div>
      )}

      {t.kind === 'boardColumn' && (
        <label className="field" {...hint('dialogo.rotinas.coluna')}>
          <span>{R.column}</span>
          <select className="select" value={t.column} onChange={(e) => set({ ...t, column: e.target.value })}>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {t.kind === 'fileChange' && (
        <label className="field" {...hint('dialogo.rotinas.arquivos')}>
          <span>{R.pattern}</span>
          <input className="input mono" value={t.pattern} spellCheck={false} onChange={(e) => set({ ...t, pattern: e.target.value })} />
          <small>{R.patternHint}</small>
        </label>
      )}

      {t.kind !== 'interval' && (
        <>
          <small className="muted">{R.vars[t.kind]}</small>
          <label className="field" {...hint('dialogo.rotinas.teto')}>
            <span>{R.cap}</span>
            <input
              className="input narrow"
              type="number"
              min={1}
              max={120}
              value={draft.maxPerHour}
              onChange={(e) => setDraft({ ...draft, maxPerHour: Math.min(120, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </label>
        </>
      )}
    </>
  )
}
