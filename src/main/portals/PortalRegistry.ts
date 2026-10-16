import { session, webContents, type WebContents } from 'electron'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { PORTAL_PARTITION } from '../window'

/** Texto de página entregue a um agente (o resto é cortado). */
const MAX_TEXT = 60_000
/** Mundo isolado (o JS da página não alcança nem altera o que lemos). */
const ISOLATED_WORLD = 1009
const LOAD_TIMEOUT_MS = 20_000

/** O que os agentes podem fazer com um portal liberado (usado pela API local). */
export interface PortalApi {
  read(nodeId: string): Promise<{ url: string; title: string; text: string; truncated: boolean }>
  capture(nodeId: string, file: string): Promise<{ url: string; title: string; width: number; height: number }>
  open(nodeId: string, url: string): Promise<{ url: string; title: string }>
}

/**
 * Página (webContents do <webview>) de cada nó de portal. O renderer informa o id quando a página
 * carrega; aqui só é aceito um webview da janela principal na partição dos portais.
 */
export class PortalRegistry implements PortalApi {
  private readonly byNode = new Map<string, number>()

  constructor(private readonly host: () => WebContents | null) {}

  attach(nodeId: string, webContentsId: number): boolean {
    const wc = webContents.fromId(webContentsId)
    const host = this.host()
    if (!wc || wc.isDestroyed() || !host || wc.getType() !== 'webview') return false
    if (wc.hostWebContents?.id !== host.id || wc.session !== session.fromPartition(PORTAL_PARTITION)) return false
    this.byNode.set(nodeId, webContentsId)
    return true
  }

  private page(nodeId: string): WebContents {
    const id = this.byNode.get(nodeId)
    const wc = id === undefined ? undefined : webContents.fromId(id)
    if (!wc || wc.isDestroyed()) {
      this.byNode.delete(nodeId)
      throw new Error('o portal não está aberto no canvas agora (abra o workspace e o andar dele)')
    }
    return wc
  }

  async read(nodeId: string): Promise<{ url: string; title: string; text: string; truncated: boolean }> {
    const wc = this.page(nodeId)
    const raw: unknown = await wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: 'document.body ? document.body.innerText : ""' }])
    const text = typeof raw === 'string' ? raw.replace(/\n{3,}/g, '\n\n').trim() : ''
    return { url: wc.getURL(), title: wc.getTitle(), text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT }
  }

  async capture(nodeId: string, file: string): Promise<{ url: string; title: string; width: number; height: number }> {
    const wc = this.page(nodeId)
    const image = await wc.capturePage()
    if (image.isEmpty()) throw new Error('o portal não tem nada desenhado para capturar (está carregando ou fora da tela)')
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, image.toPNG())
    const size = image.getSize()
    return { url: wc.getURL(), title: wc.getTitle(), width: size.width, height: size.height }
  }

  async open(nodeId: string, url: string): Promise<{ url: string; title: string }> {
    if (!/^https?:\/\//i.test(url)) throw new Error('só endereços http:// ou https://')
    const wc = this.page(nodeId)
    await new Promise<void>((resolve, reject) => {
      const done = (): void => {
        clearTimeout(timer)
        wc.off('did-finish-load', done)
        wc.off('did-fail-load', fail)
        resolve()
      }
      const fail = (_e: unknown, code: number, description: string, _url: string, isMainFrame: boolean): void => {
        // Abortado (-3) é redirecionamento ou outra navegação; só o quadro principal importa.
        if (!isMainFrame || code === -3) return
        clearTimeout(timer)
        wc.off('did-finish-load', done)
        wc.off('did-fail-load', fail)
        reject(new Error(`a página não carregou (${description || code})`))
      }
      const timer = setTimeout(done, LOAD_TIMEOUT_MS)
      wc.on('did-finish-load', done)
      wc.on('did-fail-load', fail)
      wc.loadURL(url).catch(() => undefined)
    })
    return { url: wc.getURL(), title: wc.getTitle() }
  }
}
