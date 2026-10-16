import { memo, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { PortalRFNode } from '../canvas/types'
import { HEADER_H } from '../canvas/types'
import { NodeFrame } from './NodeFrame'
import { useApp } from '../store/appStore'
import { useSettledZoom } from '../canvas/bridge'
import { IconBack, IconBot, IconForward, IconGlobe, IconRestart, IconClose } from '../lib/icons'
import { api } from '../lib/api'
import { hint } from '../hints/hint'

/** Subconjunto da API do <webview> do Electron usado aqui. */
interface WebviewElement extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  getURL(): string
  getTitle(): string
  loadURL(url: string): Promise<void>
  getWebContentsId(): number
}

/** Normaliza o que o usuário digitou: aceita "exemplo.com" (vira https://exemplo.com). */
export function normalizePortalUrl(input: string): string | null {
  const v = input.trim()
  if (!v) return null
  if (v === 'about:blank') return v
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`
  try {
    const u = new URL(withProto)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

/**
 * Portal: navegador embutido (Electron <webview>) na partição isolada `persist:portals`, sem
 * preload e sem Node (o main reforça isso em will-attach-webview). Só http(s).
 */
function PortalNodeImpl({ id, data, selected, width, height }: NodeProps<PortalRFNode>): React.JSX.Element {
  const node = data.node
  const updateNode = useApp((s) => s.updateNode)
  const confirmRemove = useApp((s) => s.confirmRemoveNodes)
  const zoom = useSettledZoom((s) => s.zoom)
  const ref = useRef<WebviewElement | null>(null)
  const [address, setAddress] = useState(node.url)
  const [nav, setNav] = useState({ back: false, forward: false, loading: false })
  const [error, setError] = useState<string | null>(null)
  const initialSrc = useRef(normalizePortalUrl(node.url) ?? 'about:blank')
  const w = width ?? node.size.w
  const h = height ?? node.size.h

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    const refresh = (): void => {
      try {
        setNav((n) => ({ ...n, back: wv.canGoBack(), forward: wv.canGoForward() }))
      } catch {
        // webview ainda não anexado
      }
    }
    const onNavigate = (): void => {
      const url = wv.getURL()
      setAddress(url)
      setError(null)
      refresh()
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        const title = wv.getTitle()
        if (url && url !== node.url) updateNode(id, { url, title: title || undefined })
      }, 800)
    }
    const onStart = (): void => setNav((n) => ({ ...n, loading: true }))
    const onStop = (): void => {
      setNav((n) => ({ ...n, loading: false }))
      refresh()
    }
    const onFail = (e: Event): void => {
      const ev = e as Event & { errorDescription?: string; isMainFrame?: boolean; errorCode?: number }
      if (ev.isMainFrame === false || ev.errorCode === -3) return
      setError(ev.errorDescription || 'Falha ao carregar a página')
    }
    // O main passa a saber qual página é deste portal (para o orq portal dos agentes, se liberado).
    const onReady = (): void => {
      try {
        api.send('portal:attach', { id, webContentsId: wv.getWebContentsId() })
      } catch {
        // webview ainda não anexado
      }
    }
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigate)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      if (saveTimer) clearTimeout(saveTimer)
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavigate)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-fail-load', onFail)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const go = (): void => {
    const url = normalizePortalUrl(address)
    if (!url) {
      setError('Endereço inválido (use http:// ou https://)')
      return
    }
    setError(null)
    void ref.current?.loadURL(url).catch(() => undefined)
  }

  const header = (
    <>
      <IconGlobe size={14} />
      <span className="node-name" title={node.url}>
        {node.title || hostOf(node.url)}
      </span>
      <span className="node-header-spacer" />
      <button
        className={`icon-btn nodrag portal-agents${node.agentAccess ? ' on' : ''}`}
        {...hint(node.agentAccess ? 'no.portal.agentesLigado' : 'no.portal.agentes')}
        aria-label="Agentes conectados podem usar este portal"
        aria-pressed={node.agentAccess === true}
        onClick={() => updateNode(id, { agentAccess: !node.agentAccess })}
      >
        <IconBot size={14} />
      </button>
      <button
        className="icon-btn danger nodrag"
        {...hint('no.portal.fechar')}
        aria-label="Fechar portal"
        onClick={() => confirmRemove([id])}
      >
        <IconClose size={14} />
      </button>
    </>
  )

  return (
    <NodeFrame id={id} kind="portal" selected={selected} minWidth={260} minHeight={180} header={header}>
      <div className="portal-bar nodrag">
        <button className="icon-btn" disabled={!nav.back} {...hint('no.portal.voltar')} aria-label="Voltar" onClick={() => ref.current?.goBack()}>
          <IconBack size={13} />
        </button>
        <button className="icon-btn" disabled={!nav.forward} {...hint('no.portal.avancar')} aria-label="Avançar" onClick={() => ref.current?.goForward()}>
          <IconForward size={13} />
        </button>
        <button className="icon-btn" {...hint('no.portal.recarregar')} aria-label="Recarregar" onClick={() => ref.current?.reload()}>
          <IconRestart size={13} />
        </button>
        <input
          className="input portal-address"
          value={address}
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') go()
          }}
        />
      </div>
      <div className="portal-body nodrag nowheel" style={{ height: Math.max(40, h - HEADER_H - 34) }}>
        {/* O atributo partition é imposto pelo main; aqui só por clareza. */}
        <webview
          ref={(el: HTMLElement | null) => {
            ref.current = el as WebviewElement | null
          }}
          className="portal-webview"
          src={initialSrc.current}
          partition="persist:portals"
          style={{ width: Math.max(40, w - 2), height: '100%' }}
        />
        {error && <div className="portal-error">{error}</div>}
        {zoom < 0.4 && <div className="term-lowzoom">{hostOf(node.url)}</div>}
      </div>
    </NodeFrame>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export const PortalNode = memo(PortalNodeImpl)
