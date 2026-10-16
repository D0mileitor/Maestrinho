import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { choiceSteps, detectPendingChoice, modeFromScreen, modelLabel, type ChatAgent, type ChatItem, type ChatMeta, type HelperItem, type PendingChoice } from '@shared/chat'
import { mentionQuery, mergeFeeds, parseMentions, type GeneralEntry } from '@shared/teamChat'
import type { NoteNodeData, TerminalNodeData } from '@shared/schemas'
import { effectiveLook, helperLook } from '@shared/office'
import { useApp } from '../store/appStore'
import { GENERAL_TAB, useChat, type Feed } from '../store/chatStore'
import { api, errorMessage } from '../lib/api'
import { IconChat, IconDock, IconNote, IconPopOut, IconRestart, IconSleep, IconUsers } from '../lib/icons'
import { IS_CHAT_WINDOW } from '../lib/windowKind'
import { NoteReader } from './NoteReader'
import { askNewTask } from './newTask'
import { faceUrl } from '../office/face'
import { MessageRail, type RailItem } from './MessageRail'
import { isPdf } from '@shared/chatAttachments'
import { t } from '../i18n'
import { teamChatText as G } from '../i18n/teamChat'
import { paineisHintsDin as PH } from '../i18n/hints/paineis'
import { hint, hintOf } from '../hints/hint'
import '../styles/notes.css'
import '../styles/chat.css'

const c = t.chat
type ToolItem = Extract<ChatItem, { kind: 'tool' }>
const WIDTH_KEY = 'maestrinho:chat:width'
const MIN_W = 440
const MAX_W = 1000
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp)$/i

function savedWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(v) && v >= MIN_W ? Math.min(v, MAX_W) : 600
  } catch {
    return 600
  }
}

/**
 * Painel de chat: abas de fichário (uma por agente) e o chat geral. Sobre o canvas da janela principal ou,
 * destacado, ocupando uma janela própria (`IS_CHAT_WINDOW`).
 */
export function ChatPanel(): React.JSX.Element | null {
  const open = useChat((s) => s.open)
  const dir = useApp((s) => s.active?.dir ?? null)
  const chatDir = useChat((s) => s.dir)

  // Trocou de workspace com o chat aberto: abre as abas daquele workspace.
  useEffect(() => {
    if (open && dir && chatDir !== dir) useChat.getState().setOpen(true, dir)
  }, [open, dir, chatDir])

  if (!open || !dir) return null
  return <Panel dir={dir} />
}

/** Terminais do andar em exibição, na ordem do canvas (esquerda → direita, de cima para baixo). */
/** Notas (blocos .md) do andar, na ordem do canvas. */
function useFloorNotes(): NoteNodeData[] {
  const nodes = useApp((s) => s.active?.doc.nodes)
  const floor = useApp((s) => s.active?.doc.activeFloorId ?? null)
  return useMemo(
    () =>
      (nodes ?? [])
        .filter((n): n is NoteNodeData => n.kind === 'note' && (n.floorId ?? null) === floor)
        .sort((a, b) => Math.round(a.position.y / 300) - Math.round(b.position.y / 300) || a.position.x - b.position.x),
    [nodes, floor]
  )
}

/** Notas do andar no pé da barra lateral: clicar abre a nota aqui no chat. */
function NoteTiles({ dir, openId }: { dir: string; openId: string | null }): React.JSX.Element | null {
  const notes = useFloorNotes()
  if (notes.length === 0) return null
  return (
    <div className="chat-notes" role="group" aria-label={G.notes}>
      <span className="chat-notes-title">{G.notes}</span>
      {notes.map((n) => (
        <button
          key={n.id}
          type="button"
          className={openId === n.id ? 'chat-note-tile selected' : 'chat-note-tile'}
          aria-pressed={openId === n.id}
          {...hintOf(PH.chatNota(n.file))}
          onClick={() => useChat.getState().openNote(dir, n.id)}
        >
          <IconNote size={12} />
          <span>{n.file.replace(/\.md$/i, '')}</span>
        </button>
      ))}
    </div>
  )
}

function useFloorTerminals(): TerminalNodeData[] {
  const nodes = useApp((s) => s.active?.doc.nodes)
  const floor = useApp((s) => s.active?.doc.activeFloorId ?? null)
  return useMemo(
    () =>
      (nodes ?? [])
        .filter((n): n is TerminalNodeData => n.kind === 'terminal' && (n.floorId ?? null) === floor)
        .sort((a, b) => Math.round(a.position.y / 300) - Math.round(b.position.y / 300) || a.position.x - b.position.x),
    [nodes, floor]
  )
}

type TabState = 'busy' | 'idle' | 'attention' | 'waiting' | 'sleeping' | 'off'

function useTabState(node: TerminalNodeData): TabState {
  return useApp((s) => {
    if (node.hibernated) return 'sleeping'
    const rt = s.runtime[node.id]
    if (!rt || rt.status !== 'running') return 'off'
    if (rt.needsInput) return 'waiting'
    if (rt.activity === 'busy') return 'busy'
    return s.attention[node.id] ? 'attention' : 'idle'
  })
}

