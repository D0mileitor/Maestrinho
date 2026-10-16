import { useId, useMemo, useState } from 'react'
import { newId } from '@shared/ids'
import { RoleSchema, type Role, type TerminalNodeData } from '@shared/schemas'
import { useApp } from '../store/appStore'
import { Dialog } from './Dialog'
import { api, errorMessage } from '../lib/api'
import { t } from '../i18n'
import { rolesText as tr } from '../i18n/roles'
import { agentText } from '../i18n/agents'
import { ModelEffortPair } from './ModelEffortFields'
import { hint, hintOf } from '../hints/hint'

const MAX_INSTRUCTIONS = 32_000
/** Cores sugeridas: as dos papéis de fábrica e alguns tons do tema. */
const SWATCHES = ['#d4a849', '#5fb98e', '#6f8fbf', '#c58ad6', '#5fc0cc', '#e5534b', '#e0a33a', '#8790a3']
const COLOR_RE = /^#[0-9a-fA-F]{6}$/
const NL = String.fromCharCode(10)
/** Na grade de duas colunas, campo sem dica não estica o controle até a altura do vizinho. */
const FIELD_STYLE: React.CSSProperties = { alignContent: 'start' }

/** Mesma normalização do ConfigStore.findRole (sem acentos/maiúsculas): nomes precisam ser únicos nela. */
function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

function blankRole(): Role {
  return { id: newId('r'), name: tr.defaultName, instructions: '', color: '', builtin: false }
}

function sameContent(a: Role | undefined, b: Role): boolean {
  return (
    a !== undefined &&
    a.name === b.name &&
    a.color === b.color &&
    a.instructions === b.instructions &&
    JSON.stringify(a.agentDefaults ?? {}) === JSON.stringify(b.agentDefaults ?? {})
  )
}

function preview(instructions: string): string {
  const first = instructions.trim().split(NL)[0] ?? ''
  return first || tr.noInstructions
}

function dotStyle(color: string): React.CSSProperties {
  return {
    width: 10,
    height: 10,
    flex: 'none',
    borderRadius: '50%',
    background: color || 'transparent',
    border: color ? 'none' : '1.5px solid var(--line-strong)'
  }
}

function swatchStyle(color: string, selected: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    padding: 0,
    flex: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    border: selected ? '2px solid var(--text)' : '1px solid var(--line-strong)',
    background: color || 'repeating-linear-gradient(45deg, transparent 0 4px, var(--line-strong) 4px 5.5px)'
  }
}

