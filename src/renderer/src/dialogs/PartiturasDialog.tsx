import { useEffect, useState } from 'react'
import type { PartituraImportReport } from '@shared/ipc'
import { useApp } from '../store/appStore'
import { canvasBridge, snap } from '../canvas/bridge'
import { Dialog } from './Dialog'
import { api, errorMessage } from '../lib/api'
import { TeamSection } from './TeamDialogs'
import { hint } from '../hints/hint'

interface Item {
  file: string
  name: string
  createdAt: string
  nodes: number
}

export function describeReport(r: PartituraImportReport): string {
  const parts = [`${r.nodes} nó(s) e ${r.edges} conexão(ões) inseridos`]
  if (r.rolesAdded.length) parts.push(`papéis adicionados: ${r.rolesAdded.join(', ')}`)
  if (r.notesCreated.length) parts.push(`notas criadas: ${r.notesCreated.join(', ')}`)
  if (r.presetFallbacks.length) parts.push(`sem preset nesta máquina (viraram shell): ${r.presetFallbacks.join(', ')}`)
  return parts.join('. ') + '.'
}

/**
 * Partituras: salvar a seleção (terminais com papéis, notas, conexões) como modelo e reinserir.
 * Importar nunca executa comandos do arquivo: os terminais usam os presets locais.
 */
export function PartiturasDialog(): React.JSX.Element | null {
  const active = useApp((s) => s.active)
  const selection = useApp((s) => s.selection)
  const setDialog = useApp((s) => s.setDialog)
  const toast = useApp((s) => s.toast)
  const setSelection = useApp((s) => s.setSelection)
  const [items, setItems] = useState<Item[]>([])
  const [name, setName] = useState('meu time')
  const dir = active?.dir ?? ''

  const refresh = (): void => {
    if (dir) void api.invoke('partituras:list', { dir }).then(setItems).catch(() => setItems([]))
  }
  useEffect(refresh, [dir])

  if (!active) return null
  const center = (): { x: number; y: number } => {
    const c = canvasBridge()?.viewportCenter() ?? { x: 0, y: 0 }
    return { x: snap(c.x - 300), y: snap(c.y - 200) }
  }

  const save = async (): Promise<void> => {
    try {
      const file = await api.invoke('partituras:save', { dir, name, nodeIds: selection })
      toast('info', `Partitura salva em .maestrinho/partituras/${file}`)
      refresh()
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  const insert = async (file: string): Promise<void> => {
    try {
      const report = await api.invoke('partituras:import', { dir, file, position: center() })
      toast(report.presetFallbacks.length ? 'warn' : 'info', describeReport(report))
      setSelection(report.insertedIds)
      setDialog({ kind: 'none' })
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  const importFile = async (): Promise<void> => {
    try {
      const report = await api.invoke('partituras:importFile', { dir, position: center() })
      if (report) {
        toast(report.presetFallbacks.length ? 'warn' : 'info', describeReport(report))
        setDialog({ kind: 'none' })
      }
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  return (
    <Dialog
      title="Partituras"
      lead="Modelos de time: terminais com seus papéis, notas e conexões. Ao inserir, os agentes usam os presets desta máquina — nenhum comando vem do arquivo."
      wide
      onClose={() => setDialog({ kind: 'none' })}
    >
      <section className="partitura-save">
        <label className="field" {...hint('dialogo.partituras.nome')}>
          <span>Salvar a seleção atual ({selection.length} nó(s)) como</span>
          <div className="inline">
            <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            <button
              className="btn btn-primary"
              disabled={selection.length === 0 || !name.trim()}
              {...hint('dialogo.partituras.salvar')}
              onClick={() => void save()}
            >
              Salvar partitura
            </button>
          </div>
          {selection.length === 0 && <small>Selecione nós no canvas (arraste uma área ou Shift+clique) para salvar.</small>}
        </label>
      </section>
      <ul className="partitura-list">
        {items.map((it) => (
          <li key={it.file}>
            <div>
              <strong>{it.name}</strong>
              <span className="muted">
                {' '}
                {it.nodes} nó(s), {new Date(it.createdAt).toLocaleDateString('pt-BR')}
              </span>
            </div>
            <div className="inline">
              <button className="btn btn-primary" {...hint('dialogo.partituras.inserir')} onClick={() => void insert(it.file)}>
                Inserir no canvas
              </button>
              <button
                className="btn"
                {...hint('dialogo.partituras.exportar')}
                onClick={() =>
                  void api
                    .invoke('partituras:exportFile', { dir, file: it.file })
                    .then((ok) => ok && toast('info', 'Partitura exportada.'))
                    .catch((e) => toast('error', errorMessage(e)))
                }
              >
                Exportar…
              </button>
              <button
                className="btn btn-danger"
                {...hint('dialogo.partituras.apagar')}
                onClick={() => {
                  if (window.confirm(`Apagar a partitura "${it.name}" da biblioteca? Cópias já inseridas não mudam.`)) {
                    void api.invoke('partituras:delete', { dir, file: it.file }).then(refresh)
                  }
                }}
              >
                Apagar
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="muted">Nenhuma partitura salva neste workspace.</li>}
      </ul>
      <TeamSection dir={dir} defaultName={active.doc.name} />
      <div className="dialog-actions">
        <button className="btn" {...hint('dialogo.partituras.importar')} onClick={() => void importFile()}>
          Importar arquivo…
        </button>
        <span className="spacer" />
        <button className="btn" {...hint('dialogo.partituras.fechar')} onClick={() => setDialog({ kind: 'none' })}>
          Fechar
        </button>
      </div>
    </Dialog>
  )
}