function Panel({ dir }: { dir: string }): React.JSX.Element {
  const tab = useChat((s) => s.tab)
  const noteId = useChat((s) => s.noteId)
  const noteFile = useChat((s) => s.noteFile)
  const terminals = useFloorTerminals()
  const [width, setWidth] = useState(savedWidth)
  const note = useApp((s) => {
    const n = noteId ? s.active?.doc.nodes.find((x) => x.id === noteId) : undefined
    return n?.kind === 'note' ? n : undefined
  })
  const idsKey = terminals.map((n) => n.id).join(',')

  // Acompanha a conversa de todos os agentes do andar (abas e chat geral); esquece os que saíram.
  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : []
    const st = useChat.getState()
    st.ensure(ids)
    st.forget(Object.keys(st.feeds).filter((id) => !ids.includes(id)))
  }, [idsKey])

  // Aba de um terminal que saiu do andar: volta ao chat geral.
  useEffect(() => {
    if (tab !== GENERAL_TAB && !terminals.some((n) => n.id === tab)) useChat.getState().selectTab(GENERAL_TAB)
  }, [tab, terminals])

  // Nota removida do canvas: volta à conversa.
  useEffect(() => {
    if (noteId && !note) useChat.getState().closeNote()
  }, [noteId, note])

  // Aba de um agente aberta = você está nele: o "!" some e o personagem dele sai da área de trabalho.
  const viewingAgent = !noteId && !noteFile && tab !== GENERAL_TAB ? tab : null
  useEffect(() => {
    if (!viewingAgent) return
    const claim = (): void => useApp.getState().setFocusedTerminal(viewingAgent)
    claim()
    // Voltou para esta janela (ex.: o chat destacado em outro monitor): você está de novo neste agente.
    window.addEventListener('focus', claim)
    return () => {
      window.removeEventListener('focus', claim)
      if (useApp.getState().focusedTerminal === viewingAgent) useApp.getState().setFocusedTerminal(null)
    }
  }, [viewingAgent])

  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const move = (ev: PointerEvent): void => setWidth(Math.max(MIN_W, Math.min(MAX_W, startW + (startX - ev.clientX))))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w))
        } catch {
          // ignora
        }
        return w
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const current = terminals.find((n) => n.id === tab)
  const readFile = note?.file ?? noteFile

  return (
    <aside className={`chat-panel chat-binder${IS_CHAT_WINDOW ? ' standalone' : ''}`} style={IS_CHAT_WINDOW ? undefined : { width }} aria-label={c.title}>
      {!IS_CHAT_WINDOW && <div className="chat-resize" onPointerDown={startResize} aria-hidden="true" {...hint('chat.redimensionar')} />}
      <div className="chat-side">
        <nav className="chat-tabs" role="tablist" aria-orientation="vertical" aria-label={G.tabsLabel}>
          <GeneralTab selected={tab === GENERAL_TAB && !readFile} terminals={terminals} />
          {terminals.map((n) => (
            <AgentTab key={n.id} node={n} selected={tab === n.id && !readFile} />
          ))}
        </nav>
        <NoteTiles dir={dir} openId={noteId} />
      </div>
      <section className="chat-page" role="tabpanel">
        {readFile ? (
          <>
            <header className="chat-head">
              <IconNote size={15} className="muted" />
              <strong className="chat-name" title={readFile}>
                {readFile}
              </strong>
              <span className="muted chat-preset">{c.noteKind}</span>
              <span className="spacer" />
              {note && (
                <button type="button" className="chat-head-btn" {...hint('chat.nota.verNoCanvas')} onClick={() => showOnCanvas(dir, note.id)}>
                  {c.showOnCanvas}
                </button>
              )}
              <button type="button" className="chat-head-btn" {...hint('chat.nota.voltar')} onClick={() => useChat.getState().closeNote()}>
                {c.backToChat(current?.name ?? G.general)}
              </button>
              <CloseButton />
            </header>
            <NoteReader key={note?.id ?? readFile} dir={dir} file={readFile} missingHint={note ? undefined : c.noteFileMissing(readFile)} />
          </>
        ) : current ? (
          <AgentPage key={current.id} node={current} />
        ) : (
          <GeneralPage terminals={terminals} />
        )}
      </section>
    </aside>
  )
}

/** Mostra o nó no canvas da janela principal (do chat destacado, traz a janela principal para a frente). */
function showOnCanvas(dir: string, id: string): void {
  if (IS_CHAT_WINDOW) void api.invoke('chat:focusCanvas', { dir, id }).catch(() => undefined)
  else useApp.getState().requestFocus(id)
}

/** Destacar/devolver o chat e fechar (no chat destacado, fechar fecha a janela). */
function CloseButton(): React.JSX.Element {
  return (
    <>
      {IS_CHAT_WINDOW ? (
        <button type="button" className="icon-btn" {...hint('chat.devolver')} aria-label={G.dock} onClick={() => useChat.getState().dock()}>
          <IconDock size={14} />
        </button>
      ) : (
        <button type="button" className="icon-btn" {...hint('chat.destacar')} aria-label={G.detach} onClick={() => useChat.getState().detach()}>
          <IconPopOut size={14} />
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        {...hint(IS_CHAT_WINDOW ? 'chat.fecharJanela' : 'chat.fechar')}
        aria-label={c.close}
        onClick={() => (IS_CHAT_WINDOW ? window.close() : useChat.getState().setOpen(false, null))}
      >
        ×
      </button>
    </>
  )
}

// ------------------------------------------------------------------ abas do fichário

function GeneralTab({ selected, terminals }: { selected: boolean; terminals: TerminalNodeData[] }): React.JSX.Element {
  const waiting = useApp((s) => terminals.filter((n) => s.runtime[n.id]?.needsInput || s.attention[n.id]).length)
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`chat-tab general${selected ? ' selected' : ''}`}
      {...hint('chat.aba.geral')}
      onClick={() => useChat.getState().selectTab(GENERAL_TAB)}
    >
      <span className="chat-tab-strip" aria-hidden="true" />
      <span className="chat-tab-row">
        <IconUsers size={13} />
        <strong>{G.general}</strong>
        {waiting > 0 && !selected && <span className="chat-tab-badge alert">{waiting}</span>}
      </span>
    </button>
  )
}

