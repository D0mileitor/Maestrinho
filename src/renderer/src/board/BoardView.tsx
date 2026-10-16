import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyBoardAction,
  cardsOf,
  defaultBoard,
  foldText,
  type BoardAction,
  type BoardCard,
  type BoardColumn,
  type BoardFile
} from '@shared/board'
import { newId } from '@shared/ids'
import type { TerminalNodeData } from '@shared/schemas'
import { useApp } from '../store/appStore'
import { useChat } from '../store/chatStore'
import { api, errorMessage } from '../lib/api'
import { IconClose, IconNote, IconPlus, IconSleep } from '../lib/icons'
import { boardText as B } from '../i18n/board'
import { paineisHintsDin as PH } from '../i18n/hints/paineis'
import { hint, hintOf } from '../hints/hint'
import '../styles/board.css'

const CARD_MIME = 'application/x-maestrinho-card'

/** Quadro do workspace ativo: carrega, acompanha mudanças (inclusive dos agentes) e aplica ações otimistas. */
function useBoard(dir: string): { board: BoardFile | null; act: (action: BoardAction) => Promise<void>; setBoard: (b: BoardFile) => void } {
  const [board, setBoard] = useState<BoardFile | null>(null)
  const latest = useRef<BoardFile | null>(null)
  latest.current = board
  useEffect(() => {
    let alive = true
    setBoard(null)
    api
      .invoke('board:get', { dir })
      .then((b) => alive && setBoard(b))
      .catch((err: unknown) => {
        useApp.getState().toast('error', errorMessage(err))
        if (alive) setBoard(defaultBoard())
      })
    const off = api.on('board:changed', (e) => {
      if (e.dir === dir) setBoard(e.board)
    })
    return () => {
      alive = false
      off()
    }
  }, [dir])
  const act = async (action: BoardAction): Promise<void> => {
    const cur = latest.current
    if (cur) {
      try {
        setBoard(applyBoardAction(cur, action, new Date().toISOString()))
      } catch (err) {
        useApp.getState().toast('error', errorMessage(err))
        return
      }
    }
    try {
      setBoard(await api.invoke('board:apply', { dir, action }))
    } catch (err) {
      useApp.getState().toast('error', errorMessage(err))
      setBoard(await api.invoke('board:get', { dir }).catch(() => cur))
    }
  }
  return { board, act, setBoard }
}

function matches(card: BoardCard, q: string): boolean {
  if (!q) return true
  const f = foldText(q)
  return [card.title, card.ticket, card.assignee, card.note ?? '', `#${card.seq}`].some((s) => foldText(s).includes(f))
}

/**
 * Visão "Quadro": chamados em colunas (o fluxo do chamado), arrastáveis. Soltar um cartão num agente
 * passa o chamado para ele. Os agentes usam o mesmo quadro pelo `orq board`.
 */
