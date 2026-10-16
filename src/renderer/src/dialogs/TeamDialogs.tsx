import { useState } from 'react'
import type { TeamPreview } from '@shared/team'
import { useApp } from '../store/appStore'
import { canvasBridge, snap } from '../canvas/bridge'
import { Dialog } from './Dialog'
import { api, errorMessage } from '../lib/api'
import { IconExport, IconImport } from '../lib/icons'
import { teamText as T } from '../i18n/team'
import { describeReport } from './PartiturasDialog'
import { hint } from '../hints/hint'

/** Seção "Time completo" do diálogo de partituras: exportar o canvas inteiro ou importar um time. */
export function TeamSection({ dir, defaultName }: { dir: string; defaultName: string }): React.JSX.Element {
  const toast = useApp((s) => s.toast)
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState('')
  const [includeNotes, setIncludeNotes] = useState(true)
  const [busy, setBusy] = useState(false)

  const exportTeam = async (): Promise<void> => {
    setBusy(true)
    try {
      const file = await api.invoke('team:export', { dir, name, description, includeNotes })
      if (file) toast('info', T.exported(file))
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const importTeam = async (): Promise<void> => {
    try {
      const preview = await api.invoke('team:preview', { dir })
      if (preview) useApp.getState().setDialog({ kind: 'teamImport', preview })
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  return (
    <section className="team-section">
      <h3>{T.section}</h3>
      <p className="muted">{T.sectionLead}</p>
      <div className="form-row">
        <label className="field" {...hint('dialogo.time.nome')}>
          <span>{T.name}</span>
          <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field" {...hint('dialogo.time.descricao')}>
          <span>{T.description}</span>
          <input className="input" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      <label className="check" {...hint('dialogo.time.notas')}>
        <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
        <span>
          {T.includeNotes}
          <small className="check-hint">{T.includeNotesHint}</small>
        </span>
      </label>
      <div className="inline">
        <button className="btn btn-primary" disabled={busy} {...hint('dialogo.time.exportar')} onClick={() => void exportTeam()}>
          <IconExport size={13} /> {T.export}
        </button>
        <button className="btn" {...hint('dialogo.time.importar')} onClick={() => void importTeam()}>
          <IconImport size={13} /> {T.import}
        </button>
      </div>
    </section>
  )
}

/** Prévia da importação: o que entra, presets do arquivo (só com o seu aceite) e colunas do quadro. */
export function TeamImportDialog({ preview }: { preview: TeamPreview }): React.JSX.Element | null {
  const active = useApp((s) => s.active)
  const setDialog = useApp((s) => s.setDialog)
  const toast = useApp((s) => s.toast)
  const [accept, setAccept] = useState<Set<string>>(new Set())
  const [applyBoard, setApplyBoard] = useState(false)
  const [busy, setBusy] = useState(false)
  // Notas que você já tem com o mesmo nome: por padrão o time novo usa as suas (nada de cópia).
  const [reuse, setReuse] = useState<Set<string>>(() => new Set(preview.notes.filter((n) => n.status === 'copia').map((n) => n.file)))
  if (!active) return null

  const run = async (): Promise<void> => {
    setBusy(true)
    const c = canvasBridge()?.viewportCenter() ?? { x: 0, y: 0 }
    try {
      const report = await api.invoke('team:import', {
        dir: active.dir,
        token: preview.token,
        acceptPresets: [...accept],
        applyBoard,
        position: { x: snap(c.x - 600), y: snap(c.y - 300) },
        reuseNotes: [...reuse]
      })
      const extra = report.presetsAdded.length ? ` ${T.presetsAdded(report.presetsAdded)}` : ''
      toast(report.presetFallbacks.length ? 'warn' : 'info', `${describeReport(report)}${extra}`)
      useApp.getState().setSelection(report.insertedIds)
      setDialog({ kind: 'none' })
    } catch (err) {
      setBusy(false)
      toast('error', errorMessage(err))
    }
  }

  const choosable = preview.presets.filter((p) => p.status !== 'igual')
  return (
    <Dialog title={T.importTitle(preview.name)} lead={preview.description || T.importLead} wide onClose={() => setDialog({ kind: 'none' })}>
      <div className="team-preview">
        <section>
          <h4>{T.terminals}</h4>
          <ul>
            {preview.terminals.map((t) => (
              <li key={t.name}>
                <strong>{t.name}</strong> {t.role && <span className="chip chip-role">{t.role}</span>} <span className="muted">{t.presetLabel}</span>
                {t.presetStatus !== 'igual' && <small className="warn-text"> — {T.presetStatus[t.presetStatus]}</small>}
                {t.renamedTo && <small className="warn-text"> — {T.renamed(t.renamedTo)}</small>}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>{T.roles}</h4>
          <ul>
            {preview.roles.map((r) => (
              <li key={r.name}>
                {r.name} <span className="muted">— {T.roleStatus[r.status]}</span>
              </li>
            ))}
          </ul>
          <h4>{T.notes}</h4>
          <ul>
            {preview.notes.map((n) =>
              n.status === 'copia' ? (
                <li key={n.file}>
                  <label className="check team-note-reuse" {...hint('dialogo.time.reusarNota')}>
                    <input
                      type="checkbox"
                      checked={reuse.has(n.file)}
                      onChange={(e) =>
                        setReuse((s) => {
                          const next = new Set(s)
                          if (e.target.checked) next.add(n.file)
                          else next.delete(n.file)
                          return next
                        })
                      }
                    />
                    <span>
                      {n.file} <span className="muted">— {reuse.has(n.file) ? T.noteReuse : T.noteCopy}</span>
                    </span>
                  </label>
                </li>
              ) : (
                <li key={n.file}>
                  {n.file} <span className="muted">— {T.noteStatus[n.status]}</span>
                </li>
              )
            )}
          </ul>
        </section>
      </div>
      {choosable.length > 0 && (
        <section className="team-presets">
          <h4>{T.presets}</h4>
          <p className="muted">{T.presetsHint}</p>
          {choosable.map((p) => (
            <label key={p.id} className="check" {...hint('dialogo.time.aceitarPreset')}>
              <input
                type="checkbox"
                checked={accept.has(p.id)}
                onChange={(e) =>
                  setAccept((s) => {
                    const n = new Set(s)
                    if (e.target.checked) n.add(p.id)
                    else n.delete(p.id)
                    return n
                  })
                }
              />
              <span>
                <strong>{p.label}</strong> <code className="team-cmd">{p.commandLine}</code>
                <small className="check-hint">{T.presetStatus[p.status]}</small>
              </span>
            </label>
          ))}
        </section>
      )}
      {preview.board && (
        <label className="check" {...hint('dialogo.time.quadro')}>
          <input type="checkbox" checked={applyBoard} onChange={(e) => setApplyBoard(e.target.checked)} />
          <span>
            {T.applyBoard(preview.board.join(' · '))}
            <small className="check-hint">{T.applyBoardHint}</small>
          </span>
        </label>
      )}
      <div className="dialog-actions">
        <button className="btn" {...hint('dialogo.time.cancelar')} onClick={() => setDialog({ kind: 'none' })}>
          {T.cancel}
        </button>
        <button className="btn btn-primary" disabled={busy} {...hint('dialogo.time.confirmar')} onClick={() => void run()}>
          {T.confirm}
        </button>
      </div>
    </Dialog>
  )
}