function AgentTab({ node, selected }: { node: TerminalNodeData; selected: boolean }): React.JSX.Element {
  const state = useTabState(node)
  const role = useApp((s) => s.config?.roles.find((r) => r.id === node.roleId))
  const unread = useChat((s) => s.feeds[node.id]?.unread ?? 0)
  const alert = state === 'waiting' || state === 'attention'
  const badge = alert ? '!' : unread > 0 ? String(unread) : ''
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`chat-tab${selected ? ' selected' : ''}`}
      style={role?.color ? ({ '--tab': role.color } as React.CSSProperties) : undefined}
      {...hintOf(PH.chatAbaAgente(node.name, role?.name, G.tabState[state] ?? state, unread ? G.unread(unread) : ''))}
      onClick={() => useChat.getState().selectTab(node.id)}
    >
      <span className="chat-tab-strip" aria-hidden="true" />
      <span className="chat-tab-row">
        {state === 'sleeping' ? <IconSleep size={11} /> : <span className={`chat-dot ${state}`} aria-hidden="true" />}
        <strong>{node.name}</strong>
        {badge && <span className={`chat-tab-badge${alert ? ' alert' : ''}`}>{badge}</span>}
      </span>
      <span className="chat-tab-sub">{role?.name ?? G.tabState[state]}</span>
    </button>
  )
}

// ------------------------------------------------------------------ aba de um agente

function AgentPage({ node }: { node: TerminalNodeData }): React.JSX.Element {
  const feed = useChat((s) => s.feeds[node.id])
  const runtime = useApp((s) => s.runtime[node.id])
  const [liveMode, setLiveMode] = useState<string | null>(null)
  const presetLabel = useApp((s) => s.config?.presets.find((p) => p.id === node.presetId)?.label ?? node.presetId)
  const role = useApp((s) => s.config?.roles.find((r) => r.id === node.roleId))
  const running = runtime?.status === 'running'
  const busy = running && runtime?.activity === 'busy'
  const state = !running ? 'off' : busy ? 'busy' : 'idle'

  return (
    <>
      <header className="chat-head">
        <IconChat size={15} className="muted" />
        <span className={`chat-dot ${state}`} aria-hidden="true" />
        <strong className="chat-name">{node.name}</strong>
        {role && (
          <span className="chat-role" style={role.color ? { borderColor: role.color, color: role.color } : undefined}>
            {role.name}
          </span>
        )}
        <span className="muted chat-preset">{presetLabel}</span>
        <span className="spacer" />
        <button type="button" className="chat-head-btn" {...hint('chat.agente.verNoCanvas')} onClick={() => showOnCanvas(useChat.getState().dir ?? '', node.id)}>
          {c.showOnCanvas}
        </button>
        <CloseButton />
      </header>
      {!feed || feed.loading ? (
        <div className="chat-empty">{c.loading}</div>
      ) : feed.error ? (
        <div className="chat-empty">{feed.error}</div>
      ) : (
        <>
          {feed.mode === 'screen' ? <ScreenView id={node.id} /> : <Transcript node={node} feed={feed} busy={busy} />}
          {running && <PendingChoiceCard id={node.id} onScreen={(screen) => setLiveMode(modeFromScreen(screen))} />}
          <Composer
            node={node}
            running={running || node.hibernated === true}
            busy={busy && !(feed.mode === 'transcript' && feed.turnEnded)}
            transcript={feed.mode === 'transcript'}
            agent={feed.agent}
            meta={feed.meta}
            liveMode={running ? liveMode : null}
          />
        </>
      )}
    </>
  )
}

// ------------------------------------------------------------------ chat geral

/** Rosto do personagem do escritório (a aparência escolhida para o terminal, camiseta na cor do papel). */
function AgentFace({ node, color }: { node: TerminalNodeData; color: string | undefined }): React.JSX.Element {
  const src = useMemo(() => faceUrl(effectiveLook(node.look, node.id, color)), [node.look, node.id, color])
  return <img className="chat-face" src={src} alt="" draggable={false} />
}

/** Rosto de um ajudante: o mesmo estagiário de boné do escritório (a semente é o id da chamada). */
function HelperFace({ seed }: { seed: string }): React.JSX.Element {
  const src = useMemo(() => faceUrl(helperLook(seed)), [seed])
  return <img className="chat-face" src={src} alt="" draggable={false} />
}

function helperIcon(status: HelperItem['status']): React.JSX.Element {
  if (status === 'running') return <span className="chat-spinner" role="img" aria-label={c.helperStatus.running} />
  return status === 'error' ? (
    <span className="chat-tool-err" role="img" aria-label={c.helperStatus.error}>
      ✗
    </span>
  ) : (
    <span className="chat-tool-ok" role="img" aria-label={c.helperStatus.done}>
      ✓
    </span>
  )
}

/** O agente chamou um ajudante (fica no ponto da conversa em que chamou; vira ✓ quando ele termina). */
function HelperCall({ item }: { item: HelperItem }): React.JSX.Element {
  return (
    <div className="chat-helper-call">
      <span className="chat-avatar small chat-helper-avatar" aria-hidden="true">
        <HelperFace seed={item.seed} />
      </span>
      <span className="chat-helper-call-text">
        {c.helperCalled} <strong>{item.title}</strong>
        {item.type && <span className="chat-helper-type">{item.type}</span>}
      </span>
      {helperIcon(item.status)}
    </div>
  )
}

/** Respostas maiores que isto aparecem recortadas, com o botão para ver tudo. */
const LONG_HELPER_REPORT = 1400

/** Resposta de um ajudante: o rosto dele, a tarefa como nome, o texto e quanto levou. */
const HelperReport = memo(function HelperReport({
  helper,
  report,
  parent
}: {
  helper: Pick<HelperItem, 'seed' | 'title' | 'type' | 'status' | 'usage'>
  report: string
  parent?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const long = report.length > LONG_HELPER_REPORT
  const foot = [c.helperStatus[helper.status], helper.usage ? c.helperUsage(helper.usage) : ''].filter(Boolean).join(' · ')
  return (
    <article className="chat-helper">
      <span className="chat-avatar chat-helper-avatar" aria-hidden="true">
        <HelperFace seed={helper.seed} />
      </span>
      <div className="chat-helper-body">
        <header className="chat-helper-head">
          <strong>{helper.title}</strong>
          <span className="chat-helper-type">{c.helperTag(helper.type, parent)}</span>
        </header>
        {report ? (
          <div className={long && !open ? 'chat-helper-report clipped' : 'chat-helper-report'}>
            <ChatMarkdown text={report} />
          </div>
        ) : (
          <p className="chat-helper-empty">{c.helperNoReport}</p>
        )}
        {long && (
          <button type="button" className="chat-helper-more" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? c.helperShowLess : c.helperShowAll}
          </button>
        )}
        <footer className="chat-helper-foot">{foot}</footer>
      </div>
    </article>
  )
})

