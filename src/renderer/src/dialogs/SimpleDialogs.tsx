import { useState } from 'react'
import { useApp } from '../store/appStore'
import { Dialog } from './Dialog'
import { t } from '../i18n'
import { hint, hintOf } from '../hints/hint'
import { dialogosHintsDinamicos } from '../i18n/hints/dialogos'

export function ConfirmDialog(props: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
}): React.JSX.Element {
  const setDialog = useApp((s) => s.setDialog)
  const [busy, setBusy] = useState(false)
  const close = (): void => setDialog({ kind: 'none' })
  return (
    <Dialog title={props.title} onClose={close}>
      <p className="lead confirm-body">{props.body}</p>
      <div className="dialog-actions">
        <button className="btn" {...hint('dialogo.confirmar.cancelar')} onClick={close}>
          {t.common.cancel}
        </button>
        <button
          className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`}
          data-autofocus
          disabled={busy}
          {...hintOf(dialogosHintsDinamicos.confirmar(props.confirmLabel))}
          onClick={async () => {
            setBusy(true)
            try {
              await props.onConfirm()
            } finally {
              setBusy(false)
              close()
            }
          }}
        >
          {props.confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}

export function CorruptedDialog({ dir, error, backups }: { dir: string; error: string; backups: string[] }): React.JSX.Element {
  const setDialog = useApp((s) => s.setDialog)
  const restore = useApp((s) => s.restoreBackup)
  return (
    <Dialog title={t.corrupted.title} onClose={() => setDialog({ kind: 'none' })}>
      <p className="lead">{t.corrupted.body(error)}</p>
      <p className="muted">{dir}</p>
      {backups.length === 0 && <p>{t.corrupted.noBackups}</p>}
      <div className="stack">
        {backups.slice(0, 6).map((b, i) => (
          <button key={b} className={`btn ${i === 0 ? 'btn-primary' : ''}`} {...hint('dialogo.corrompido.restaurar')} onClick={() => void restore(dir, b)}>
            {t.corrupted.restore(b.replace(/^workspace-|\.json$/g, ''))}
          </button>
        ))}
      </div>
      <div className="dialog-actions">
        <button className="btn" {...hint('dialogo.corrompido.cancelar')} onClick={() => setDialog({ kind: 'none' })}>
          {t.corrupted.cancel}
        </button>
        <button className="btn btn-danger" {...hint('dialogo.corrompido.vazio')} onClick={() => void restore(dir, '')}>
          {t.corrupted.startEmpty}
        </button>
      </div>
    </Dialog>
  )
}

export function Toasts(): React.JSX.Element {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.level}`} {...hint('dialogo.aviso.dispensar')} onClick={() => dismiss(x.id)}>
          {x.message}
        </div>
      ))}
    </div>
  )
}
