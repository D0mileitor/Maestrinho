import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { newId } from '@shared/ids'
import type { NoteInfo } from '@shared/ipc'
import { NoteFileSchema, type NoteNodeData } from '@shared/schemas'
import { useApp, type FlowRect } from '../store/appStore'
import { Dialog } from './Dialog'
import { api } from '../lib/api'
import { IconNote } from '../lib/icons'
import { NOTE_MIN_SIZE, noteErrorMessage, requestNoteEdit } from '../nodes/NoteNode'
import { notesStrings } from '../i18n/notes'
import { hint } from '../hints/hint'

const s = notesStrings.create

/** Mesmo ajuste feito pelo main ao criar: apara, normaliza (NFC) e garante ".md" minúsculo. */
function normalizeName(input: string): string {
  const name = input.normalize('NFC').trim()
  if (!name) return ''
  return /\.md$/i.test(name) ? `${name.slice(0, -3)}.md` : `${name}.md`
}

/** "nota.md", "nota-2.md"... (o main garante a unicidade de novo ao criar). */
function uniqueDefault(existing: readonly NoteInfo[]): string {
  const taken = new Set(existing.map((n) => n.file.toLowerCase()))
  if (!taken.has('nota.md')) return 'nota.md'
  for (let i = 2; i < 10_000; i++) if (!taken.has(`nota-${i}.md`)) return `nota-${i}.md`
  return `nota-${newId()}.md`
}

/** Seleciona o nome sem a extensão (digitar substitui só o nome). */
function selectStem(input: HTMLInputElement): void {
  const v = input.value
  input.setSelectionRange(0, /\.md$/i.test(v) ? v.length - 3 : v.length)
}

/**
 * Diálogo "Nova nota": cria um arquivo .md (nome único) ou escolhe uma nota existente e a coloca
 * no canvas no retângulo indicado.
 */
export function NoteCreateDialog({ rect }: { rect: FlowRect }): React.JSX.Element {
  const dir = useApp((st) => st.active?.dir)
  const docNodes = useApp((st) => st.active?.doc.nodes)
  const setDialog = useApp((st) => st.setDialog)
  const [notes, setNotes] = useState<NoteInfo[] | null>(null)
  const [name, setName] = useState('nota.md')
  const [edited, setEdited] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!dir) return
    let alive = true
    const load = (): void => {
      api
        .invoke('notes:list', { dir })
        .then((list) => {
          if (alive) setNotes(list)
        })
        .catch(() => {
          if (alive) setNotes([])
        })
    }
    load()
    const off = api.on('notes:listChanged', (e) => {
      if (e.dir === dir) load()
    })
    return () => {
      alive = false
      off()
    }
  }, [dir])

  // Nome padrão único assim que a lista chega (se o usuário ainda não digitou nada).
  useEffect(() => {
    if (edited || !notes) return
    setName(uniqueDefault(notes))
  }, [notes, edited])

  // Trocar o nome padrão não pode tirar a seleção: digitar continua substituindo o nome.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!edited && input && document.activeElement === input) selectStem(input)
  }, [name, edited])

  const existing = useMemo(() => new Map((notes ?? []).map((n) => [n.file.toLowerCase(), n.file])), [notes])
  const onCanvas = useMemo(
    () => new Set((docNodes ?? []).filter((n) => n.kind === 'note').map((n) => (n as NoteNodeData).file.toLowerCase())),
    [docNodes]
  )
  const normalized = normalizeName(name)
  const match = normalized ? existing.get(normalized.toLowerCase()) : undefined

  const query = edited ? name.trim().toLowerCase().replace(/\.md$/, '') : ''
  const visible = useMemo(
    () => (notes ?? []).filter((n) => !query || n.file.toLowerCase().includes(query)),
    [notes, query]
  )

  const close = (): void => setDialog({ kind: 'none' })

  const place = (file: string, edit: boolean): void => {
    const st = useApp.getState()
    const node: NoteNodeData = {
      id: newId('n'),
      kind: 'note',
      file,
      position: { x: rect.x, y: rect.y },
      size: { w: Math.max(NOTE_MIN_SIZE.w, rect.w), h: Math.max(NOTE_MIN_SIZE.h, rect.h) },
      floorId: st.active?.doc.activeFloorId
    }
    if (edit) requestNoteEdit(node.id)
    void st.applyOps([{ op: 'addNodes', nodes: [node] }])
    st.setDialog({ kind: 'none' })
    setTimeout(() => useApp.getState().requestFocus(node.id), 120)
  }

  const submit = async (pick?: string): Promise<void> => {
    if (!dir || busy) return
    setError(null)
    const chosen = pick ?? match
    if (chosen) {
      place(chosen, false)
      return
    }
    if (!normalized) {
      setError(s.nameRequired)
      return
    }
    const parsed = NoteFileSchema.safeParse(normalized)
    if (!parsed.success) {
      setError(notesStrings.errors.invalidName(parsed.error.issues[0]?.message ?? ''))
      return
    }
    setBusy(true)
    try {
      const file = await api.invoke('notes:create', { dir, file: normalized })
      place(file, true)
    } catch (err) {
      setError(noteErrorMessage(err))
      setBusy(false)
    }
  }

  if (!dir) {
    return (
      <Dialog title={s.title} onClose={close}>
        <p className="lead">{s.noWorkspace}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" {...hint('dialogo.nota.cancelar')} onClick={close}>
            {notesStrings.common.cancel}
          </button>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog title={s.title} lead={s.lead} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="field" {...hint('dialogo.nota.nome')}>
          <span>{s.name}</span>
          <input
            ref={inputRef}
            className="input"
            value={name}
            maxLength={200}
            spellCheck={false}
            data-autofocus
            aria-invalid={Boolean(error)}
            onFocus={(e) => selectStem(e.currentTarget)}
            onChange={(e) => {
              setName(e.target.value)
              setEdited(true)
              setError(null)
            }}
          />
          <small className={error ? 'form-error' : undefined}>{error ?? (match ? s.existsHint : s.nameHint)}</small>
        </label>

        <div className="note-pick">
          <p className="note-pick-title">{s.existing}</p>
          {notes === null ? (
            <div className="note-pick-empty">{s.loadingList}</div>
          ) : notes.length === 0 ? (
            <div className="note-pick-empty">{s.noExisting}</div>
          ) : visible.length === 0 ? (
            <div className="note-pick-empty">{s.noMatches}</div>
          ) : (
            <ul className="note-pick-list" aria-label={s.existing}>
              {visible.map((n) => (
                <li key={n.file}>
                  <button
                    type="button"
                    className={`note-pick-item${match === n.file ? ' selected' : ''}`}
                    {...hint('dialogo.nota.existente')}
                    onClick={() => {
                      setName(n.file)
                      setEdited(true)
                      setError(null)
                    }}
                    onDoubleClick={() => void submit(n.file)}
                  >
                    <IconNote size={14} />
                    <span className="note-pick-name">{n.file}</span>
                    {onCanvas.has(n.file.toLowerCase()) && <span className="note-pick-chip">{s.onCanvas}</span>}
                    <span className="note-pick-meta">{s.size(n.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn" {...hint('dialogo.nota.cancelar')} onClick={close}>
            {notesStrings.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} {...hint(match ? 'dialogo.nota.abrir' : 'dialogo.nota.criar')}>
            {match ? s.open : s.create}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