const avatarStyle = (color: string | undefined): React.CSSProperties | undefined => (color ? ({ '--agent': color } as React.CSSProperties) : undefined)

function GeneralPage({ terminals }: { terminals: TerminalNodeData[] }): React.JSX.Element {
  const feeds = useChat((s) => s.feeds)
  const runtime = useApp((s) => s.runtime)
  const roles = useApp((s) => s.config?.roles)
  const byId = useMemo(() => new Map(terminals.map((n) => [n.id, n])), [terminals])
  const colorOf = (n: TerminalNodeData | undefined): string | undefined => roles?.find((r) => r.id === n?.roleId)?.color || undefined
  const entries = useMemo(
    () =>
      mergeFeeds(
        terminals.flatMap((n) => {
          const f = feeds[n.id]
          return f && f.mode === 'transcript' ? [{ terminalId: n.id, items: f.order.map((k) => f.items[k]!).filter(Boolean) }] : []
        })
      ),
    [terminals, feeds]
  )
  const waiting = terminals.filter((n) => runtime[n.id]?.needsInput && runtime[n.id]?.status === 'running')
  const busy = terminals.filter((n) => runtime[n.id]?.status === 'running' && runtime[n.id]?.activity === 'busy')
  const noTranscript = terminals.filter((n) => feeds[n.id]?.mode === 'screen')
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const mine = useMemo<RailItem[]>(
    () =>
      entries.flatMap((e) => {
        if (e.kind !== 'user') return []
        const n = byId.get(e.terminalId)
        return [{ key: e.key, text: e.text, hasImages: Boolean(e.images?.length), to: n && { name: n.name, color: colorOf(n) } }]
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colorOf depende só de roles
    [entries, byId, roles]
  )

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [entries.length, busy.length])

  return (
    <>
      <header className="chat-head">
        <IconUsers size={15} className="muted" />
        <strong className="chat-name">{G.general}</strong>
        <span className="muted chat-preset">{G.generalHint}</span>
        <span className="spacer" />
        {terminals.length > 0 && (
          <button type="button" className="chat-head-btn with-icon" {...hint('chat.geral.novaTarefa')} onClick={askNewTask}>
            <IconRestart size={12} />
            {G.newTask}
          </button>
        )}
        <CloseButton />
      </header>
      {waiting.length > 0 && (
        <div className="chat-general-alerts">
          {waiting.map((n) => (
            <div key={n.id} className="chat-general-alert" role="alert">
              <span className="chat-tab-badge alert">!</span>
              <span>{G.needsYou(n.name)}</span>
              <span className="spacer" />
              <button type="button" className="btn btn-primary" {...hint('chat.geral.responder')} onClick={() => useChat.getState().selectTab(n.id)}>
                {G.answer}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={mine.length > 1 ? 'chat-scroll-wrap has-rail' : 'chat-scroll-wrap'}>
        <div
          className="chat-scroll"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
          }}
        >
          {terminals.length === 0 && <div className="chat-empty">{G.noAgents}</div>}
          {terminals.length > 0 && entries.length === 0 && <div className="chat-empty">{G.generalEmpty}</div>}
          {entries.map((e) => (
            <GeneralItem
              key={e.key}
              entry={e}
              node={byId.get(e.terminalId)}
              color={colorOf(byId.get(e.terminalId))}
              fromColor={colorOf(terminals.find((x) => x.name === e.from))}
            />
          ))}
          {busy.length > 0 && (
            <div className="chat-working">
              <span className="chat-spinner" aria-hidden="true" />
              {G.working(busy.map((n) => n.name).join(', '))}
            </div>
          )}
          {noTranscript.length > 0 && <div className="chat-note">{G.noTranscript(noTranscript.map((n) => n.name).join(', '))}</div>}
        </div>
        <MessageRail scroller={scroller} items={mine} />
      </div>
      <MentionComposer terminals={terminals} />
    </>
  )
}

const GeneralItem = memo(function GeneralItem({
  entry,
  node,
  color,
  fromColor
}: {
  entry: GeneralEntry
  node: TerminalNodeData | undefined
  color: string | undefined
  fromColor: string | undefined
}): React.JSX.Element | null {
  const name = node?.name ?? '?'
  if (entry.kind === 'user') {
    return (
      <div className="chat-user chat-general-user" data-user-key={entry.key}>
        <span className="chat-general-to">
          {G.youTo('')}
          <button
            type="button"
            className="chat-mention"
            style={color ? { color } : undefined}
            {...hintOf(PH.chatAbrirAgente(name))}
            onClick={() => node && useChat.getState().selectTab(node.id)}
          >
            @{name}
          </button>
        </span>
        {entry.text && <p>{entry.text}</p>}
        {entry.images && entry.images.length > 0 && (
          <div className="chat-thumbs">
            {entry.images.map((img, i) =>
              img.src ? (
                <img key={i} src={img.src} alt="" />
              ) : (
                <span key={i} className="chat-thumb-missing">
                  imagem
                </span>
              )
            )}
          </div>
        )}
      </div>
    )
  }
  if (entry.kind === 'helper' && entry.helper) return <HelperReport helper={entry.helper} report={entry.text} parent={name} />
  if (entry.kind === 'orq') {
    return (
      <div className="chat-handoff">
        <strong style={fromColor ? { color: fromColor } : undefined}>{entry.from}</strong>
        <span aria-hidden="true">→</span>
        <strong style={color ? { color } : undefined}>{name}</strong>
        <span className="chat-handoff-text">{entry.text}</span>
      </div>
    )
  }
  return (
    <article className="chat-general-msg">
      <button
        type="button"
        className="chat-avatar"
        style={avatarStyle(color)}
        {...hintOf(PH.chatAbrirAgente(name))}
        aria-label={name}
        onClick={() => node && useChat.getState().selectTab(node.id)}
      >
        {node ? <AgentFace node={node} color={color} /> : '?'}
      </button>
      <div className="chat-general-body">
        <strong className="chat-general-name" style={color ? { color } : undefined}>
          {name}
        </strong>
        <ChatMarkdown text={entry.text} />
      </div>
    </article>
  )
})

// ------------------------------------------------------------------ conversa de um agente

type Block = { kind: 'item'; item: ChatItem } | { kind: 'tools'; key: string; items: ToolItem[] }

function toBlocks(items: ChatItem[]): Block[] {
  const out: Block[] = []
  let run: ToolItem[] = []
  const flush = (): void => {
    if (run.length >= 3) out.push({ kind: 'tools', key: `g-${run[0]!.key}`, items: run })
    else run.forEach((item) => out.push({ kind: 'item', item }))
    run = []
  }
  for (const item of items) {
    if (item.kind === 'tool') run.push(item)
    else {
      flush()
      out.push({ kind: 'item', item })
    }
  }
  flush()
  return out
}

function Transcript({ node, feed, busy }: { node: TerminalNodeData; feed: Feed; busy: boolean }): React.JSX.Element {
  const working = busy && !feed.turnEnded
  const list = useMemo(() => feed.order.map((k) => feed.items[k]!).filter(Boolean), [feed.order, feed.items])
  const blocks = useMemo(() => toBlocks(list), [list])
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const mine = useMemo<RailItem[]>(() => list.flatMap((i) => (i.kind === 'user' ? [{ key: i.key, text: i.text, hasImages: i.images.length > 0 }] : [])), [list])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [blocks, working])

  return (
    <div className={mine.length > 1 ? 'chat-scroll-wrap has-rail' : 'chat-scroll-wrap'}>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        {feed.omitted > 0 && <div className="chat-note">{c.omitted}</div>}
        {list.length === 0 && <div className="chat-empty">{c.empty}</div>}
        {blocks.map((b) => (b.kind === 'tools' ? <ToolGroup key={b.key} items={b.items} /> : <ItemView key={b.item.key} item={b.item} />))}
        {working && (
          <div className="chat-working">
            <span className="chat-spinner" aria-hidden="true" />
            {c.working(node.name)}
          </div>
        )}
      </div>
      <MessageRail scroller={scroller} items={mine} />
    </div>
  )
}

const ItemView = memo(function ItemView({ item }: { item: ChatItem }): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <div className="chat-user" data-user-key={item.key}>
          {item.text && <p>{item.text}</p>}
          {item.images.length > 0 && (
            <div className="chat-thumbs">
              {item.images.map((img, i) =>
                img.src ? (
                  <img key={i} src={img.src} alt="" />
                ) : (
                  <span key={i} className="chat-thumb-missing">
                    imagem
                  </span>
                )
              )}
            </div>
          )}
        </div>
      )
    case 'orq':
      return (
        <div className="chat-orq">
          <span className="chat-orq-from">{c.from(item.from)}</span>
          <span className="chat-orq-text">{item.text}</span>
        </div>
      )
    case 'assistant':
      return <ChatMarkdown text={item.text} />
    case 'tool':
      return <ToolCard item={item} />
    case 'note':
      return <div className="chat-note">{item.text}</div>
    case 'helper':
      return item.role === 'call' ? <HelperCall item={item} /> : <HelperReport helper={item} report={item.report ?? ''} />
  }
})

