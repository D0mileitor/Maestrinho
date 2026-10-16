import { useState } from 'react'
import { newId } from '@shared/ids'
import type { PortalNodeData } from '@shared/schemas'
import { useApp, type FlowRect } from '../store/appStore'
import { normalizePortalUrl } from '../nodes/PortalNode'
import { Dialog } from './Dialog'
import { hint } from '../hints/hint'

/** Novo portal: pede o endereço (aceita "exemplo.com", completando https://). */
export function PortalCreateDialog({ rect }: { rect: FlowRect }): React.JSX.Element {
  const setDialog = useApp((s) => s.setDialog)
  const applyOps = useApp((s) => s.applyOps)
  const floorId = useApp((s) => s.active?.doc.activeFloorId)
  const [url, setUrl] = useState('http://localhost:5173')
  const [error, setError] = useState<string | null>(null)

  const create = (): void => {
    const normalized = normalizePortalUrl(url)
    if (!normalized) {
      setError('Endereço inválido. Use http:// ou https://')
      return
    }
    const node: PortalNodeData = {
      id: newId('w'),
      kind: 'portal',
      url: normalized,
      position: { x: rect.x, y: rect.y },
      size: { w: rect.w, h: rect.h },
      floorId
    }
    void applyOps([{ op: 'addNodes', nodes: [node] }])
    setDialog({ kind: 'none' })
  }

  return (
    <Dialog
      title="Novo portal"
      lead="Um navegador embutido no canvas, isolado do restante do app (sessão própria, sem acesso ao seu computador)."
      onClose={() => setDialog({ kind: 'none' })}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <label className="field" {...hint('dialogo.portal.endereco')}>
          <span>Endereço</span>
          <input
            className="input"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setError(null)
            }}
            data-autofocus
          />
          <small>{error ?? 'Ex.: o servidor de desenvolvimento do projeto, a documentação da API, o painel de CI.'}</small>
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" {...hint('dialogo.portal.cancelar')} onClick={() => setDialog({ kind: 'none' })}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" {...hint('dialogo.portal.criar')}>
            Criar portal
          </button>
        </div>
      </form>
    </Dialog>
  )
}
