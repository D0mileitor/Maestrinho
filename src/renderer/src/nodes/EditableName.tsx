import { useEffect, useRef, useState } from 'react'
import type { HintAttrs } from '../hints/hint'

interface Props {
  value: string
  title?: string
  /** Hint do nome (no lugar do `title`): `hint('chave')` ou `hintOf({...})`. */
  hintAttrs?: HintAttrs
  className?: string
  /** Devolve mensagem de erro, ou null se válido. */
  validate?: (v: string) => string | null
  onCommit: (v: string) => void
  /** Começa editando (ex.: F2 ou atalho tmux). */
  editRequest?: number
}

/** Nome com edição inline por duplo clique (Enter confirma, Esc cancela). */
export function EditableName({ value, title, hintAttrs, className, validate, onCommit, editRequest }: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editRequest) {
      setDraft(value)
      setError(null)
      setEditing(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  if (!editing) {
    return (
      <span
        className={`node-name ${className ?? ''}`}
        title={title}
        {...hintAttrs}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setDraft(value)
          setError(null)
          setEditing(true)
        }}
      >
        {value}
      </span>
    )
  }

  const commit = (): void => {
    const v = draft.trim()
    if (v === value) {
      setEditing(false)
      return
    }
    const err = validate?.(v) ?? null
    if (err) {
      setError(err)
      return
    }
    onCommit(v)
    setEditing(false)
  }

  return (
    <span className="node-name-edit nodrag">
      <input
        ref={inputRef}
        className={`input node-name-input${error ? ' invalid' : ''}`}
        value={draft}
        maxLength={40}
        aria-invalid={Boolean(error)}
        title={error ?? undefined}
        onChange={(e) => {
          setDraft(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={() => setEditing(false)}
      />
      {error && <span className="node-name-error">{error}</span>}
    </span>
  )
}