function toolIcon(item: ToolItem): React.JSX.Element {
  if (!item.done) return <span className="chat-spinner" aria-hidden="true" />
  return item.error ? (
    <span className="chat-tool-err" aria-label={c.failed}>
      ✗
    </span>
  ) : (
    <span className="chat-tool-ok" aria-hidden="true">
      ✓
    </span>
  )
}

function ToolGroup({ items }: { items: ToolItem[] }): React.JSX.Element {
  const pending = items.some((i) => !i.done)
  const failed = items.some((i) => i.error)
  const last = items[items.length - 1]!
  return (
    <details className="chat-tool chat-tool-group">
      <summary {...hint('chat.acoes')}>
        {pending ? (
          <span className="chat-spinner" aria-hidden="true" />
        ) : failed ? (
          <span className="chat-tool-err">✗</span>
        ) : (
          <span className="chat-tool-ok">✓</span>
        )}
        <span className="chat-tool-title">{c.actions(items.length)}</span>
        <span className="chat-tool-detail">{last.title}</span>
      </summary>
      <div className="chat-tool-list">
        {items.map((i) => (
          <ToolCard key={i.key} item={i} nested />
        ))}
      </div>
    </details>
  )
}

function ToolCard({ item, nested = false }: { item: ToolItem; nested?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const short = item.detail && item.detail !== item.title ? item.detail.split('\n')[0] : ''
  return (
    <details className={`chat-tool${nested ? ' nested' : ''}`} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {toolIcon(item)}
        <span className="chat-tool-title">{item.title}</span>
        {short && <span className="chat-tool-detail">{short}</span>}
      </summary>
      {open && (
        <div className="chat-tool-body">
          {item.detail && item.detail.includes('\n') && <pre className="chat-pre">{item.detail}</pre>}
          {item.diff && (
            <div className="chat-diff">
              {item.diff.del.map((l, i) => (
                <div key={`d${i}`} className="del">
                  - {l}
                </div>
              ))}
              {item.diff.add.map((l, i) => (
                <div key={`a${i}`} className="add">
                  + {l}
                </div>
              ))}
            </div>
          )}
          {item.todos && (
            <ul className="chat-todos">
              {item.todos.map((td, i) => (
                <li key={i} className={td.status}>
                  {td.status === 'completed' ? '✓' : td.status === 'in_progress' ? '▸' : '○'} {td.text}
                </li>
              ))}
            </ul>
          )}
          {item.done && (
            <>
              <span className="chat-tool-label">{c.result}</span>
              <pre className={`chat-pre${item.error ? ' error' : ''}`}>{item.result?.trim() || c.noResult}</pre>
            </>
          )}
        </div>
      )}
    </details>
  )
}

const MD_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href && /^https?:\/\//i.test(href)) void api.invoke('app:openExternal', { url: href })
      }}
    >
      {children}
    </a>
  ),
  img: ({ alt }) => <span className="note-img-blocked">{alt || 'imagem'}</span>
}

