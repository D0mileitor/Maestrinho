import { useState } from 'react'
import type { Settings } from '@shared/schemas'
import { useApp } from '../store/appStore'
import { Dialog } from './Dialog'
import { UiFontField } from './UiFontField'
import { api, errorMessage } from '../lib/api'
import { SHORTCUT_HELP } from '../i18n/shortcuts'
import { OfficeReactionsSchema, OfficeSceneIdSchema } from '@shared/schemas'
import { RELEASES_URL } from '@shared/constants'
import { UI_FONT_SIZE_MAX, UI_FONT_SIZE_MIN } from '@shared/uiFont'
import { settingsText as S } from '../i18n/settings'
import { usageText as UT } from '../i18n/usage'
import { t } from '../i18n'
import { hint, hintOf } from '../hints/hint'

/** Preferências globais (tema, terminal, notificações, canvas, assistente de resumo). */
export function SettingsDialog(): React.JSX.Element | null {
  const config = useApp((s) => s.config)
  const info = useApp((s) => s.info)
  const setDialog = useApp((s) => s.setDialog)
  const toast = useApp((s) => s.toast)
  const [draft, setDraft] = useState<Settings | null>(config ? structuredClone(config.settings) : null)
  const [tab, setTab] = useState<'geral' | 'terminal' | 'resumo' | 'atalhos' | 'sobre'>('geral')
  if (!draft) return null

  const patch = (p: Partial<Settings>): void => setDraft({ ...draft, ...p })

  const save = async (): Promise<void> => {
    try {
      // A lista de workspaces muda por fora enquanto o diálogo está aberto: não regrava a cópia antiga.
      const patch: Partial<Settings> = { ...draft }
      delete patch.recentWorkspaces
      delete patch.lastWorkspace
      await api.invoke('config:setSettings', patch)
      setDialog({ kind: 'none' })
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  const remoteSummary = draft.summaryEnabled && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(draft.summaryEndpoint + '/')

  return (
    <Dialog title="Configurações" wide className="settings-dialog" onClose={() => setDialog({ kind: 'none' })}>
      <div className="tabs" role="tablist">
        {(
          [
            ['geral', 'Geral'],
            ['terminal', 'Terminal'],
            ['resumo', 'Assistente de resumo'],
            ['atalhos', 'Atalhos'],
            ['sobre', 'Sobre e segurança']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab${tab === id ? ' active' : ''}`}
            {...hint(`dialogo.config.aba.${id}`)}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'geral' && (
        <div className="tab-body settings-columns">
          <div>
            <section className="settings-group">
              <h4>{S.groups.appearance}</h4>
              <div className="form-row settings-pair">
                <label className="field" {...hint('dialogo.config.tema')}>
                  <span>Tema</span>
                  <select className="select" value={draft.theme} onChange={(e) => patch({ theme: e.target.value as Settings['theme'] })}>
                    <option value="dark">Escuro</option>
                    <option value="light">Claro</option>
                    <option value="system">Acompanhar o sistema</option>
                  </select>
                </label>
                <label className="field" {...hint('dialogo.config.cenario')}>
                  <span>{t.office.sceneSetting}</span>
                  <select className="select" value={draft.officeScene} onChange={(e) => patch({ officeScene: OfficeSceneIdSchema.parse(e.target.value) })}>
                    {OfficeSceneIdSchema.options.map((id) => (
                      <option key={id} value={id}>
                        {t.office.scenes[id]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-row settings-pair">
                <UiFontField value={draft.uiFontFamily} onChange={(uiFontFamily) => patch({ uiFontFamily })} />
                <label className="field" {...hint('dialogo.config.tamanhoInterface')}>
                  <span>{S.uiFontSize}</span>
                  <input
                    className="input"
                    type="number"
                    min={UI_FONT_SIZE_MIN}
                    max={UI_FONT_SIZE_MAX}
                    value={draft.uiFontSize}
                    onChange={(e) => patch({ uiFontSize: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label className="check" {...hint('dialogo.config.grade')}>
                <input type="checkbox" checked={draft.showGrid} onChange={(e) => patch({ showGrid: e.target.checked })} />
                <span>Mostrar as pautas (grade) no canvas</span>
              </label>
              <label className="check" {...hint('dialogo.config.minimapa')}>
                <input type="checkbox" checked={draft.showMinimap} onChange={(e) => patch({ showMinimap: e.target.checked })} />
                <span>Mostrar minimapa ao abrir</span>
              </label>
            </section>
            <section className="settings-group">
              <h4>{S.groups.notices}</h4>
              <label className="check" {...hint('dialogo.config.avisar')}>
                <input type="checkbox" checked={draft.notifyOnIdle} onChange={(e) => patch({ notifyOnIdle: e.target.checked })} />
                <span>{S.notifyOnIdle}</span>
              </label>
              <label className="check" {...hint('dialogo.config.soForaDeFoco')}>
                <input
                  type="checkbox"
                  checked={draft.notifyOnlyWhenUnfocused}
                  disabled={!draft.notifyOnIdle}
                  onChange={(e) => patch({ notifyOnlyWhenUnfocused: e.target.checked })}
                />
                <span>{S.notifyUnfocused}</span>
              </label>
              <div className="field" {...hint('dialogo.config.estiloAviso')}>
                <span>{t.buddy.style}</span>
                <div className="settings-inline">
                  <select
                    className="select"
                    aria-label={t.buddy.style}
                    value={draft.notifyStyle}
                    disabled={!draft.notifyOnIdle}
                    onChange={(e) => patch({ notifyStyle: e.target.value as Settings['notifyStyle'] })}
                  >
                    {(['personagem', 'sistema', 'ambos'] as const).map((s) => (
                      <option key={s} value={s}>
                        {t.buddy.styles[s]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn" {...hint('dialogo.config.testarAviso')} onClick={() => void api.invoke('buddy:test').catch(() => undefined)}>
                    {t.buddy.test}
                  </button>
                </div>
              </div>
            </section>
          </div>
          <section className="settings-group">
            <h4>{S.groups.agents}</h4>
            <label className="check" {...hint('dialogo.config.retomar')}>
              <input type="checkbox" checked={draft.resumeSessions} onChange={(e) => patch({ resumeSessions: e.target.checked })} />
              <span>{S.resumeSessions}</span>
            </label>
            <label className="check" {...hint('dialogo.config.estadoExato')}>
              <input type="checkbox" checked={draft.exactAgentState} onChange={(e) => patch({ exactAgentState: e.target.checked })} />
              <span>{t.agentState.setting}</span>
            </label>
            <label className="field" {...hint('dialogo.config.hibernar')}>
              <span>{t.hibernate.setting}</span>
              <select className="select" value={draft.hibernateAfterMin} onChange={(e) => patch({ hibernateAfterMin: Number(e.target.value) })}>
                {[0, 15, 30, 60, 120, 240, 480].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? t.hibernate.never : t.hibernate.minutes(n)}
                  </option>
                ))}
              </select>
            </label>
            <label className="check" {...hint('dialogo.config.checkpoints')}>
              <input type="checkbox" checked={draft.checkpoints} onChange={(e) => patch({ checkpoints: e.target.checked })} />
              <span>{S.checkpoints}</span>
            </label>
            <div className="form-row settings-pair even">
              <label className="field" {...hint('dialogo.config.usoAviso')}>
                <span>{UT.alertSetting}</span>
                <select className="select" value={draft.usageAlertPercent} onChange={(e) => patch({ usageAlertPercent: Number(e.target.value) })}>
                  {[0, 50, 70, 80, 90, 95].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? UT.never : UT.percentOption(n)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" {...hint('dialogo.config.usoPausa')}>
                <span>{UT.pauseSetting}</span>
                <select className="select" value={draft.usagePausePercent} onChange={(e) => patch({ usagePausePercent: Number(e.target.value) })}>
                  {[0, 80, 90, 95, 98].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? UT.never : UT.percentOption(n)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field" {...hint('dialogo.config.reacoes')}>
              <span>{t.office.reactionsSetting}</span>
              <select
                className="select"
                value={draft.officeReactions}
                onChange={(e) => patch({ officeReactions: OfficeReactionsSchema.parse(e.target.value) })}
              >
                {OfficeReactionsSchema.options.map((id) => (
                  <option key={id} value={id}>
                    {t.office.reactions[id]}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </div>
      )}

      {tab === 'terminal' && (
        <div className="tab-body">
          <label className="field" {...hint('dialogo.config.fonte')}>
            <span>{S.terminalFont}</span>
            <input className="input" value={draft.terminalFontFamily} onChange={(e) => patch({ terminalFontFamily: e.target.value })} />
          </label>
          <div className="form-row">
            <label className="field" {...hint('dialogo.config.tamanhoFonte')}>
              <span>{S.terminalFontSize}</span>
              <input
                className="input"
                type="number"
                min={8}
                max={32}
                value={draft.terminalFontSize}
                onChange={(e) => patch({ terminalFontSize: Number(e.target.value) })}
              />
            </label>
            <label className="field" {...hint('dialogo.config.scrollback')}>
              <span>Linhas de histórico (scrollback)</span>
              <input
                className="input"
                type="number"
                min={500}
                max={100000}
                value={draft.scrollback}
                onChange={(e) => patch({ scrollback: Number(e.target.value) })}
              />
            </label>
          </div>
        </div>
      )}

      {tab === 'resumo' && (
        <div className="tab-body">
          <p className="lead">
            Opcional e desligado por padrão. Quando um agente termina, as últimas linhas da saída dele são enviadas para um modelo compatível com a API da
            OpenAI que você controla (por exemplo Ollama ou LM Studio rodando nesta máquina).
          </p>
          <label className="check" {...hint('dialogo.config.resumoAtivo')}>
            <input type="checkbox" checked={draft.summaryEnabled} onChange={(e) => patch({ summaryEnabled: e.target.checked })} />
            <span>Ativar resumo automático</span>
          </label>
          <label className="field" {...hint('dialogo.config.resumoEndpoint')}>
            <span>Endpoint (base da API)</span>
            <input className="input" value={draft.summaryEndpoint} onChange={(e) => patch({ summaryEndpoint: e.target.value })} />
            {remoteSummary && <small className="warn-text">Atenção: este endereço não é local. A saída dos terminais sairá desta máquina.</small>}
          </label>
          <div className="form-row">
            <label className="field" {...hint('dialogo.config.resumoModelo')}>
              <span>Modelo</span>
              <input className="input" value={draft.summaryModel} placeholder="ex.: llama3.1:8b" onChange={(e) => patch({ summaryModel: e.target.value })} />
            </label>
            <label className="field" {...hint('dialogo.config.resumoChave')}>
              <span>Chave (opcional)</span>
              <input className="input" type="password" value={draft.summaryApiKey} onChange={(e) => patch({ summaryApiKey: e.target.value })} />
            </label>
          </div>
        </div>
      )}

      {tab === 'atalhos' && (
        <div className="tab-body">
          <ul className="shortcut-list">
            {SHORTCUT_HELP.map((s) => (
              <li key={s.label} {...hintOf({ title: s.label, ...(s.detail ? { body: s.detail } : {}), keys: s.hintKeys ?? [s.keys] })}>
                <span className="kbd">{s.keys}</span>
                <span>{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'sobre' && info && (
        <div className="tab-body about">
          <section className="settings-group">
            <h4>{S.versions}</h4>
            <p>{S.current(info.version)}</p>
            <div className="inline">
              <button type="button" className="btn" {...hint('dialogo.config.versoes')} onClick={() => void api.invoke('app:openExternal', { url: RELEASES_URL })}>
                {S.openReleases}
              </button>
            </div>
          </section>
          <p>
            <strong>{info.appName}</strong> {info.version}, Electron {info.electron} (Chromium {info.chrome}, Node {info.node}).
          </p>
          <ul>
            <li>{S.privacy}</li>
            <li>
              A API usada pelo CLI <code>{info.cliName}</code> escuta só em 127.0.0.1 (porta {info.apiPort || 'aleatória'}), com token exclusivo por terminal, e
              toda ação é validada contra as conexões do canvas.
            </li>
            <li>Os logs do app não registram conteúdo de terminais nem de mensagens.</li>
            <li>Dados do app: {info.userDataDir}</li>
          </ul>
        </div>
      )}

      <div className="dialog-actions">
        <button className="btn" {...hint('dialogo.config.cancelar')} onClick={() => setDialog({ kind: 'none' })}>
          Cancelar
        </button>
        <button className="btn btn-primary" {...hint('dialogo.config.salvar')} onClick={() => void save()}>
          Salvar
        </button>
      </div>
    </Dialog>
  )
}
