import { useEffect, useMemo, useState } from 'react'
import { newId, slugifyName, uniqueName } from '@shared/ids'
import { defaultLook } from '@shared/office'
import { TerminalNameSchema, TerminalNodeSchema, type Look, type TerminalNodeData } from '@shared/schemas'
import { LookEditor } from '../office/LookEditor'
import { TerminalModelFields } from './ModelEffortFields'
import { useApp, type FlowRect } from '../store/appStore'
import { Dialog } from './Dialog'
import { api } from '../lib/api'
import { t } from '../i18n'
import { hint, hintOf } from '../hints/hint'
import { dialogosHintsDinamicos } from '../i18n/hints/dialogos'

const LAST_PRESET_KEY = 'maestrinho:lastPreset'
/** Na grade de duas colunas, um campo com dica longa não estica o controle do vizinho. */
const FIELD_STYLE: React.CSSProperties = { alignContent: 'start' }

function lastPreset(): string | null {
  try {
    return localStorage.getItem(LAST_PRESET_KEY)
  } catch {
    return null
  }
}

/** Seletor de agente ao criar um terminal (nome, papel, gerente e pasta opcionais). */
export function PresetPickerDialog({ rect }: { rect: FlowRect }): React.JSX.Element {
  const config = useApp((s) => s.config)
  const active = useApp((s) => s.active)
  const setDialog = useApp((s) => s.setDialog)
  const applyOps = useApp((s) => s.applyOps)
  const requestFocus = useApp((s) => s.requestFocus)
  const presets = useMemo(() => config?.presets ?? [], [config])
  const roles = useMemo(() => config?.roles ?? [], [config])
  const [availability, setAvailability] = useState<Record<string, boolean>>({})
  const [presetId, setPresetId] = useState(() => {
    const last = lastPreset()
    return presets.find((p) => p.id === last)?.id ?? presets.find((p) => p.id === 'claude')?.id ?? presets[0]?.id ?? 'shell'
  })
  const [roleId, setRoleId] = useState('')
  const [manager, setManager] = useState(false)
  const [cwd, setCwd] = useState('')
  const [host, setHost] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hostError, setHostError] = useState<string | null>(null)
  // Aparência no escritório: o id já existe para o visual padrão bater com o do terminal criado.
  const [tab, setTab] = useState<'agent' | 'look'>('agent')
  const [nodeId] = useState(() => newId('t'))
  const [look, setLook] = useState<Look>(() => defaultLook(nodeId))
  const [lookTouched, setLookTouched] = useState(false)
  // Vazio = segue o padrão da função (ou do agente).
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')

  const takenNames = useMemo(
    () => (active?.doc.nodes ?? []).filter((n) => n.kind === 'terminal').map((n) => (n as TerminalNodeData).name),
    [active]
  )

  useEffect(() => {
    void api.invoke('presets:availability').then(setAvailability).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (nameEdited) return
    const role = roles.find((r) => r.id === roleId)
    const base = slugifyName((role?.name ?? presetId).toLowerCase())
    setName(uniqueName(base, takenNames))
  }, [presetId, roleId, nameEdited, roles, takenNames])

  const selectedPreset = presets.find((p) => p.id === presetId)
  const needsHost = Boolean(selectedPreset?.args.some((a) => a.includes('{host}')))

  const create = (): void => {
    const trimmed = name.trim()
    const remoteHost = host.trim()
    if (needsHost) {
      const hostCheck = TerminalNodeSchema.shape.remoteHost.safeParse(remoteHost)
      if (!remoteHost || !hostCheck.success) {
        setHostError(remoteHost ? t.ssh.hostInvalid : t.ssh.hostRequired)
        return
      }
    }
    const parsed = TerminalNameSchema.safeParse(trimmed)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.presetPicker.invalidName)
      return
    }
    if (takenNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      setError(t.presetPicker.nameTaken)
      return
    }
    const node: TerminalNodeData = {
      id: nodeId,
      look: lookTouched ? look : undefined,
      kind: 'terminal',
      name: trimmed,
      presetId,
      roleId: roleId || undefined,
      manager: manager || undefined,
      cwd: cwd.trim(),
      remoteHost: needsHost ? host.trim() : undefined,
      model: model || undefined,
      effort: effort || undefined,
      autoStart: true,
      position: { x: rect.x, y: rect.y },
      size: { w: rect.w, h: rect.h },
      floorId: active?.doc.activeFloorId
    }
    try {
      localStorage.setItem(LAST_PRESET_KEY, presetId)
    } catch {
      // ignora
    }
    void applyOps([{ op: 'addNodes', nodes: [node] }])
    setDialog({ kind: 'none' })
    setTimeout(() => requestFocus(node.id), 120)
  }

  return (
    <Dialog title={t.presetPicker.title} lead={tab === 'look' ? t.look.note : t.presetPicker.lead} wide={tab === 'look'} onClose={() => setDialog({ kind: 'none' })}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <div className="dialog-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'agent'} {...hint('dialogo.terminal.abaAgente')} onClick={() => setTab('agent')}>
            {t.look.tabAgent}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'look'} {...hint('dialogo.terminal.abaAparencia')} onClick={() => setTab('look')}>
            {t.look.tabLook}
          </button>
        </div>
        {tab === 'agent' ? (
          <>
          <div className="preset-grid" role="radiogroup" aria-label="Agente">
            {presets.map((p) => (
              <button
                type="button"
                key={p.id}
                role="radio"
                aria-checked={p.id === presetId}
                className={`preset-card${p.id === presetId ? ' selected' : ''}`}
                {...hintOf(dialogosHintsDinamicos.cartaoPreset(p.label, p.command, availability[p.id] === false))}
                onClick={() => setPresetId(p.id)}
                onDoubleClick={create}
              >
                <strong>{p.label}</strong>
                <span className="muted">{p.command}</span>
                {availability[p.id] === false && <span className="preset-missing">{t.presetPicker.notFound}</span>}
              </button>
            ))}
          </div>
          <div className="form-row">
            <label className="field" style={FIELD_STYLE} {...hint('dialogo.terminal.nome')}>
              <span>{t.presetPicker.name}</span>
              <input
                className="input"
                value={name}
                maxLength={40}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameEdited(true)
                  setError(null)
                }}
                aria-invalid={Boolean(error)}
              />
              <small>{error ?? t.presetPicker.nameHint}</small>
            </label>
            <label className="field" style={FIELD_STYLE} {...hint('dialogo.terminal.papel')}>
              <span>{t.presetPicker.role}</span>
              <select className="select" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">{t.presetPicker.noRole}</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <TerminalModelFields
            preset={selectedPreset}
            role={roles.find((r) => r.id === roleId)}
            model={model}
            effort={effort}
            onChange={(m, e) => {
              setModel(m)
              setEffort(e)
            }}
          />
          {needsHost && (
            <label className="field" {...hint('dialogo.terminal.ssh')}>
              <span>{t.ssh.host}</span>
              <input
                className="input"
                value={host}
                placeholder={t.ssh.hostPlaceholder}
                spellCheck={false}
                onChange={(e) => {
                  setHost(e.target.value)
                  setHostError(null)
                }}
                aria-invalid={Boolean(hostError)}
              />
              <small role={hostError ? 'alert' : undefined} style={hostError ? { color: 'var(--danger)' } : undefined}>
                {hostError ?? t.ssh.hostHint}
              </small>
            </label>
          )}
          <label className="field" {...hint('dialogo.terminal.pasta')}>
            <span>{t.presetPicker.cwd}</span>
            <input className="input" value={cwd} placeholder="." onChange={(e) => setCwd(e.target.value)} />
            <small>{t.presetPicker.cwdHint}</small>
          </label>
          <label className="check" {...hint('dialogo.terminal.gerente')}>
            <input type="checkbox" checked={manager} onChange={(e) => setManager(e.target.checked)} />
            <span>{t.presetPicker.manager}</span>
          </label>
          </>
        ) : (
          <LookEditor
            value={look}
            seed={nodeId}
            roleColor={roles.find((r) => r.id === roleId)?.color || undefined}
            onChange={(l) => {
              setLook(l)
              setLookTouched(true)
            }}
          />
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" {...hint('dialogo.terminal.cancelarNovo')} onClick={() => setDialog({ kind: 'none' })}>
            {t.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" {...hint('dialogo.terminal.criar')}>
            {t.presetPicker.create}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