const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="note-md chat-md">
      <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS} urlTransform={(url) => defaultUrlTransform(url)}>
        {text}
      </Markdown>
    </div>
  )
})

// ------------------------------------------------------------------ tela (shell...)

function ScreenView({ id }: { id: string }): React.JSX.Element {
  const [text, setText] = useState('')
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    let alive = true
    const tick = (): void => {
      void api
        .invoke('pty:readText', { id, lines: 400 })
        .then((s) => alive && setText(s))
        .catch(() => undefined)
    }
    tick()
    const timer = setInterval(tick, 800)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [id])
  useLayoutEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])
  return (
    <div className="chat-screen-wrap">
      <div className="chat-note">{c.screenNote}</div>
      <pre className="chat-screen" ref={ref}>
        {text}
      </pre>
    </div>
  )
}

// ------------------------------------------------------------------ pergunta esperando resposta

/** Lê a tela do terminal a cada segundo: perguntas com opções e (via onScreen) o modo de permissão. */
/** Identifica a pergunta na tela (com as marcações da múltipla escolha: marcar muda a pergunta). */
function choiceSig(c: PendingChoice): string {
  return `${c.question}|${c.options.map((o) => `${o.label}${o.checked ? '✔' : ''}`).join('|')}|${c.excerpt}`
}

function PendingChoiceCard({ id, onScreen }: { id: string; onScreen?: (screen: string) => void }): React.JSX.Element | null {
  const [choice, setChoice] = useState<PendingChoice | null>(null)
  const answered = useRef<string>('')
  const screenCb = useRef(onScreen)
  screenCb.current = onScreen
  useEffect(() => {
    let alive = true
    const tick = (): void => {
      void api
        .invoke('pty:readText', { id, lines: 40, screen: true })
        .then((screen) => {
          if (!alive) return
          screenCb.current?.(screen)
          const found = detectPendingChoice(screen)
          const sig = found ? choiceSig(found) : ''
          if (!found || sig === answered.current) setChoice(null)
          else {
            answered.current = ''
            setChoice(found)
          }
        })
        .catch(() => undefined)
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [id])
  if (!choice) return null
  const pick = (i: number, text?: string): void => {
    const steps = choiceSteps(choice, i, text)
    if (steps.length === 0) return
    answered.current = choiceSig(choice)
    // Uma tecla por vez: o menu do agente processa cada seta antes do texto e do Enter.
    steps.forEach((data, k) => setTimeout(() => api.send('pty:write', { id, data }), k * 60))
    setChoice(null)
  }
  return (
    <div className="chat-choice" role="alert">
      <strong>{c.waitingTitle}</strong>
      {choice.progress && <span className="chat-choice-progress">{choice.progress}</span>}
      {choice.excerpt && <pre className="chat-pre">{choice.excerpt}</pre>}
      <span className="chat-choice-q">{choice.question}</span>
      {choice.multi && <small className="chat-choice-hint">{c.multiHint}</small>}
      <div className="chat-choice-options">
        {choice.options.map((o, i) =>
          o.input ? (
            <FreeAnswer key={i} onSubmit={(text) => pick(i, text)} />
          ) : (
            <button
              type="button"
              key={i}
              className={`btn${(choice.multi ? o.submit : i === 0) ? ' btn-primary' : ''}`}
              {...(o.checked !== undefined ? { 'aria-pressed': o.checked } : {})}
              {...hintOf(PH.chatOpcao(o.submit ? c.multiSubmit : o.label))}
              onClick={() => pick(i)}
            >
              <span>
                {o.checked !== undefined && (
                  <span className="chat-choice-check" aria-hidden="true">
                    {o.checked ? '☑' : '☐'}
                  </span>
                )}
                {o.submit ? c.multiSubmit : o.label}
              </span>
              {o.detail && <small>{o.detail}</small>}
            </button>
          )
        )}
      </div>
      <button
        type="button"
        className="btn btn-ghost chat-choice-term"
        {...hint('chat.pergunta.abrirTerminal')}
        onClick={() => showOnCanvas(useChat.getState().dir ?? '', id)}
      >
        {c.openTerminal}
      </button>
    </div>
  )
}

/** Opção "Type something." do questionário: resposta escrita. */
function FreeAnswer({ onSubmit }: { onSubmit: (text: string) => void }): React.JSX.Element {
  const [text, setText] = useState('')
  return (
    <form
      className="chat-choice-free"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) onSubmit(text)
      }}
    >
      <input className="input" value={text} placeholder={c.freeAnswer} onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="btn" disabled={!text.trim()} {...hint('chat.pergunta.respostaLivre')}>
        {c.freeAnswerSend}
      </button>
    </form>
  )
}

// ------------------------------------------------------------------ campo de mensagem

interface Attachment {
  /** Imagem vai colada no terminal; PDF vai como caminho no texto (o agente abre). */
  kind: 'image' | 'pdf'
  path: string
  /** Miniatura: blob: da imagem ou a do PDF (data:, vazia até chegar). */
  url: string
  name: string
}

const revoke = (a: Attachment): void => {
  if (a.url.startsWith('blob:')) URL.revokeObjectURL(a.url)
}

