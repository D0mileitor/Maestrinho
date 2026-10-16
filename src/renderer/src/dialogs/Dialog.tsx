import { useEffect, useRef } from 'react'

interface Props {
  title: string
  lead?: string
  wide?: boolean
  onClose: () => void
  children: React.ReactNode
  /** Rótulo acessível do diálogo (padrão: o título). */
  label?: string
  /** Classe extra (ex.: tamanho fixo do diálogo de configurações). */
  className?: string
}

/** Diálogo modal com foco preso, Esc para fechar e clique fora para cancelar. */
export function Dialog({ title, lead, wide, onClose, children, label, className }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const previous = useRef<Element | null>(null)

  useEffect(() => {
    previous.current = document.activeElement
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button')
    first?.focus()
    return () => {
      const el = previous.current as HTMLElement | null
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus()
    }
  }, [])

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? title}
        className={`dialog${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <h2>{title}</h2>
        {lead && <p className="lead">{lead}</p>}
        {children}
      </div>
    </div>
  )
}
