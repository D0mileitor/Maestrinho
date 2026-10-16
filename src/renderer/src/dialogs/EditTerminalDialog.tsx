import { useEffect, useMemo, useRef, useState } from 'react'
import { TerminalNameSchema, TerminalNodeSchema, type Look, type TerminalNodeData } from '@shared/schemas'
import { defaultLook } from '@shared/office'
import { LookEditor } from '../office/LookEditor'
import { TerminalModelFields } from './ModelEffortFields'
import { useApp } from '../store/appStore'
import { Dialog } from './Dialog'
import { api, errorMessage } from '../lib/api'
import { t } from '../i18n'
import { editTerminalText as te } from '../i18n/roles'
import { hint } from '../hints/hint'

/** Campos que só valem quando o processo reinicia (o nome vale na hora). */
const RESTART_FIELDS = ['presetId', 'roleId', 'manager', 'cwd', 'remoteHost', 'model', 'effort'] as const
/** Na grade de duas colunas, campo sem dica não estica o controle até a altura do vizinho. */
const FIELD_STYLE: React.CSSProperties = { alignContent: 'start' }

/** Edição de um terminal: nome, agente (preset), papel, modo gerente e diretório de trabalho. */
export function EditTerminalDialog({ id, initialTab }: { id: string; initialTab?: 'look' }): React.JSX.Element {
  const node = useApp((s) => {
    const n = s.active?.doc.nodes.find((x) => x.id === id)
    return n && n.kind === 'terminal' ? n : undefined
  })
  const nodes = useApp((s) => s.active?.doc.nodes)
  const config = useApp((s) => s.config)
  const status = useApp((s) => s.runtime[id]?.status)
  const setDialog = useApp((s) => s.setDialog)
  const presets = useMemo(() => config?.presets ?? [], [config])
  const roles = useMemo(() => config?.roles ?? [], [config])
  const [name, setName] = useState(node?.name ?? '')
  const [presetId, setPresetId] = useState(node?.presetId ?? '')
  const [roleId, setRoleId] = useState(node?.roleId ?? '')
  const [manager, setManager] = useState(Boolean(node?.manager))
  const [cwd, setCwd] = useState(node?.cwd ?? '')
  const [host, setHost] = useState(node?.remoteHost ?? '')
  const [model, setModel] = useState(node?.model ?? '')
  const [effort, setEffort] = useState(node?.effort ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'edit' | 'restart'>('edit')
  const [tab, setTab] = useState<'terminal' | 'look'>(initialTab === 'look' ? 'look' : 'terminal')
  const [look, setLook] = useState<Look>(() => node?.look ?? defaultLook(id))
  const [lookTouched, setLookTouched] = useState(false)
  const [availability, setAvailability] = useState<Record<string, boolean>>({})
  const restartRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void api
      .invoke('presets:availability')
      .then(setAvailability)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (phase === 'restart') restartRef.current?.focus()
  }, [phase])

  const close = (): void => setDialog({ kind: 'none' })

  if (!node) {
    return (
      <Dialog title={te.titleMissing} onClose={close}>
        <p className="lead">{te.missing}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" {...hint('dialogo.comum.fechar')} onClick={close}>
            {t.common.close}
          </button>
        </div>
      </Dialog>
    )
  }

  const usesHost = presets.find((p) => p.id === presetId)?.args.some((a) => a.includes('{host}')) ?? false

  const validateName = (v: string): string | null => {
    const parsed = TerminalNameSchema.safeParse(v)
    if (!parsed.success) return parsed.error.issues[0]?.message ?? te.errors.invalidName
    const taken = (nodes ?? []).some(
      (n) => n.kind === 'terminal' && n.id !== id && n.name.toLowerCase() === v.toLowerCase()
    )
    return taken ? te.errors.nameTaken : null
  }

  const save = async (): Promise<void> => {
    if (busy) return
    const trimmed = name.trim()
    const nameError = validateName(trimmed)
    if (nameError) {
      setError(nameError)
      return
    }
    const patch: Partial<TerminalNodeData> = {}
    if (trimmed !== node.name) patch.name = trimmed
    if (presetId !== node.presetId) patch.presetId = presetId
    // Sem papel = chave com undefined (a aplicação do patch remove o campo).
    const nextRole = roleId === '' ? undefined : roleId
    if (nextRole !== node.roleId) patch.roleId = nextRole
    if (manager !== Boolean(node.manager)) patch.manager = manager
    const nextCwd = cwd.trim()
    if (nextCwd !== node.cwd) patch.cwd = nextCwd
    if (usesHost) {
      const nextHost = host.trim()
      if (!nextHost || !TerminalNodeSchema.shape.remoteHost.safeParse(nextHost).success) {
        setError(nextHost ? t.ssh.hostInvalid : t.ssh.hostRequired)
        return
      }
      if (nextHost !== (node.remoteHost ?? '')) patch.remoteHost = nextHost
    }
    if (model !== (node.model ?? '')) patch.model = model || undefined
    if (effort !== (node.effort ?? '')) patch.effort = effort || undefined
    if (lookTouched && JSON.stringify(look) !== JSON.stringify(node.look ?? null)) patch.look = look
    if (Object.keys(patch).length === 0) {
      close()
      return
    }
    // applyWorkspaceOps descarta em silêncio um patch que deixe o nó inválido: valida antes.
    const merged = TerminalNodeSchema.safeParse({ ...node, ...patch })
    if (!merged.success) {
      const issue = merged.error.issues[0]
      setError(te.errors.invalid(issue?.path.join('.') ?? '', issue?.message ?? te.errors.invalidValue))
      return
    }
    setBusy(true)
    try {
      await useApp.getState().applyOps([{ op: 'updateNode', id, patch }])
    } finally {
      setBusy(false)
    }
    const needsRestart = RESTART_FIELDS.some((k) => k in patch)
    if (needsRestart && (status === 'running' || status === 'starting')) setPhase('restart')
    else close()
  }

  const restartNow = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.invoke('pty:restart', { id })
      close()
    } catch (err) {
      setBusy(false)
      setError(errorMessage(err))
    }
  }

  if (phase === 'restart') {
    return (
      <Dialog title={te.restartTitle} onClose={close}>
        <p className="lead">{te.restartBody(node.name)}</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" {...hint('dialogo.terminal.depois')} onClick={close}>
            {te.later}
          </button>
          <button
            ref={restartRef}
            type="button"
            className="btn btn-primary"
            disabled={busy}
            {...hint('dialogo.terminal.reiniciar')}
            onClick={() => void restartNow()}
          >
            {te.restartNow}
          </button>
        </div>
      </Dialog>
    )
  }

  const presetKnown = presets.some((p) => p.id === presetId)
  const roleKnown = roleId === '' || roles.some((r) => r.id === roleId)

  return (
    <Dialog title={te.title(node.name)} lead={tab === 'look' ? t.look.note : te.lead} wide={tab === 'look'} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="dialog-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'terminal'} {...hint('dialogo.terminal.abaTerminal')} onClick={() => setTab('terminal')}>
            {t.look.tabTerminal}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'look'} {...hint('dialogo.terminal.abaAparencia')} onClick={() => setTab('look')}>
            {t.look.tabLook}
          </button>
        </div>
        {tab === 'look' && (
          <LookEditor
            value={look}
            seed={id}
            roleColor={roles.find((r) => r.id === roleId)?.color || undefined}
            onChange={(l) => {
              setLook(l)
              setLookTouched(true)
            }}
          />
        )}
        <div hidden={tab === 'look'}>
        <div className="form-row">
          <label className="field" style={FIELD_STYLE} {...hint('dialogo.terminal.nome')}>
            <span>{te.fields.name}</span>
            <input
              className="input"
              value={name}
              maxLength={40}
              spellCheck={false}
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
            />
            <small>{te.fields.nameHint}</small>
          </label>
          <label className="field" style={FIELD_STYLE} {...hint('dialogo.terminal.agente')}>
            <span>{te.fields.preset}</span>
            <select className="select" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {availability[p.id] === false ? te.fields.notFound : ''}
                </option>
              ))}
              {!presetKnown && <option value={presetId}>{te.fields.missingPreset(presetId)}</option>}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label className="field" style={FIELD_STYLE} {...hint('dialogo.terminal.papel')}>
            <span>{te.fields.role}</span>
            <select className="select" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">{te.fields.noRole}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              {!roleKnown && <option value={roleId}>{te.fields.deletedRole}</option>}
            </select>
          </label>
          <label className="field" style={FIELD_STYLE} {...hint('dialogo.terminal.pasta')}>
            <span>{te.fields.cwd}</span>
            <input
              className="input"
              value={cwd}
              placeholder="."
              spellCheck={false}
              onChange={(e) => {
                setCwd(e.target.value)
                setError(null)
              }}
            />
            <small>{te.fields.cwdHint}</small>
          </label>
        </div>
        <TerminalModelFields
          preset={presets.find((p) => p.id === presetId)}
          role={roles.find((r) => r.id === roleId)}
          model={model}
          effort={effort}
          onChange={(m, e) => {
            setModel(m)
            setEffort(e)
            setError(null)
          }}
        />
        {usesHost && (
          <label className="field" {...hint('dialogo.terminal.ssh')}>
            <span>{t.ssh.host}</span>
            <input
              className="input"
              value={host}
              placeholder={t.ssh.hostPlaceholder}
              spellCheck={false}
              onChange={(e) => {
                setHost(e.target.value)
                setError(null)
              }}
            />
          </label>
        )}
        <label className="check" {...hint('dialogo.terminal.gerente')}>
          <input type="checkbox" checked={manager} onChange={(e) => setManager(e.target.checked)} />
          <span>{te.fields.manager}</span>
        </label>
        <p className="muted" style={{ margin: '10px 0 0' }}>
          {te.applyNote}
        </p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" {...hint('dialogo.terminal.cancelarEdicao')} onClick={close}>
            {t.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} {...hint('dialogo.terminal.salvar')}>
            {t.common.save}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