/** Prints anexados a uma mensagem (arrastados, colados ou escolhidos). */
function useAttachments(): { atts: Attachment[]; addFiles: (files: File[]) => Promise<void>; remove: (i: number) => void; clear: () => void } {
  const [atts, setAtts] = useState<Attachment[]>([])
  const toast = useApp((s) => s.toast)
  // Libera as miniaturas (blob:) ao fechar o chat com anexos não enviados.
  const attsRef = useRef(atts)
  attsRef.current = atts
  useEffect(() => () => attsRef.current.forEach(revoke), [])

  const addFiles = async (files: File[]): Promise<void> => {
    let usedClipboard = false
    for (const f of files) {
      if (isPdf(f.name, f.type)) {
        const path = api.pathForFile(f)
        if (!path) {
          toast('warn', c.pdfNoPath(f.name))
          continue
        }
        if (attsRef.current.some((a) => a.path === path)) continue
        setAtts((prev) => [...prev, { kind: 'pdf', path, url: '', name: f.name || path.split(/[\\/]/).pop() || 'documento.pdf' }])
        void api
          .invoke('chat:fileThumb', { path })
          .then((url) => url && setAtts((prev) => prev.map((a) => (a.kind === 'pdf' && a.path === path ? { ...a, url } : a))))
          .catch(() => undefined)
        continue
      }
      if (!f.type.startsWith('image/') && !IMAGE_FILE.test(f.name)) {
        toast('warn', c.attachUnsupported(f.name))
        continue
      }
      let p = api.pathForFile(f)
      if (!p && !usedClipboard) {
        // Print (sem arquivo): o processo principal grava a imagem da área de transferência.
        usedClipboard = true
        p = (await api.invoke('clipboard:saveImage').catch(() => null)) ?? ''
      }
      if (!p) {
        toast('warn', c.imageNotSaved)
        continue
      }
      const path = p
      setAtts((prev) => [...prev, { kind: 'image', path, url: URL.createObjectURL(f), name: f.name || path.split(/[\\/]/).pop() || 'imagem' }])
    }
  }
  const remove = (i: number): void =>
    setAtts((prev) => {
      revoke(prev[i]!)
      return prev.filter((_, j) => j !== i)
    })
  const clear = (): void => {
    attsRef.current.forEach(revoke)
    setAtts([])
  }
  return { atts, addFiles, remove, clear }
}

function attachmentPaths(atts: Attachment[]): { images: string[]; files: string[] } {
  return { images: atts.filter((a) => a.kind === 'image').map((a) => a.path), files: atts.filter((a) => a.kind === 'pdf').map((a) => a.path) }
}

function pastedFiles(e: React.ClipboardEvent): File[] {
  // Um print chega como item da área de transferência (não em `files`).
  if (e.clipboardData.getData('text/plain')) return []
  return Array.from(e.clipboardData.items)
    .filter((i) => i.kind === 'file')
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null)
}

