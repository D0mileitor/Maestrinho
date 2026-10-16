import { useEffect, useState } from 'react'
import type { FloorStatus } from '@shared/ipc'
import { useApp } from '../store/appStore'
import { Dialog } from './Dialog'
import { api, errorMessage } from '../lib/api'
import { hint } from '../hints/hint'

/** Cria um floor: git worktree numa branch nova, com canvas próprio. */
export function FloorCreateDialog(): React.JSX.Element | null {
  const active = useApp((s) => s.active)
  const setDialog = useApp((s) => s.setDialog)
  const applyOps = useApp((s) => s.applyOps)
  const toast = useApp((s) => s.toast)
  const [name, setName] = useState('experimento')
  const [branches, setBranches] = useState<string[]>([])
  const [base, setBase] = useState('')
  const [busy, setBusy] = useState(false)
  const dir = active?.dir ?? ''

  useEffect(() => {
    if (!dir) return
    void api
      .invoke('floors:branches', { dir })
      .then((b) => {
        setBranches(b)
        setBase((cur) => cur || (b.includes('main') ? 'main' : b.includes('master') ? 'master' : (b[0] ?? '')))
      })
      .catch(() => undefined)
  }, [dir])

  if (!active) return null
  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const floor = await api.invoke('floors:create', { dir, name, baseBranch: base || undefined })
      await applyOps([{ op: 'setActiveFloor', floorId: floor.id }])
      toast('info', `Floor "${floor.name}" criado na branch ${floor.branch}. Terminais criados nele rodam no worktree isolado.`)
      setDialog({ kind: 'none' })
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Novo floor"
      lead="Um floor é um ambiente isolado: um git worktree numa branch nova, com canvas próprio. A branch principal não é alterada."
      onClose={() => setDialog({ kind: 'none' })}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <label className="field" {...hint('dialogo.floor.nome')}>
          <span>Nome</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-autofocus />
          <small>A branch será floor/{name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'floor'}.</small>
        </label>
        <label className="field" {...hint('dialogo.floor.base')}>
          <span>Branch base</span>
          <select className="select" value={base} onChange={(e) => setBase(e.target.value)}>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" {...hint('dialogo.floor.cancelar')} onClick={() => setDialog({ kind: 'none' })}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()} {...hint('dialogo.floor.criar')}>
            {busy ? 'Criando…' : 'Criar floor'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Situação de um floor (commits à frente, alterações pendentes), orientação de merge e descarte. */
export function FloorManageDialog({ floorId }: { floorId: string }): React.JSX.Element | null {
  const active = useApp((s) => s.active)
  const setDialog = useApp((s) => s.setDialog)
  const toast = useApp((s) => s.toast)
  const [status, setStatus] = useState<FloorStatus | null>(null)
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const dir = active?.dir ?? ''
  const floor = active?.doc.floors.find((f) => f.id === floorId)

  useEffect(() => {
    if (!dir || !floor) return
    void api
      .invoke('floors:status', { dir, id: floorId })
      .then(setStatus)
      .catch((e) => toast('error', errorMessage(e)))
  }, [dir, floorId, floor, toast])

  if (!active || !floor) return null
  const terminals = active.doc.nodes.filter((n) => n.floorId === floorId && n.kind === 'terminal').length
  // Trabalho que se perderia: exige a confirmação explícita (descarte forçado).
  const risky = Boolean(status && (status.dirty || status.ahead > 0))

  const discard = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.invoke('floors:discard', { dir, id: floorId, force })
      toast('info', `Floor "${floor.name}" descartado.`)
      setDialog({ kind: 'none' })
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={`Floor "${floor.name}"`} onClose={() => setDialog({ kind: 'none' })}>
      <dl className="kv">
        <dt>Branch</dt>
        <dd>{floor.branch}</dd>
        <dt>Base</dt>
        <dd>{status?.baseBranch ?? floor.baseBranch}</dd>
        <dt>Pasta</dt>
        <dd className="mono">{floor.worktreePath}</dd>
        <dt>Commits</dt>
        <dd>{status ? `${status.ahead} à frente, ${status.behind} atrás da base` : '…'}</dd>
        <dt>Alterações sem commit</dt>
        <dd>{status ? (status.dirty ? 'sim' : 'não') : '…'}</dd>
      </dl>
      {status && (
        <div className="hint-box">
          <strong>Incorporar</strong>
          <p>{status.mergeHint}</p>
          <small className="muted">O Maestrinho não faz merge automático: revise e incorpore você mesmo.</small>
        </div>
      )}
      <div className="hint-box danger">
        <strong>Descartar</strong>
        <p>
          Encerra {terminals} terminal(is) deste floor, remove o worktree e a branch {floor.branch}. A branch base não é alterada.
        </p>
        {status && !risky && <p>Nada será perdido: o floor não tem commits novos nem alterações sem commit.</p>}
        {status && status.ahead > 0 && (
          <p>
            <strong>
              A branch tem {status.ahead} commit(s) que não estão na base {status.baseBranch}: eles serão apagados.
            </strong>
          </p>
        )}
        {status?.dirty && (
          <p>
            <strong>Há alterações sem commit no floor: elas serão apagadas.</strong>
          </p>
        )}
        {risky && (
          <label className="check" {...hint('dialogo.floor.forcar')}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            <span>Entendo, apagar mesmo assim</span>
          </label>
        )}
      </div>
      <div className="dialog-actions">
        <button className="btn" {...hint('dialogo.floor.fechar')} onClick={() => setDialog({ kind: 'none' })}>
          Fechar
        </button>
        <button
          className="btn btn-danger"
          disabled={busy || !status || (risky && !force)}
          {...hint('dialogo.floor.descartar')}
          onClick={() => void discard()}
        >
          {busy ? 'Descartando…' : 'Descartar floor'}
        </button>
      </div>
    </Dialog>
  )
}