/** Gerenciador de papéis (instruções reutilizáveis atribuídas aos terminais). */
export function RolesDialog(): React.JSX.Element {
  const config = useApp((s) => s.config)
  const doc = useApp((s) => s.active?.doc)
  const runtime = useApp((s) => s.runtime)
  const setDialog = useApp((s) => s.setDialog)
  const toast = useApp((s) => s.toast)
  const roles = useMemo(() => config?.roles ?? [], [config])
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? '')
  const [draft, setDraft] = useState<Role | null>(() => (roles[0] ? structuredClone(roles[0]) : null))
  const [isNew, setIsNew] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Terminais em execução que usam o papel recém-salvo (oferece reiniciar). */
  const [affected, setAffected] = useState<{ roleId: string; ids: string[] } | null>(null)
  const colorLabelId = useId()

  const terminals = useMemo(
    () => (doc?.nodes ?? []).filter((n): n is TerminalNodeData => n.kind === 'terminal'),
    [doc]
  )
  const saved = draft ? roles.find((r) => r.id === draft.id) : undefined
  const dirty = draft !== null && (isNew || !sameContent(saved, draft))
  const colorInvalid = draft !== null && draft.color.trim() !== '' && !COLOR_RE.test(draft.color.trim())

  const usersOf = (roleId: string): TerminalNodeData[] => terminals.filter((n) => n.roleId === roleId)
  const runningIds = (nodes: TerminalNodeData[]): string[] =>
    nodes.filter((n) => runtime[n.id]?.status === 'running' || runtime[n.id]?.status === 'starting').map((n) => n.id)

  const confirmDiscard = (): boolean => !dirty || window.confirm(tr.confirmDiscard)

  const reset = (role: Role | null, fresh = false): void => {
    setSelectedId(role?.id ?? '')
    setDraft(role ? structuredClone(role) : null)
    setIsNew(fresh)
    setError(null)
    setAffected(null)
  }

  const select = (role: Role): void => {
    if (role.id === selectedId && !isNew) return
    if (!confirmDiscard()) return
    reset(role)
  }

  const startNew = (): void => {
    if (!confirmDiscard()) return
    reset(blankRole(), true)
  }

  const close = (): void => {
    if (confirmDiscard()) setDialog({ kind: 'none' })
  }

  const patch = (p: Partial<Role>): void => {
    setDraft((d) => (d ? { ...d, ...p } : d))
    setError(null)
  }

  const save = async (): Promise<void> => {
    if (!draft || busy) return
    const parsed = RoleSchema.safeParse({ ...draft, name: draft.name.trim(), color: draft.color.trim().toLowerCase() })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      setError(tr.errors.field(issue?.path.join('.') ?? '', issue?.message ?? tr.errors.invalidValue))
      return
    }
    const role = parsed.data
    if (roles.some((r) => r.id !== role.id && normName(r.name) === normName(role.name))) {
      setError(tr.errors.duplicate)
      return
    }
    const textChanged =
      !saved ||
      saved.name !== role.name ||
      saved.instructions !== role.instructions ||
      JSON.stringify(saved.agentDefaults ?? {}) !== JSON.stringify(role.agentDefaults ?? {})
    setBusy(true)
    try {
      await api.invoke('config:saveRole', role)
      setSelectedId(role.id)
      setDraft(structuredClone(role))
      setIsNew(false)
      setError(null)
      const hit = textChanged ? runningIds(usersOf(role.id)) : []
      setAffected(hit.length > 0 ? { roleId: role.id, ids: hit } : null)
      toast('info', tr.saved(role.name))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const restartAffected = async (): Promise<void> => {
    if (!affected) return
    const ids = affected.ids
    setAffected(null)
    for (const id of ids) {
      try {
        await api.invoke('pty:restart', { id })
      } catch (err) {
        toast('error', errorMessage(err))
      }
    }
  }

  const remove = async (): Promise<void> => {
    if (!draft || isNew || busy) return
    if (!window.confirm(tr.confirmDelete(draft.name, usersOf(draft.id).length))) return
    const name = draft.name
    setBusy(true)
    try {
      const list = await api.invoke('config:deleteRole', { id: draft.id })
      reset(list[0] ?? null)
      toast('info', tr.deleted(name))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const affectedNames = affected
    ? affected.ids.map((id) => terminals.find((n) => n.id === id)?.name ?? id)
    : []

  return (
    <Dialog title={tr.title} lead={tr.lead} wide onClose={close}>
      <div className="split">
        <div className="split-list" role="group" aria-label={tr.listLabel}>
          {roles.map((r) => {
            const selected = r.id === selectedId && !isNew
            return (
              <button
                key={r.id}
                type="button"
                className={`list-item${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                {...hint('dialogo.papeis.item')}
                onClick={() => select(r)}
              >
                <strong style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span aria-hidden style={dotStyle(r.color)} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                </strong>
                <span className="muted">
                  {r.builtin ? `${tr.builtin} · ` : ''}
                  {preview(r.instructions)}
                </span>
              </button>
            )
          })}
          {isNew && draft && (
            <div className="list-item selected" aria-current="true">
              <strong>{draft.name.trim() || tr.defaultName}</strong>
              <span className="muted">{tr.unsaved}</span>
            </div>
          )}
          <button type="button" className="btn btn-ghost" {...hint('dialogo.papeis.novo')} onClick={startNew}>
            + {tr.newRole}
          </button>
        </div>
        {draft ? (
          <form
            className="split-form"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="form-row">
              <label className="field" style={FIELD_STYLE} {...hint('dialogo.papeis.nome')}>
                <span>{tr.fields.name}</span>
                <input
                  className="input"
                  value={draft.name}
                  maxLength={60}
                  onChange={(e) => patch({ name: e.target.value })}
                />
                <small>{tr.fields.nameHint}</small>
              </label>
              <div className="field" style={FIELD_STYLE} {...hint('dialogo.papeis.cor')}>
                <span id={colorLabelId}>{tr.fields.color}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    className="input mono"
                    value={draft.color}
                    placeholder="#RRGGBB"
                    maxLength={7}
                    spellCheck={false}
                    aria-labelledby={colorLabelId}
                    aria-invalid={colorInvalid}
                    style={{ width: 96, flex: 'none' }}
                    onChange={(e) => patch({ color: e.target.value.trim() })}
                  />
                  <input
                    type="color"
                    {...hint('dialogo.papeis.corSeletor')}
                    aria-label={tr.fields.picker}
                    value={COLOR_RE.test(draft.color) ? draft.color.toLowerCase() : '#6f8fbf'}
                    onChange={(e) => patch({ color: e.target.value.toLowerCase() })}
                    style={{
                      width: 30,
                      height: 30,
                      padding: 2,
                      flex: 'none',
                      border: '1px solid var(--line)',
                      borderRadius: 5,
                      background: 'var(--surface-2)',
                      cursor: 'pointer'
                    }}
                  />
                  <span
                    className="chip chip-role"
                    {...hint('dialogo.papeis.corPrevia')}
                    style={COLOR_RE.test(draft.color) ? ({ '--chip': draft.color } as React.CSSProperties) : undefined}
                  >
                    {draft.name.trim() || tr.defaultName}
                  </span>
                </div>
                <div role="group" aria-label={tr.fields.colorPresets} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button
                    type="button"
                    {...hint('dialogo.papeis.semCor')}
                    aria-label={tr.fields.noColor}
                    aria-pressed={draft.color === ''}
                    style={swatchStyle('', draft.color === '')}
                    onClick={() => patch({ color: '' })}
                  />
                  {SWATCHES.map((c) => {
                    const on = draft.color.toLowerCase() === c
                    return (
                      <button
                        key={c}
                        type="button"
                        {...hintOf({ title: tr.fields.swatch(c) })}
                        aria-label={tr.fields.swatch(c)}
                        aria-pressed={on}
                        style={swatchStyle(c, on)}
                        onClick={() => patch({ color: c })}
                      />
                    )
                  })}
                </div>
                <small className={colorInvalid ? 'warn-text' : undefined}>
                  {colorInvalid ? tr.fields.colorInvalid : tr.fields.colorHint}
                </small>
              </div>
            </div>
            <label className="field" {...hint('dialogo.papeis.instrucoes')}>
              <span>{tr.fields.instructions}</span>
              <textarea
                className="textarea"
                rows={12}
                maxLength={MAX_INSTRUCTIONS}
                value={draft.instructions}
                onChange={(e) => patch({ instructions: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    void save()
                  }
                }}
              />
              <small>
                {tr.fields.instructionsHint} · {tr.fields.count(draft.instructions.length, MAX_INSTRUCTIONS)}
              </small>
            </label>
            <fieldset className="role-defaults">
              <legend>{agentText.roleDefaults}</legend>
              {(['claude', 'codex'] as const).map((family) => (
                <div key={family}>
                  <strong className="role-defaults-family">{agentText.family[family]}</strong>
                  <ModelEffortPair
                    family={family}
                    model={draft.agentDefaults?.[family]?.model ?? ''}
                    effort={draft.agentDefaults?.[family]?.effort ?? ''}
                    onChange={(model, effort) => {
                      const next = { ...(draft.agentDefaults ?? {}) }
                      if (model || effort) next[family] = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
                      else delete next[family]
                      patch({ agentDefaults: Object.keys(next).length > 0 ? next : undefined })
                    }}
                  />
                </div>
              ))}
              <small className="muted">{agentText.roleDefaultsHint}</small>
            </fieldset>
            {affected && affected.roleId === draft.id && (
              <div
                role="status"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  border: '1px solid var(--line)',
                  borderLeft: '3px solid var(--busy)',
                  borderRadius: 6,
                  background: 'var(--surface-2)'
                }}
              >
                <span style={{ flex: 1 }}>{tr.affected(affectedNames)}</span>
                <button type="button" className="btn" {...hint('dialogo.papeis.reiniciar')} onClick={() => void restartAffected()}>
                  {tr.restartAffected(affected.ids.length)}
                </button>
              </div>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              {!isNew && (
                <button type="button" className="btn btn-danger" disabled={busy} {...hint('dialogo.papeis.excluir')} onClick={() => void remove()}>
                  {tr.delete}
                </button>
              )}
              <span className="spacer" />
              <button type="button" className="btn" {...hint('dialogo.papeis.fechar')} onClick={close}>
                {t.common.close}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !dirty} {...hint('dialogo.papeis.salvar')}>
                {tr.save}
              </button>
            </div>
          </form>
        ) : (
          <div className="split-form">
            <p className="muted">{tr.empty}</p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
