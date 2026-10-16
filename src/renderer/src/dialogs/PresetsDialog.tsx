import { useState } from 'react'
import { newId } from '@shared/ids'
import { AgentPresetSchema, type AgentPreset, type InstructionsTarget } from '@shared/schemas'
import { useApp } from '../store/appStore'
import { Dialog } from './Dialog'
import { api, errorMessage } from '../lib/api'
import { t } from '../i18n'
import { hint } from '../hints/hint'

const TARGETS: InstructionsTarget[] = ['claude-system-prompt', 'claude-skill', 'agents-md', 'first-message', 'none']
const NL = String.fromCharCode(10)

function splitLines(text: string): string[] {
  return text.replace(/\r/g, '').split(NL)
}

function blankPreset(): AgentPreset {
  return AgentPresetSchema.parse({ id: newId('p').toLowerCase(), label: 'Novo agente', command: 'meu-agente' })
}

/** Editor de presets de agentes (como cada agente é iniciado e recebe mensagens). */
export function PresetsDialog(): React.JSX.Element {
  const config = useApp((s) => s.config)
  const setDialog = useApp((s) => s.setDialog)
  const toast = useApp((s) => s.toast)
  const presets = config?.presets ?? []
  const [selectedId, setSelectedId] = useState(presets[0]?.id ?? '')
  const [draft, setDraft] = useState<AgentPreset | null>(presets[0] ? structuredClone(presets[0]) : null)
  const [isNew, setIsNew] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Campos de várias linhas são editados como texto e convertidos ao salvar.
  const [argsText, setArgsText] = useState(presets[0]?.args.join(NL) ?? '')
  const [patternsText, setPatternsText] = useState(presets[0]?.idlePatterns.join(NL) ?? '')

  const select = (p: AgentPreset): void => {
    setSelectedId(p.id)
    setDraft(structuredClone(p))
    setArgsText(p.args.join(NL))
    setPatternsText(p.idlePatterns.join(NL))
    setIsNew(false)
    setError(null)
  }

  const patch = (p: Partial<AgentPreset>): void => setDraft((d) => (d ? { ...d, ...p } : d))

  const save = async (): Promise<void> => {
    if (!draft) return
    const candidate: AgentPreset = {
      ...draft,
      args: splitLines(argsText).filter((l) => l !== ''),
      idlePatterns: splitLines(patternsText).filter((l) => l.trim() !== '')
    }
    const parsed = AgentPresetSchema.safeParse(candidate)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      setError(`${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'inválido'}`)
      return
    }
    for (const re of parsed.data.idlePatterns) {
      try {
        new RegExp(re, 'u')
      } catch {
        setError(`padrão inválido: ${re}`)
        return
      }
    }
    try {
      await api.invoke('config:savePreset', parsed.data)
      setSelectedId(parsed.data.id)
      setIsNew(false)
      setError(null)
      toast('info', `Preset "${parsed.data.label}" salvo. Vale para terminais novos ou reiniciados.`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const remove = async (): Promise<void> => {
    if (!draft || isNew) return
    try {
      const list = await api.invoke('config:deletePreset', { id: draft.id })
      if (list[0]) select(list[0])
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const reset = async (): Promise<void> => {
    if (!window.confirm(t.presets.confirmReset)) return
    const list = await api.invoke('config:resetPresets')
    const cur = list.find((p) => p.id === selectedId) ?? list[0]
    if (cur) select(cur)
  }

  return (
    <Dialog title={t.presets.title} lead={t.presets.lead} wide onClose={() => setDialog({ kind: 'none' })}>
      <div className="split">
        <div className="split-list">
          {presets.map((p) => (
            <button
              key={p.id}
              className={`list-item${p.id === selectedId && !isNew ? ' selected' : ''}`}
              {...hint('dialogo.presets.item')}
              onClick={() => select(p)}
            >
              <strong>{p.label}</strong>
              <span className="muted">{p.command}</span>
            </button>
          ))}
          <button
            className="btn btn-ghost"
            {...hint('dialogo.presets.novo')}
            onClick={() => {
              const p = blankPreset()
              setDraft(p)
              setArgsText('')
              setPatternsText('')
              setSelectedId(p.id)
              setIsNew(true)
              setError(null)
            }}
          >
            + {t.presets.new}
          </button>
          <button className="btn btn-ghost" {...hint('dialogo.presets.restaurar')} onClick={() => void reset()}>
            {t.presets.reset}
          </button>
        </div>
        {draft && (
          <form
            className="split-form"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="form-row">
              <label className="field" {...hint('dialogo.presets.nome')}>
                <span>{t.presets.fields.label}</span>
                <input className="input" value={draft.label} onChange={(e) => patch({ label: e.target.value })} />
              </label>
              <label className="field" {...hint('dialogo.presets.id')}>
                <span>{t.presets.fields.id}</span>
                <input
                  className="input"
                  value={draft.id}
                  disabled={!isNew}
                  onChange={(e) => patch({ id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                />
              </label>
            </div>
            <label className="field" {...hint('dialogo.presets.comando')}>
              <span>{t.presets.fields.command}</span>
              <input className="input" value={draft.command} onChange={(e) => patch({ command: e.target.value })} />
            </label>
            <label className="field" {...hint('dialogo.presets.args')}>
              <span>{t.presets.fields.args}</span>
              <textarea
                className="textarea mono"
                rows={4}
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
              />
              <small>{t.presets.fields.argsHint}</small>
            </label>
            <div className="form-row">
              <label className="field" {...hint('dialogo.presets.entrega')}>
                <span>{t.presets.fields.inputMode}</span>
                <select
                  className="select"
                  value={draft.inputMode}
                  onChange={(e) => patch({ inputMode: e.target.value as AgentPreset['inputMode'] })}
                >
                  <option value="bracketed">{t.presets.fields.inputBracketed}</option>
                  <option value="raw">{t.presets.fields.inputRaw}</option>
                </select>
              </label>
              <label className="field" {...hint('dialogo.presets.instrucoes')}>
                <span>{t.presets.fields.instructions}</span>
                <select
                  className="select"
                  value={draft.instructionsTarget}
                  onChange={(e) => patch({ instructionsTarget: e.target.value as InstructionsTarget })}
                >
                  {TARGETS.map((tg) => (
                    <option key={tg} value={tg}>
                      {t.presets.targets[tg]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label className="field" {...hint('dialogo.presets.atrasoEnter')}>
                <span>{t.presets.fields.submitDelay}</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={10000}
                  value={draft.submitDelayMs}
                  onChange={(e) => patch({ submitDelayMs: Number(e.target.value) })}
                />
              </label>
              <label className="field" {...hint('dialogo.presets.ocioso')}>
                <span>{t.presets.fields.idleMs}</span>
                <input
                  className="input"
                  type="number"
                  min={250}
                  max={600000}
                  value={draft.idleMs}
                  onChange={(e) => patch({ idleMs: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="field" {...hint('dialogo.presets.padroes')}>
              <span>{t.presets.fields.idlePatterns}</span>
              <textarea
                className="textarea mono"
                rows={2}
                value={patternsText}
                onChange={(e) => setPatternsText(e.target.value)}
              />
            </label>
            <label className="field" {...hint('dialogo.presets.modelo')}>
              <span>{t.presets.fields.template}</span>
              <textarea
                className="textarea mono"
                rows={2}
                value={draft.messageTemplate}
                onChange={(e) => patch({ messageTemplate: e.target.value })}
              />
              <small>{t.presets.fields.templateHint}</small>
            </label>
            <label className="check" {...hint('dialogo.presets.shell')}>
              <input type="checkbox" checked={draft.isShell} onChange={(e) => patch({ isShell: e.target.checked })} />
              <span>{t.presets.fields.isShell}</span>
            </label>
            <details className="advanced">
              <summary {...hint('dialogo.presets.avancado')}>Retomada de sessão (avançado)</summary>
              <div className="form-row">
                <label className="field" {...hint('dialogo.presets.argsSessao')}>
                  <span>Argumentos para sessão nova</span>
                  <input
                    className="input mono"
                    value={draft.sessionArgs.join(' ')}
                    placeholder="--session-id {sessionId}"
                    onChange={(e) => patch({ sessionArgs: e.target.value.split(' ').filter(Boolean) })}
                  />
                </label>
                <label className="field" {...hint('dialogo.presets.argsRetomar')}>
                  <span>Argumentos para retomar</span>
                  <input
                    className="input mono"
                    value={draft.resumeArgs.join(' ')}
                    placeholder="--resume {sessionId}"
                    onChange={(e) => patch({ resumeArgs: e.target.value.split(' ').filter(Boolean) })}
                  />
                </label>
              </div>
              <label className="field" {...hint('dialogo.presets.sessaoOnde')}>
                <span>Onde verificar se a sessão existe</span>
                <select
                  className="select"
                  value={draft.sessionStore}
                  onChange={(e) => patch({ sessionStore: e.target.value as AgentPreset['sessionStore'] })}
                >
                  <option value="none">Não verificar (sempre inicia sessão nova)</option>
                  <option value="claude">Sessões do Claude Code (~/.claude/projects)</option>
                  <option value="codex">Sessões do Codex (~/.codex/sessions)</option>
                </select>
                <small>Use {'{sessionId}'} nos argumentos. Cada terminal guarda o próprio id de sessão.</small>
              </label>
              <label className="field" {...hint('dialogo.presets.eventos')}>
                <span>{t.agentState.presetField}</span>
                <select
                  className="select"
                  value={draft.agentEvents ?? 'none'}
                  onChange={(e) => patch({ agentEvents: e.target.value as NonNullable<AgentPreset['agentEvents']> })}
                >
                  {(['none', 'claude', 'codex'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t.agentState.presetOptions[k]}
                    </option>
                  ))}
                </select>
                <small>{t.agentState.presetHint}</small>
              </label>
            </details>
            {error && <p className="form-error">{error}</p>}
            <div className="dialog-actions">
              {!isNew && (
                <button type="button" className="btn btn-danger" {...hint('dialogo.presets.excluir')} onClick={() => void remove()}>
                  {t.presets.delete}
                </button>
              )}
              <span className="spacer" />
              <button type="button" className="btn" {...hint('dialogo.presets.fechar')} onClick={() => setDialog({ kind: 'none' })}>
                {t.common.close}
              </button>
              <button type="submit" className="btn btn-primary" {...hint('dialogo.presets.salvar')}>
                {t.presets.save}
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  )
}
