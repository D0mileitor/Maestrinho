import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import { useChat } from '../store/chatStore'
import { api } from '../lib/api'
import { MarkdownView, noteErrorMessage, onNoteChanged, resolveNoteLink, sameFile, scrollToAnchor } from '../nodes/NoteNode'
import { t } from '../i18n'

const c = t.chat

type ReadState = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'error'; message: string }

/** Pausa antes de reler a nota (o agente costuma gravar várias vezes seguidas). */
const RELOAD_MS = 150

/**
 * Leitura de uma nota no painel lateral (clique num quadro do escritório). Só leitura: atualiza sozinha
 * quando um agente ou o canvas grava o arquivo; para editar, "Ver no canvas".
 */
export function NoteReader({ dir, file, missingHint }: { dir: string; file: string; missingHint?: string }): React.JSX.Element {
  const [state, setState] = useState<ReadState>({ status: 'loading' })
  const scrollRef = useRef<HTMLDivElement>(null)
  const toast = useApp((s) => s.toast)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    setState({ status: 'loading' })
    const load = (): void => {
      api
        .invoke('notes:read', { dir, file })
        .then((text) => alive && setState({ status: 'ready', text: text.replace(/\r\n?/g, '\n') }))
        .catch((err) => alive && setState({ status: 'error', message: noteErrorMessage(err) }))
    }
    load()
    const off = onNoteChanged(dir, file, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, RELOAD_MS)
    })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      off()
    }
  }, [dir, file])

  const openLink = (href: string): void => {
    if (!href) return
    if (href.startsWith('#')) {
      scrollToAnchor(scrollRef.current, href.slice(1))
      return
    }
    if (/^(?:https?:|mailto:)/i.test(href)) {
      void api.invoke('app:openExternal', { url: href }).catch((err) => toast('error', noteErrorMessage(err)))
      return
    }
    const target = resolveNoteLink(file, href)
    const node = target ? useApp.getState().active?.doc.nodes.find((n) => n.kind === 'note' && sameFile(n.file, target)) : undefined
    // Nota que não está no canvas (ex.: um chamado do histórico): abre direto pelo caminho.
    if (node) useChat.getState().openNote(dir, node.id)
    else if (target) useChat.getState().openNoteFile(dir, target)
    else toast('info', c.noteLinkUnsupported)
  }

  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    const blocked = target.closest<HTMLElement>('[data-href]')
    const link = blocked ? null : target.closest('a')
    if (!blocked && !link) return
    e.preventDefault()
    openLink(blocked ? (blocked.dataset['href'] ?? '') : (link?.getAttribute('href') ?? ''))
  }

  return (
    <div className="chat-reader" ref={scrollRef} onClick={onClick}>
      {state.status === 'loading' ? (
        <div className="chat-empty">{c.loading}</div>
      ) : state.status === 'error' ? (
        <div className="chat-empty">{missingHint && /não existe/.test(state.message) ? missingHint : state.message}</div>
      ) : /\S/.test(state.text) ? (
        <MarkdownView text={state.text} />
      ) : (
        <div className="chat-empty">{c.noteEmpty}</div>
      )}
    </div>
  )
}