export function BoardView(): React.JSX.Element | null {
  const active = useApp((s) => s.active)
  const dir = active?.dir ?? ''
  const { board, act, setBoard } = useBoard(dir)
  const [filter, setFilter] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [editingColumns, setEditingColumns] = useState(false)
  const [dragOver, setDragOver] = useState<{ column: string; index: number } | null>(null)
  const [dropAgent, setDropAgent] = useState<string | null>(null)

  const terminals = useMemo(
    () => (active?.doc.nodes ?? []).filter((n): n is TerminalNodeData => n.kind === 'terminal').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [active?.doc.nodes]
  )

  if (!active) return null
  const open = board?.cards.find((c) => c.id === openId) ?? null

  const assign = async (cardId: string, terminalId: string): Promise<void> => {
    const node = terminals.find((t) => t.id === terminalId)
    try {
      setBoard(await api.invoke('board:assign', { dir, id: cardId, terminalId }))
      if (node) useApp.getState().toast('info', B.card.sent(node.name))
    } catch (err) {
      useApp.getState().toast('error', errorMessage(err))
    }
  }

  const onColumnDragOver = (e: React.DragEvent, column: string): void => {
    if (!e.dataTransfer.types.includes(CARD_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const list = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-card]')
    let index = list.length
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!.getBoundingClientRect()
      if (e.clientY < r.top + r.height / 2) {
        index = i
        break
      }
    }
    if (dragOver?.column !== column || dragOver.index !== index) setDragOver({ column, index })
  }

  const onColumnDrop = (e: React.DragEvent, column: string): void => {
    const id = e.dataTransfer.getData(CARD_MIME)
    const index = dragOver?.column === column ? dragOver.index : undefined
    setDragOver(null)
    if (!id || !board) return
    e.preventDefault()
    // A posição conta os cartões da coluna sem o próprio cartão arrastado.
    const cards = cardsOf(board, column)
    const self = cards.findIndex((c) => c.id === id)
    const idx = index === undefined ? undefined : self >= 0 && self < index ? index - 1 : index
    void act({ type: 'move', id, column, index: idx })
  }

  return (
    <div className="board-root">
      <header className="board-head">
        <div>
          <h2>{B.title}</h2>
          <p>{B.lead}</p>
        </div>
        <span className="spacer" />
        <input
          className="input board-filter"
          type="search"
          aria-label={B.filter}
          {...hint('quadro.filtro')}
          placeholder={B.filterPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="btn" {...hint('quadro.colunas')} onClick={() => setEditingColumns(true)}>
          {B.columns}
        </button>
        <button className="btn btn-primary" {...hint('quadro.novoCartao')} onClick={() => setAdding(board?.columns[0]?.id ?? null)}>
          <IconPlus size={13} /> {B.newCard}
        </button>
      </header>

      {terminals.length > 0 && (
        <div className="board-agents">
          <span className="board-agents-label">{B.agents}</span>
          {terminals.map((t) => (
            <AgentChip
              key={t.id}
              node={t}
              over={dropAgent === t.id}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(CARD_MIME)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'link'
                setDropAgent(t.id)
              }}
              onDragLeave={() => setDropAgent((cur) => (cur === t.id ? null : cur))}
              onDrop={(e) => {
                setDropAgent(null)
                const id = e.dataTransfer.getData(CARD_MIME)
                if (!id) return
                e.preventDefault()
                void assign(id, t.id)
              }}
            />
          ))}
          <span className="board-agents-hint">{B.agentsHint}</span>
        </div>
      )}

      {!board ? (
        <div className="board-loading">{B.loading}</div>
      ) : (
        <div
          className="board-columns"
          onDragOver={(e) => {
            // Arrastando perto da borda: o quadro rola sozinho (as colunas não cabem todas na tela).
            if (!e.dataTransfer.types.includes(CARD_MIME)) return
            const el = e.currentTarget
            const r = el.getBoundingClientRect()
            const EDGE = 70
            if (e.clientX > r.right - EDGE) el.scrollLeft += 18
            else if (e.clientX < r.left + EDGE) el.scrollLeft -= 18
          }}
        >
          {board.columns.map((col) => {
            const cards = cardsOf(board, col.id).filter((c) => matches(c, filter))
            const over = dragOver?.column === col.id
            return (
              <section
                key={col.id}
                className={`board-col${over ? ' drop' : ''}`}
                style={col.color ? ({ '--col': col.color } as React.CSSProperties) : undefined}
                onDragOver={(e) => onColumnDragOver(e, col.id)}
                onDragLeave={(e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOver(null)
                }}
                onDrop={(e) => onColumnDrop(e, col.id)}
                aria-label={col.name}
              >
                <h3>
                  <span className="board-col-dot" />
                  {col.name}
                  <span className="board-count">{cards.length}</span>
                </h3>
                <div className="board-cards">
                  {cards.map((card, i) => (
                    <div key={card.id} data-card>
                      {over && dragOver.index === i && <div className="board-drop-line" />}
                      <CardTile card={card} terminals={terminals} onOpen={() => setOpenId(card.id)} />
                    </div>
                  ))}
                  {over && dragOver.index >= cards.length && <div className="board-drop-line" />}
                  {cards.length === 0 && !over && <div className="board-empty">{B.empty}</div>}
                </div>
                {adding === col.id ? (
                  <NewCardForm
                    onCancel={() => setAdding(null)}
                    onCreate={(title, ticket) => {
                      setAdding(null)
                      void act({ type: 'add', title, column: col.id, ...(ticket ? { ticket } : {}) })
                    }}
                  />
                ) : (
                  <button className="board-add" {...hintOf(PH.quadroAdicionar(col.name))} onClick={() => setAdding(col.id)}>
                    <IconPlus size={12} /> {B.addHere}
                  </button>
                )}
              </section>
            )
          })}
        </div>
      )}

      {board && board.cards.length === 0 && <p className="board-hint">{B.emptyBoard}</p>}

      {open && board && (
        <CardDrawer
          key={open.id}
          dir={dir}
          board={board}
          card={open}
          terminals={terminals}
          act={act}
          onAssign={(terminalId) => void assign(open.id, terminalId)}
          onClose={() => setOpenId(null)}
        />
      )}
      {editingColumns && board && (
        <ColumnsEditor
          columns={board.columns}
          onClose={() => setEditingColumns(false)}
          onSave={(columns) => {
            setEditingColumns(false)
            void act({ type: 'columns', columns })
          }}
        />
      )}
    </div>
  )
}

