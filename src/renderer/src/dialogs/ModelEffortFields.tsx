import { useEffect, useId, useState } from 'react'
import { agentFamily, effectiveModelEffort, type AgentFamily } from '@shared/agentModels'
import type { AgentCatalog } from '@shared/ipc'
import type { AgentPreset, Role } from '@shared/schemas'
import { api } from '../lib/api'
import { agentText as A } from '../i18n/agents'
import { hint } from '../hints/hint'

let catalogPromise: Promise<AgentCatalog | null> | null = null

/** Modelos e esforços (carregados uma vez por sessão da janela). */
export function useAgentCatalog(): AgentCatalog | null {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null)
  useEffect(() => {
    catalogPromise ??= api.invoke('agents:catalog').catch(() => null)
    let alive = true
    void catalogPromise.then((c) => alive && setCatalog(c))
    return () => {
      alive = false
    }
  }, [])
  return catalog
}

interface Props {
  family: AgentFamily
  model: string
  effort: string
  onChange: (model: string, effort: string) => void
  /** Padrão que vale com o campo vazio (da função), para mostrar no lugar do vazio. */
  fallback?: { model: string | null; effort: string | null }
  /** Rótulo do vazio quando não há padrão da função. */
  emptyLabel?: string
}

/** Campos de modelo (com sugestões) e esforço para um tipo de agente. */
export function ModelEffortPair({ family, model, effort, onChange, fallback, emptyLabel = A.agentDefault }: Props): React.JSX.Element {
  const catalog = useAgentCatalog()
  const listId = useId()
  const info = catalog?.[family]
  const chosen = info?.models.find((m) => m.id === (model || fallback?.model || ''))
  const efforts = chosen && chosen.efforts.length > 0 ? chosen.efforts : (info?.efforts ?? [])
  const emptyEffort = fallback?.effort ? A.fromRole(A.effortLabel(fallback.effort)) : emptyLabel
  return (
    <div className="form-row">
      <label className="field" style={{ alignContent: 'start' }} {...hint('dialogo.modelo.modelo')}>
        <span>{A.model}</span>
        <input
          className="input"
          list={listId}
          value={model}
          maxLength={100}
          spellCheck={false}
          placeholder={fallback?.model ? A.fromRole(fallback.model) : A.modelPlaceholder}
          onChange={(e) => onChange(e.target.value.trim(), effort)}
        />
        <datalist id={listId}>
          {info?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label !== m.id ? m.label : ''}
            </option>
          ))}
        </datalist>
      </label>
      <label className="field" style={{ alignContent: 'start' }} {...hint('dialogo.modelo.esforco')}>
        <span>{A.effort}</span>
        <select className="select" value={effort} onChange={(e) => onChange(model, e.target.value)}>
          <option value="">{emptyEffort}</option>
          {efforts.map((e) => (
            <option key={e} value={e}>
              {A.effortLabel(e)}
            </option>
          ))}
          {effort && !efforts.includes(effort) && <option value={effort}>{effort}</option>}
        </select>
      </label>
    </div>
  )
}

/**
 * Modelo e esforço de um terminal: só aparece para presets que aceitam escolher (Claude Code, Codex). O
 * vazio segue a função; a dica mostra o que vale.
 */
export function TerminalModelFields({
  preset,
  role,
  model,
  effort,
  onChange
}: {
  preset: AgentPreset | undefined
  role: Role | undefined
  model: string
  effort: string
  onChange: (model: string, effort: string) => void
}): React.JSX.Element | null {
  const family = preset ? agentFamily(preset) : null
  if (!preset || !family || (!preset.modelArgs?.length && !preset.effortArgs?.length)) return null
  const roleOnly = effectiveModelEffort({}, role, family)
  return (
    <>
      <ModelEffortPair family={family} model={model} effort={effort} onChange={onChange} fallback={{ model: roleOnly.model, effort: roleOnly.effort }} />
      <small className="muted" style={{ display: 'block', marginTop: -4 }}>
        {A.hint}
      </small>
    </>
  )
}