function AttachmentList({ atts, remove }: { atts: Attachment[]; remove: (i: number) => void }): React.JSX.Element | null {
  if (atts.length === 0) return null
  return (
    <div className="chat-atts">
      {atts.map((a, i) => (
        <div key={`${a.kind}:${a.path}`} className={a.kind === 'pdf' ? 'chat-att pdf' : 'chat-att'} title={a.path}>
          {a.url ? <img src={a.url} alt={a.name} /> : <span className="chat-att-pdf">PDF</span>}
          {a.kind === 'pdf' && <span className="chat-att-name">{a.name}</span>}
          <button type="button" aria-label={c.removeImage(a.name)} {...hint('chat.removerAnexo')} onClick={() => remove(i)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

function useAutoHeight(text: string): React.RefObject<HTMLTextAreaElement | null> {
  const area = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])
  return area
}

interface ComposerProps {
  node: TerminalNodeData
  running: boolean
  busy: boolean
  transcript: boolean
  agent: ChatAgent | null
  meta: ChatMeta
  /** Modo lido da linha de status do terminal (atual); o do histórico é o da última mensagem. */
  liveMode: string | null
}

function Composer({ node, running, busy, transcript, agent, meta, liveMode }: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const { atts, addFiles, remove, clear } = useAttachments()
  const [sending, setSending] = useState(false)
  const area = useAutoHeight(text)
  const toast = useApp((s) => s.toast)

  const send = async (): Promise<void> => {
    if (sending || !running || (!text.trim() && atts.length === 0)) return
    setSending(true)
    try {
      useChat.getState().markSent(node.id)
      await api.invoke('chat:send', { id: node.id, text, ...attachmentPaths(atts) })
      clear()
      setText('')
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setSending(false)
      area.current?.focus()
    }
  }

  return (
    <div
      className="chat-composer"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        void addFiles(Array.from(e.dataTransfer.files))
      }}
    >
      {!running && <div className="chat-note">{c.notRunning(node.name)}</div>}
      <AttachmentList atts={atts} remove={remove} />
      <div className="chat-input-row">
        <textarea
          ref={area}
          id="chat-input"
          rows={1}
          value={text}
          placeholder={c.placeholder(node.name)}
          disabled={!running}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = pastedFiles(e)
            if (files.length === 0) return
            e.preventDefault()
            void addFiles(files)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button type="button" className="chat-send" aria-label={c.send} {...hint('chat.enviar')} disabled={!running || sending} onClick={() => void send()}>
          ↑
        </button>
      </div>
      <div className="chat-tools-row">
        <label className="chat-chip" {...hint('chat.anexar')}>
          {c.attach}
          <input
            type="file"
            accept="image/*,.pdf,application/pdf"
            multiple
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </label>
        {transcript && meta.model && (
          <span className="chat-chip static" {...hint('chat.modelo')}>
            {modelLabel(meta.model)}
            {meta.effort ? ` · ${c.effort(meta.effort)}` : ''}
          </span>
        )}
        {agent === 'codex' && meta.permissionMode && (
          <span className="chat-chip static" {...hint('chat.aprovacaoCodex')}>
            {c.mode(meta.permissionMode)}
          </span>
        )}
        {agent === 'claude' && running && (
          <button type="button" className="chat-chip mode" {...hint('chat.modo')} onClick={() => api.send('pty:write', { id: node.id, data: '\x1b[Z' })}>
            {c.mode(liveMode ?? meta.permissionMode ?? '')}
          </button>
        )}
        <span className="chat-hint">{c.hint}</span>
        {busy && (
          <button type="button" className="chat-chip danger" {...hint('chat.parar')} onClick={() => api.send('pty:write', { id: node.id, data: '\x1b' })}>
            {c.interrupt}
          </button>
        )}
      </div>
    </div>
  )
}

/** Campo do chat geral: "@agente texto" (vários: "@dev @qa …"); sem @, vai para o último destinatário. */
function MentionComposer({ terminals }: { terminals: TerminalNodeData[] }): React.JSX.Element {
  const [text, setText] = useState('')
  const { atts, addFiles, remove, clear } = useAttachments()
  const [sending, setSending] = useState(false)
  const area = useAutoHeight(text)
  const toast = useApp((s) => s.toast)
  const roles = useApp((s) => s.config?.roles)
  const generalTo = useChat((s) => s.generalTo)
  const names = terminals.map((n) => n.name)
  const fallback = terminals.find((n) => n.id === generalTo) ?? terminals[0]
  const { targets } = parseMentions(text, names)
  const recipients = targets.length > 0 ? targets.map((n) => terminals.find((x) => x.name === n)!).filter(Boolean) : fallback ? [fallback] : []
  // Lista de agentes ao digitar @: setas escolhem, Enter/Tab completam, Esc fecha (até digitar de novo).
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const query = mentionQuery(text)
  const suggestions = query === null || dismissed === text ? [] : terminals.filter((n) => n.name.toLowerCase().startsWith(query.toLowerCase()))
  const selected = suggestions.length > 0 ? Math.min(active, suggestions.length - 1) : 0
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected, suggestions.length])
  const colorOf = (n: TerminalNodeData): string | undefined => roles?.find((r) => r.id === n.roleId)?.color || undefined

  const complete = (n: TerminalNodeData): void => {
    setText((cur) => cur.replace(/@[\p{L}\p{N}._-]*$/u, `@${n.name} `))
    area.current?.focus()
  }

  const send = async (): Promise<void> => {
    const { body } = parseMentions(text, names)
    if (sending || recipients.length === 0 || (!body && atts.length === 0)) {
      if (recipients.length === 0) toast('warn', G.noTarget)
      return
    }
    setSending(true)
    const ok: string[] = []
    for (const n of recipients) {
      try {
        useChat.getState().markSent(n.id)
        await api.invoke('chat:send', { id: n.id, text: body, ...attachmentPaths(atts) })
        ok.push(n.name)
      } catch (err) {
        toast('error', `${n.name}: ${errorMessage(err)}`)
      }
    }
    if (ok.length > 0) {
      const last = recipients[recipients.length - 1]!
      useChat.getState().setGeneralTo(last.id)
      clear()
      setText('')
    }
    setSending(false)
    area.current?.focus()
  }

  return (
    <div
      className="chat-composer chat-mention-composer"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        void addFiles(Array.from(e.dataTransfer.files))
      }}
    >
      {suggestions.length > 0 && (
        <div className="chat-suggest" role="listbox" aria-label={G.mentionHint} ref={listRef} id="chat-suggest-list">
          {suggestions.map((n, i) => (
            <button
              type="button"
              role="option"
              id={`chat-suggest-${n.id}`}
              aria-selected={i === selected}
              key={n.id}
              tabIndex={-1}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => complete(n)}
            >
              <span className="chat-avatar small" style={avatarStyle(colorOf(n))} aria-hidden="true">
                <AgentFace node={n} color={colorOf(n)} />
              </span>
              <strong>@{n.name}</strong>
              <span className="muted">{roles?.find((r) => r.id === n.roleId)?.name ?? ''}</span>
            </button>
          ))}
        </div>
      )}
      <div className="chat-to-row" {...hint('chat.geral.para')}>
        <span>{G.to}</span>
        {recipients.map((n) => (
          <span key={n.id} className="chat-to-pill" style={colorOf(n) ? { borderColor: colorOf(n), color: colorOf(n) } : undefined}>
            @{n.name}
          </span>
        ))}
      </div>
      <AttachmentList atts={atts} remove={remove} />
      <div className="chat-input-row">
        <textarea
          ref={area}
          id="chat-general-input"
          rows={1}
          value={text}
          placeholder={G.placeholder}
          disabled={terminals.length === 0}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls="chat-suggest-list"
          aria-autocomplete="list"
          aria-activedescendant={suggestions[selected] ? `chat-suggest-${suggestions[selected]!.id}` : undefined}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = pastedFiles(e)
            if (files.length === 0) return
            e.preventDefault()
            void addFiles(files)
          }}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const step = e.key === 'ArrowDown' ? 1 : -1
                setActive((selected + step + suggestions.length) % suggestions.length)
                return
              }
              // Tab (ou Enter) com a lista aberta completa o nome do agente escolhido.
              if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
                e.preventDefault()
                complete(suggestions[selected]!)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setDismissed(text)
                return
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button
          type="button"
          className="chat-send"
          aria-label={c.send}
          {...hint('chat.geral.enviar')}
          disabled={sending || terminals.length === 0}
          onClick={() => void send()}
        >
          ↑
        </button>
      </div>
      <div className="chat-tools-row">
        <label className="chat-chip" {...hint('chat.anexar')}>
          {c.attach}
          <input
            type="file"
            accept="image/*,.pdf,application/pdf"
            multiple
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </label>
        <span className="chat-hint">{G.mentionHint}</span>
      </div>
    </div>
  )
}
