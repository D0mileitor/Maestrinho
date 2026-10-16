import { useEffect, useRef, useState } from 'react'
import type { Checkpoint } from '@shared/checkpoints'
import { useApp } from '../store/appStore'
import { api, errorMessage } from '../lib/api'
import { changesText as C } from '../i18n/changes'
import { hint } from '../hints/hint'

/**
 * Checkpoints do repositório (gravados antes de cada turno dos agentes): lista e "Voltar aqui", com
 * confirmação mostrando o que muda. Toda volta guarda antes o estado atual (dá para desfazer).
 */
export function CheckpointsMenu({ dir, root, onRestored }: { dir: string; root: string; onRestored(): void }): React.JSX.Element {
  const toast = useApp((s) => s.toast)
  const enabled = useApp((s) => s.config?.settings.checkpoints ?? true)
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Checkpoint[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const load = (): void => {
    setList(null)
    api
      .invoke('checkpoints:list', { dir, root })
      .then(setList)
      .catch((err: unknown) => {
        toast('error', errorMessage(err))
        setList([])
      })
  }

  useEffect(() => {
    if (!open) return
    load()
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega ao abrir ou trocar de repositório
  }, [open, dir, root])

  const goBack = async (c: Checkpoint): Promise<void> => {
    try {
      const plan = await api.invoke('checkpoints:preview', { dir, root, id: c.id })
      if (plan.restore.length + plan.remove.length === 0) {
        toast('info', C.ckNothing)
        return
      }
      setOpen(false)
      useApp.getState().setDialog({
        kind: 'confirm',
        title: C.ckConfirmTitle,
        body: C.ckConfirm(label(c), C.ckWhen(c.at), plan.restore, plan.remove),
        confirmLabel: C.ckGoBack,
        danger: true,
        onConfirm: async () => {
          try {
            const r = await api.invoke('checkpoints:restore', { dir, root, id: c.id })
            toast('info', C.ckRestored(r.restored, r.removed))
            onRestored()
          } catch (err) {
            toast('error', errorMessage(err))
          }
        }
      })
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  return (
    <div className="checkpoints" ref={ref}>
      <button className="btn" disabled={!root} aria-expanded={open} {...hint('mudancas.checkpoints')} onClick={() => setOpen((v) => !v)}>
        {C.checkpoints}
      </button>
      {open && (
        <div className="checkpoints-pop" role="dialog" aria-label={C.checkpoints}>
          {!enabled && <p className="checkpoints-note">{C.ckOff}</p>}
          {list === null ? (
            <p className="checkpoints-note">{C.loading}</p>
          ) : list.length === 0 ? (
            <p className="checkpoints-note">{C.ckEmpty}</p>
          ) : (
            <ul>
              {list.map((c) => (
                <li key={c.id} className={c.safety ? 'safety' : ''}>
                  <span className="checkpoints-label">
                    <strong>{label(c)}</strong>
                    <small>{C.ckWhen(c.at)}</small>
                  </span>
                  <button className="btn" {...hint('mudancas.checkpointVoltar')} onClick={() => void goBack(c)}>
                    {C.ckGoBack}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="checkpoints-note">{C.ckFooter}</p>
        </div>
      )}
    </div>
  )
}

function label(c: Checkpoint): string {
  return c.safety ? C.ckSafety : C.ckBefore(c.name)
}