function AgentChip({
  node,
  over,
  onDragOver,
  onDragLeave,
  onDrop
}: {
  node: TerminalNodeData
  over: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}): React.JSX.Element {
  const role = useApp((s) => (node.roleId ? s.config?.roles.find((r) => r.id === node.roleId) : undefined))
  const info = useApp((s) => s.runtime[node.id])
  const busy = info?.status === 'running' && info.activity === 'busy'
  return (
    <div
      className={`board-agent${over ? ' over' : ''}${busy ? ' busy' : ''}`}
      {...hintOf(PH.quadroAgente(node.name, node.hibernated === true))}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="board-agent-dot" style={role?.color ? { background: role.color } : undefined} />
      {node.name}
      {node.hibernated && <IconSleep size={11} />}
    </div>
  )
}

function CardTile({ card, terminals, onOpen }: { card: BoardCard; terminals: TerminalNodeData[]; onOpen: () => void }): React.JSX.Element {
  const roleColor = useApp((s) => {
    const node = terminals.find((t) => t.name === card.assignee)
    return node?.roleId ? s.config?.roles.find((r) => r.id === node.roleId)?.color : undefined
  })
  const last = card.log[card.log.length - 1]
  return (
    <button
      className="board-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CARD_MIME, card.id)
        e.dataTransfer.effectAllowed = 'linkMove'
      }}
      onClick={onOpen}
      {...hintOf(PH.quadroCartao(card.title))}
    >
      <span className="board-card-top">
        <span className="board-seq">#{card.seq}</span>
        {card.ticket && <span className="board-ticket">{card.ticket}</span>}
        {card.note && (
          <span className="board-note-mark" {...hintOf(PH.quadroNotaLigada(card.note))}>
            <IconNote size={11} />
          </span>
        )}
      </span>
      <span className="board-card-title">{card.title}</span>
      <span className="board-card-foot">
        {card.assignee ? (
          <span className="board-assignee" style={roleColor ? ({ '--chip': roleColor } as React.CSSProperties) : undefined}>
            {card.assignee}
          </span>
        ) : (
          <span />
        )}
        <span className="board-ago" {...(last ? hintOf(PH.quadroUltimaMovimentacao(last.by, last.text)) : {})}>
          {B.ago(Date.now() - Date.parse(card.updatedAt))}
        </span>
      </span>
    </button>
  )
}

function NewCardForm({ onCreate, onCancel }: { onCreate: (title: string, ticket: string) => void; onCancel: () => void }): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [ticket, setTicket] = useState('')
  const submit = (): void => {
    if (title.trim()) onCreate(title.trim(), ticket.trim())
  }
  return (
    <form
      className="board-new"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <input className="input" autoFocus placeholder={B.card.titleLabel} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      <input className="input" placeholder={B.card.ticketPlaceholder} value={ticket} maxLength={40} onChange={(e) => setTicket(e.target.value)} />
      <div className="board-new-actions">
        <button type="button" className="btn" {...hint('quadro.novo.cancelar')} onClick={onCancel}>
          {B.card.close}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!title.trim()} {...hint('quadro.novo.criar')}>
          {B.newCard}
        </button>
      </div>
    </form>
  )
}

function CardDrawer({
  dir,
  board,
  card,
  terminals,
  act,
  onAssign,
  onClose
}: {
  dir: string
  board: BoardFile
  card: BoardCard
  terminals: TerminalNodeData[]
  act: (a: BoardAction) => Promise<void>
  onAssign: (terminalId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(card.title)
  const [ticket, setTicket] = useState(card.ticket)
  const [note, setNote] = useState(card.note ?? '')
  const [description, setDescription] = useState(card.description)
  const [comment, setComment] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [sendTo, setSendTo] = useState(() => terminals.find((t) => t.name === card.assignee)?.id ?? terminals[0]?.id ?? '')

  useEffect(() => {
    void api
      .invoke('notes:list', { dir })
      .then((list) => setNotes(list.map((n) => n.file)))
      .catch(() => undefined)
  }, [dir])

  const update = (patch: Extract<BoardAction, { type: 'update' }>['patch']): void => void act({ type: 'update', id: card.id, patch })
  const created = card.log[0]

  return (
    <aside className="board-drawer" aria-label={card.title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header>
        <span className="board-seq">#{card.seq}</span>
        <span className="spacer" />
        <button className="icon-btn" {...hint('quadro.cartao.fechar')} aria-label={B.card.close} onClick={onClose}>
          <IconClose size={14} />
        </button>
      </header>
      <label className="field">
        <span>{B.card.titleLabel}</span>
        <input
          className="input"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title.trim() !== card.title && update({ title: title.trim() })}
        />
      </label>
      <div className="form-row">
        <label className="field">
          <span>{B.card.ticket}</span>
          <input
            className="input"
            value={ticket}
            maxLength={40}
            placeholder={B.card.ticketPlaceholder}
            onChange={(e) => setTicket(e.target.value)}
            onBlur={() => ticket.trim() !== card.ticket && update({ ticket: ticket.trim() })}
          />
        </label>
        <label className="field">
          <span>{B.card.column}</span>
          <select
            className="select"
            value={card.column}
            {...hint('quadro.cartao.coluna')}
            onChange={(e) => void act({ type: 'move', id: card.id, column: e.target.value })}
          >
            {board.columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>{B.card.assignee}</span>
        <select className="select" value={card.assignee} {...hint('quadro.cartao.responsavel')} onChange={(e) => update({ assignee: e.target.value })}>
          <option value="">{B.card.noAssignee}</option>
          {terminals.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
          {card.assignee && !terminals.some((t) => t.name === card.assignee) && <option value={card.assignee}>{card.assignee}</option>}
        </select>
      </label>
      <label className="field">
        <span>{B.card.note}</span>
        <div className="board-note-row">
          <input
            className="input"
            list="board-notes"
            value={note}
            {...hint('quadro.cartao.nota')}
            placeholder={B.card.notePlaceholder}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note.trim() !== (card.note ?? '') && update({ note: note.trim() })}
          />
          <datalist id="board-notes">
            {notes.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <button
            className="btn"
            disabled={!card.note}
            {...hint('quadro.cartao.abrirNota')}
            onClick={() => card.note && useChat.getState().openNoteFile(dir, card.note)}
          >
            <IconNote size={13} /> {B.card.openNote}
          </button>
        </div>
      </label>
      <label className="field">
        <span>{B.card.description}</span>
        <textarea
          className="input board-desc"
          value={description}
          placeholder={B.card.descriptionPlaceholder}
          maxLength={20_000}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== card.description && update({ description })}
        />
      </label>
      {terminals.length > 0 && (
        <div className="board-send">
          <select className="select" value={sendTo} onChange={(e) => setSendTo(e.target.value)} aria-label={B.card.assignee} {...hint('quadro.cartao.agente')}>
            {terminals.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" disabled={!sendTo} {...hint('quadro.cartao.passar')} onClick={() => onAssign(sendTo)}>
            {B.card.send}
          </button>
        </div>
      )}
      <div className="board-history">
        <h4>{B.card.history}</h4>
        <ol>
          {[...card.log].reverse().map((l, i) => (
            <li key={`${l.at}-${i}`}>
              <strong>{l.by}</strong> {l.text}
              <time dateTime={l.at}>{B.ago(Date.now() - Date.parse(l.at))}</time>
            </li>
          ))}
        </ol>
        <input
          className="input"
          value={comment}
          maxLength={500}
          placeholder={B.card.commentPlaceholder}
          aria-label={B.card.comment}
          {...hint('quadro.cartao.comentar')}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && comment.trim()) {
              void act({ type: 'comment', id: card.id, text: comment.trim() })
              setComment('')
            }
          }}
        />
      </div>
      <footer>
        {created && <small>{B.card.created(created.by, B.ago(Date.now() - Date.parse(created.at)))}</small>}
        <span className="spacer" />
        <button
          className="btn btn-danger"
          {...hint('quadro.cartao.excluir')}
          onClick={() =>
            useApp.getState().setDialog({
              kind: 'confirm',
              title: B.card.remove,
              body: B.card.confirmRemove(card.title),
              confirmLabel: B.card.remove,
              danger: true,
              onConfirm: () => {
                onClose()
                void act({ type: 'remove', id: card.id })
              }
            })
          }
        >
          {B.card.remove}
        </button>
      </footer>
    </aside>
  )
}

function ColumnsEditor({ columns, onSave, onClose }: { columns: BoardColumn[]; onSave: (c: BoardColumn[]) => void; onClose: () => void }): React.JSX.Element {
  const [draft, setDraft] = useState(columns)
  const move = (i: number, d: number): void => {
    const next = [...draft]
    const [c] = next.splice(i, 1)
    next.splice(i + d, 0, c!)
    setDraft(next)
  }
  const valid = draft.length > 0 && draft.length <= 12 && draft.every((c) => c.name.trim())
  return (
    <aside className="board-drawer board-columns-editor" aria-label={B.columnsDialog.title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header>
        <strong>{B.columnsDialog.title}</strong>
        <span className="spacer" />
        <button className="icon-btn" {...hint('quadro.colunas.fechar')} aria-label={B.card.close} onClick={onClose}>
          <IconClose size={14} />
        </button>
      </header>
      <p className="board-muted">{B.columnsDialog.lead}</p>
      <ol className="board-col-list">
        {draft.map((c, i) => (
          <li key={c.id}>
            <input
              type="color"
              value={c.color || '#8790a3'}
              aria-label={c.name}
              {...hint('quadro.colunas.cor')}
              onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
            />
            <input
              className="input"
              value={c.name}
              maxLength={40}
              aria-label={B.columnsDialog.name}
              onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <button className="icon-btn" disabled={i === 0} {...hint('quadro.colunas.subir')} aria-label={B.columnsDialog.up} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button
              className="icon-btn"
              disabled={i === draft.length - 1}
              {...hint('quadro.colunas.descer')}
              aria-label={B.columnsDialog.down}
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
            <button
              className="icon-btn danger"
              disabled={draft.length <= 1}
              {...hint('quadro.colunas.excluir')}
              aria-label={B.columnsDialog.remove}
              onClick={() => setDraft(draft.filter((_, j) => j !== i))}
            >
              <IconClose size={12} />
            </button>
          </li>
        ))}
      </ol>
      <div className="board-new-actions">
        <button
          className="btn"
          disabled={draft.length >= 12}
          {...hint('quadro.colunas.nova')}
          onClick={() => setDraft([...draft, { id: newId('col'), name: 'Nova coluna', color: '' }])}
        >
          <IconPlus size={12} /> {B.columnsDialog.add}
        </button>
        <button className="btn" {...hint('quadro.colunas.padrao')} onClick={() => setDraft(defaultBoard().columns)}>
          {B.columnsDialog.reset}
        </button>
        <span className="spacer" />
        <button className="btn btn-primary" disabled={!valid} {...hint('quadro.colunas.salvar')} onClick={() => onSave(draft.map((c) => ({ ...c, name: c.name.trim() })))}>
          {B.columnsDialog.save}
        </button>
      </div>
    </aside>
  )
}
