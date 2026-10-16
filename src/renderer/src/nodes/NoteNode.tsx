import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { NodeProps } from '@xyflow/react'
import Markdown, { defaultUrlTransform, type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { NOTES_DIR, WORKSPACE_META_DIR } from '@shared/constants'
import type { InvokeMap } from '@shared/ipc'
import type { NoteRFNode } from '../canvas/types'
import { useSettledZoom } from '../canvas/bridge'
import { useApp } from '../store/appStore'
import { NodeFrame } from './NodeFrame'
import { IconClose, IconEdit, IconEye, IconFolder, IconNote } from '../lib/icons'
import { api } from '../lib/api'
import { notesStrings } from '../i18n/notes'
import { hint, hintOf } from '../hints/hint'
import type { HintText } from '../hints/content'
import { hintText } from '../i18n/hints'
import '../styles/notes.css'

const s = notesStrings.node

/** Tamanho mínimo do nó de nota (também usado pelo diálogo de criação). */
export const NOTE_MIN_SIZE = { w: 220, h: 120 } as const

const AUTOSAVE_MS = 600
/** Intervalo mínimo entre recargas seguidas (agente anotando várias linhas por segundo). */
const RELOAD_GAP_MS = 80
/** Abaixo desta largura o cabeçalho mostra só ícones. */
const COMPACT_WIDTH = 360

// ------------------------------------------------------------------ helpers

/**
 * Erro do IPC das notas: "Error invoking remote method 'notes:x': Error: [código] mensagem".
 * O main põe o código da API entre colchetes (ver main/notes/ipc.ts).
 */
function parseNoteError(err: unknown): { code: string | null; message: string } {
  const raw = err instanceof Error ? err.message : String(err)
  const cleaned = raw.replace(/^Error invoking remote method '[^']+': /, '').replace(/^[A-Za-z]*Error: /, '')
  const m = /^\[([a-z_]+)\]\s*([\s\S]*)$/.exec(cleaned)
  return m ? { code: m[1]!, message: m[2]! } : { code: null, message: cleaned }
}

/** Mensagem legível de um erro do IPC das notas (sem prefixos técnicos). */
export function noteErrorMessage(err: unknown): string {
  return parseNoteError(err).message
}

/** O <textarea> sempre usa "\n": o editor trabalha com LF. */
function toEditorText(disk: string): string {
  return disk.includes('\r') ? disk.replace(/\r\n?/g, '\n') : disk
}

/** Volta ao estilo de quebra do arquivo (CRLF se o arquivo usava CRLF). */
function toDiskText(editor: string, base: string): string {
  return base.includes('\r\n') ? editor.replace(/\n/g, '\r\n') : editor
}

/** Mesma revisão do main: 16 primeiros hex do SHA-256 do texto em UTF-8. */
async function revisionOf(text: string): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return undefined
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined
  }
}

export function sameFile(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase()
}

/** Alterna "[ ]" / "[x]" do item de lista cujo marcador começa em `offset` no texto. */
function toggleTaskAt(text: string, offset: number): string | null {
  if (!Number.isInteger(offset) || offset < 0 || offset >= text.length) return null
  const m = /^(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\]/.exec(text.slice(offset, offset + 80))
  if (!m) return null
  const at = offset + m[0].length - 2
  return text.slice(0, at) + (m[1] === ' ' ? 'x' : ' ') + text.slice(at + 1)
}

/** Link relativo para outra nota (ex.: "planos/sprint.md"), resolvido a partir da nota atual. */
export function resolveNoteLink(current: string, href: string): string | null {
  const clean = href.split('#')[0]!.split('?')[0]!
  if (!clean || !/\.md$/i.test(clean)) return null
  try {
    const base = `https://notas.invalid/${current.split('/').map(encodeURIComponent).join('/')}`
    const url = new URL(clean, base)
    if (url.host !== 'notas.invalid') return null
    return decodeURIComponent(url.pathname.slice(1)) || null
  } catch {
    return null
  }
}

/** Identificador no estilo do GitHub para títulos (links "#minha-secao"). */
function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/** Rola até uma âncora dentro da própria nota (sem mexer no canvas, que usa transformações). */
export function scrollToAnchor(container: HTMLElement | null, rawId: string): void {
  if (!container) return
  let id = rawId
  try {
    id = decodeURIComponent(rawId)
  } catch {
    // mantém o texto original
  }
  let el =
    container.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ??
    container.querySelector<HTMLElement>(`[id="${CSS.escape(`user-content-${id}`)}"]`)
  if (!el) {
    const wanted = headingSlug(id)
    const headings = [...container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')]
    el = headings.find((h) => headingSlug(h.textContent ?? '') === wanted) ?? null
  }
  if (!el) return
  const box = container.getBoundingClientRect()
  const scale = box.height / (container.offsetHeight || 1) || 1
  const top = (el.getBoundingClientRect().top - box.top) / scale + container.scrollTop
  container.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' })
}

/** Coloca o cursor à vista (aproximação por linhas; o textarea quebra linhas longas). */
function scrollCaretIntoView(ta: HTMLTextAreaElement, pos: number): void {
  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20
  const line = ta.value.slice(0, pos).split('\n').length - 1
  ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 3)
}

/** Insere texto no cursor preservando o desfazer (Ctrl+Z) do textarea. */
function insertText(ta: HTMLTextAreaElement, text: string): void {
  const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

// ------------------------------------------------------------------ eventos de alteração (um ouvinte IPC só)

type ChangeHandler = () => void
const changeHandlers = new Map<string, Set<ChangeHandler>>()
let stopChangeListener: (() => void) | null = null

function changeKey(dir: string, file: string): string {
  return `${dir}\n${file.toLowerCase()}`
}

/** Assina "note:changed" para uma nota; todos os nós compartilham um único ouvinte IPC. */
export function onNoteChanged(dir: string, file: string, fn: ChangeHandler): () => void {
  const key = changeKey(dir, file)
  let set = changeHandlers.get(key)
  if (!set) {
    set = new Set()
    changeHandlers.set(key, set)
  }
  set.add(fn)
  if (!stopChangeListener) {
    stopChangeListener = api.on('note:changed', (e) => {
      const handlers = changeHandlers.get(changeKey(e.dir, e.file))
      if (handlers) for (const h of [...handlers]) h()
    })
  }
  return () => {
    set.delete(fn)
    if (set.size === 0) changeHandlers.delete(key)
    if (changeHandlers.size === 0 && stopChangeListener) {
      stopChangeListener()
      stopChangeListener = null
    }
  }
}

// ------------------------------------------------------------------ pedido de edição (nota recém-criada)

const editRequests = new Set<string>()

/** Pede que o nó de nota `id` abra já no modo de edição, com o foco no editor. */
export function requestNoteEdit(id: string): void {
  editRequests.add(id)
}

// ------------------------------------------------------------------ controlador (estado + E/S de uma nota)

type NoteStatus = 'loading' | 'ready' | 'missing' | 'error'
type NoteConflict = 'changed' | 'removed' | null

interface NoteSnapshot {
  status: NoteStatus
  /** Texto exibido/editado (quebras "\n"). */
  text: string
  /** Há alterações locais ainda não gravadas. */
  dirty: boolean
  saveError: string
  readError: string
  conflict: NoteConflict
  /** Último conteúdo visto antes de o arquivo sumir (restaurado por "Recriar arquivo"). */
  lastSeen: string
}

const LOADING: NoteSnapshot = {
  status: 'loading',
  text: '',
  dirty: false,
  saveError: '',
  readError: '',
  conflict: null,
  lastSeen: ''
}

interface NoteControllerHooks {
  /** O arquivo foi recriado com outro nome (o original foi ocupado nesse meio-tempo). */
  onRenamed(file: string): void
  /** Erro que precisa de aviso fora do nó (gravação final depois de o nó sair da tela). */
  onError(message: string): void
}

/**
 * Estado e E/S de uma nota, fora do React: leitura, recarga quando o arquivo muda por fora,
 * gravação automática com `ifRevision` (nunca sobrescreve uma alteração externa não vista) e
 * resolução de conflitos.
 */
class NoteController {
  private snap: NoteSnapshot = LOADING
  private readonly listeners = new Set<() => void>()
  /** Conteúdo em disco conhecido, no formato do arquivo; null = ausente ou ainda não lido. */
  private base: string | null = null
  private baseRev: { text: string; rev: string } | null = null
  private draft = ''
  private diskOnConflict: string | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saveQueue: Promise<void> = Promise.resolve()
  /** Conteúdo da gravação em andamento: o eco dela não é "mudança externa". */
  private sending: string | null = null
  private reloading = false
  private reloadAgain = false
  private disposed = false

  constructor(
    readonly dir: string,
    readonly file: string,
    private readonly hooks: NoteControllerHooks
  ) {}

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  readonly getSnapshot = (): NoteSnapshot => this.snap

  private update(patch: Partial<NoteSnapshot>): void {
    if (this.disposed) return
    this.snap = { ...this.snap, ...patch, dirty: this.isDirty() }
    for (const fn of this.listeners) fn()
  }

  private isDirty(): boolean {
    return this.draft !== toEditorText(this.base ?? '')
  }

  private setBase(text: string | null): void {
    this.base = text
    if (text === null) {
      this.baseRev = null
      return
    }
    if (this.baseRev?.text === text) return
    void revisionOf(text).then((rev) => {
      if (rev && this.base === text) this.baseRev = { text, rev }
    })
  }

  private async baseRevision(base: string): Promise<string | undefined> {
    if (this.baseRev?.text === base) return this.baseRev.rev
    const rev = await revisionOf(base)
    if (rev && this.base === base) this.baseRev = { text: base, rev }
    return rev
  }

  private writeRequest(content: string, ifRevision: string | undefined): InvokeMap['notes:write']['req'] {
    // `ifRevision` é aceito pelo main (NoteWriteIpcReq em main/notes/ipc.ts), embora ainda não
    // conste do tipo do contrato IPC.
    const req: InvokeMap['notes:write']['req'] & { ifRevision?: string } = { dir: this.dir, file: this.file, content }
    if (ifRevision) req.ifRevision = ifRevision
    return req
  }

  start(): void {
    void this.load()
  }

  private async read(): Promise<string> {
    return api.invoke('notes:read', { dir: this.dir, file: this.file })
  }

  private async load(): Promise<void> {
    try {
      this.acceptDisk(await this.read())
    } catch (err) {
      const e = parseNoteError(err)
      if (e.code === 'not_found') this.acceptMissing()
      else this.update({ status: 'error', readError: e.message })
    }
  }

  retry(): void {
    this.update({ status: 'loading', readError: '' })
    void this.load()
  }

  /** Conteúdo atual do disco chegou (leitura inicial ou recarga). */
  private acceptDisk(content: string): void {
    if (this.disposed) return
    // Nada de novo, ou eco da nossa própria gravação em andamento.
    if (content === this.base || (this.sending !== null && content === this.sending)) {
      if (this.snap.status !== 'ready') this.update({ status: 'ready', readError: '' })
      return
    }
    if (!this.isDirty() || toEditorText(content) === this.draft) {
      this.setBase(content)
      this.draft = toEditorText(content)
      this.diskOnConflict = null
      this.update({ status: 'ready', text: this.draft, readError: '', conflict: null })
      return
    }
    // Alterações locais não gravadas + mudança externa: o usuário decide (sem sobrescrever nada).
    this.cancelSave()
    this.diskOnConflict = content
    this.update({ status: 'ready', conflict: 'changed' })
  }

  /** O arquivo não existe (removido por fora ou nunca criado). */
  private acceptMissing(): void {
    if (this.disposed) return
    if (this.snap.status === 'ready' && this.isDirty()) {
      this.cancelSave()
      this.diskOnConflict = null
      this.update({ conflict: 'removed' })
      return
    }
    const lastSeen = this.draft || this.snap.lastSeen
    this.setBase(null)
    this.draft = ''
    this.diskOnConflict = null
    this.update({ status: 'missing', text: '', conflict: null, lastSeen })
  }

  /** "note:changed" para este arquivo: recarrega (uma leitura por vez, a última vence). */
  externalChange(): void {
    if (this.disposed) return
    if (this.reloading) {
      this.reloadAgain = true
      return
    }
    this.reloading = true
    void this.reload().finally(() => {
      this.reloading = false
      if (this.reloadAgain && !this.disposed) {
        this.reloadAgain = false
        setTimeout(() => this.externalChange(), RELOAD_GAP_MS)
      }
    })
  }

  private async reload(): Promise<void> {
    try {
      this.acceptDisk(await this.read())
    } catch (err) {
      const e = parseNoteError(err)
      if (e.code === 'not_found') this.acceptMissing()
      // Outros erros (arquivo bloqueado, grande demais...): mantém o que está na tela.
      else if (this.snap.status !== 'ready') this.update({ status: 'error', readError: e.message })
    }
  }

  /** O usuário editou o texto. */
  edit(text: string): void {
    if (this.disposed || text === this.draft) return
    this.draft = text
    this.update({ text, saveError: '' })
    if (!this.snap.conflict) this.scheduleSave()
  }

  private scheduleSave(): void {
    this.cancelSave()
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, AUTOSAVE_MS)
  }

  private cancelSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
  }

  /** Grava agora, se houver o que gravar (gravações em fila, uma por vez). */
  save(): Promise<void> {
    this.cancelSave()
    const run = this.saveQueue.then(() => this.doSave())
    this.saveQueue = run
    return run
  }

  private async doSave(): Promise<void> {
    if (!this.isDirty() || this.snap.conflict || this.snap.status !== 'ready') return
    const base = this.base
    const ifRevision = base === null ? undefined : await this.baseRevision(base)
    if (this.snap.conflict || this.base !== base || !this.isDirty()) return
    const text = toDiskText(this.draft, base ?? '')
    this.sending = text
    try {
      await api.invoke('notes:write', this.writeRequest(text, ifRevision))
      this.setBase(text)
      this.update({ saveError: '' })
    } catch (err) {
      const e = parseNoteError(err)
      if (this.disposed) this.hooks.onError(s.finalSaveFailed(this.file, e.message))
      else if (e.code === 'precondition') await this.conflictAfterSave()
      else this.update({ saveError: e.message })
    } finally {
      this.sending = null
    }
  }

  /** A gravação foi recusada porque o arquivo mudou por fora: mostra o conflito. */
  private async conflictAfterSave(): Promise<void> {
    try {
      const content = await this.read()
      if (toEditorText(content) === this.draft) {
        this.setBase(content)
        this.update({ conflict: null })
        return
      }
      this.cancelSave()
      this.diskOnConflict = content
      this.update({ conflict: 'changed' })
    } catch (err) {
      const e = parseNoteError(err)
      if (e.code === 'not_found') {
        this.cancelSave()
        this.update({ conflict: 'removed' })
      } else {
        this.update({ saveError: e.message })
      }
    }
  }

  /** Conflito: fica com a versão do disco (descarta as alterações locais). */
  takeDisk(): void {
    if (this.snap.conflict === 'removed') {
      const lastSeen = this.draft
      this.setBase(null)
      this.draft = ''
      this.diskOnConflict = null
      this.update({ status: 'missing', text: '', conflict: null, lastSeen })
      return
    }
    const disk = this.diskOnConflict
    this.diskOnConflict = null
    if (disk === null) {
      this.update({ conflict: null })
      this.externalChange()
      return
    }
    this.setBase(disk)
    this.draft = toEditorText(disk)
    this.update({ conflict: null, text: this.draft })
  }

  /** Conflito: grava a versão local por cima da externa (ou recria o arquivo removido). */
  keepMine(): void {
    if (this.snap.conflict === 'removed') {
      void this.recreate(this.draft)
      return
    }
    const disk = this.diskOnConflict
    this.diskOnConflict = null
    // A versão do disco passa a ser a base: se ela mudar de novo, o conflito volta.
    if (disk !== null) this.setBase(disk)
    this.update({ conflict: null })
    void this.save()
  }

  /** Recria o arquivo ausente (com o último conteúdo visto, ou com o texto informado). */
  async recreate(editorText?: string): Promise<void> {
    const source = editorText ?? this.snap.lastSeen
    const content = toDiskText(source, this.base ?? '')
    try {
      const name = await api.invoke('notes:create', { dir: this.dir, file: this.file, content })
      if (this.disposed) return
      if (!sameFile(name, this.file)) {
        this.hooks.onRenamed(name)
        return
      }
      this.setBase(content)
      this.draft = toEditorText(content)
      this.diskOnConflict = null
      this.update({ status: 'ready', text: this.draft, conflict: null, saveError: '', lastSeen: '' })
    } catch (err) {
      this.update({ saveError: parseNoteError(err).message })
    }
  }

  /** Marca/desmarca uma tarefa ("- [ ]") pelo deslocamento do item no texto. */
  toggleTask(offset: number): void {
    if (this.snap.status !== 'ready' || this.snap.conflict) return
    const next = toggleTaskAt(this.draft, offset)
    if (next === null) return
    this.draft = next
    this.update({ text: next })
    void this.save()
  }

  /** Gravação imediata e sem esperar (janela fechando). */
  flushNow(): void {
    if (this.disposed || !this.isDirty() || this.snap.conflict || this.snap.status !== 'ready') return
    const base = this.base
    const text = toDiskText(this.draft, base ?? '')
    const rev = base !== null && this.baseRev?.text === base ? this.baseRev.rev : undefined
    this.cancelSave()
    void api.invoke('notes:write', this.writeRequest(text, rev)).catch(() => undefined)
  }

  dispose(): void {
    if (this.disposed) return
    const pending = this.snap.status === 'ready' && !this.snap.conflict && this.isDirty()
    this.cancelSave()
    if (pending) void this.save()
    this.disposed = true
    this.listeners.clear()
  }
}

// ------------------------------------------------------------------ Markdown (sem HTML cru)

/** Só imagens embutidas: o app não busca nada na rede (e a CSP bloquearia de qualquer forma). */
const SAFE_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i

interface MdastLike {
  type?: string
  value?: string
  children?: MdastLike[]
}

/**
 * Plugin remark: quebra de linha simples vira quebra visível (como nos apps de notas). Agentes
 * costumam registrar progresso linha a linha, sem linha em branco entre as entradas.
 */
function remarkSoftBreaks(): (tree: unknown) => void {
  const visit = (node: MdastLike): void => {
    if (!Array.isArray(node.children)) return
    const out: MdastLike[] = []
    for (const child of node.children) {
      if (child.type === 'text' && typeof child.value === 'string' && child.value.includes('\n')) {
        child.value.split('\n').forEach((part, i) => {
          if (i > 0) out.push({ type: 'break' })
          if (part) out.push({ type: 'text', value: part })
        })
      } else {
        visit(child)
        out.push(child)
      }
    }
    node.children = out
  }
  return (tree) => visit(tree as MdastLike)
}

interface HastLike {
  type?: string
  properties?: Record<string, unknown>
  position?: { start?: { offset?: number }; end?: { offset?: number } }
  children?: HastLike[]
}

/** Plugin rehype: anota cada elemento com a posição no fonte (duplo clique e tarefas). */
function rehypeSourceOffsets(): (tree: unknown) => void {
  const visit = (node: HastLike): void => {
    const start = node.position?.start?.offset
    if (node.type === 'element' && typeof start === 'number') {
      node.properties = node.properties ?? {}
      node.properties['dataPos'] = start
      const end = node.position?.end?.offset
      if (typeof end === 'number') node.properties['dataEnd'] = end
    }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child)
  }
  return (tree) => visit(tree as HastLike)
}

function urlTransform(url: string, key: string): string {
  if (key === 'src') return SAFE_IMAGE.test(url) || /^https?:\/\//i.test(url) ? url : ''
  return defaultUrlTransform(url)
}

function SafeImage({ src, alt, title }: React.ComponentProps<'img'> & ExtraProps): React.JSX.Element {
  const url = typeof src === 'string' ? src : ''
  const label = s.imageLabel(alt?.trim() || s.imageNoAlt)
  if (SAFE_IMAGE.test(url)) return <img src={url} alt={alt ?? ''} title={title} loading="lazy" draggable={false} />
  if (/^https?:\/\//i.test(url)) {
    return (
      <span className="note-img-blocked" data-href={url} {...hint('no.nota.imagemExterna')}>
        {label}
      </span>
    )
  }
  return (
    <span className="note-img-blocked" {...hint('no.nota.imagemEmbutida')}>
      {label}
    </span>
  )
}

function TaskCheckbox({ type, checked }: React.ComponentProps<'input'> & ExtraProps): React.JSX.Element | null {
  if (type !== 'checkbox') return null
  return (
    <input
      type="checkbox"
      className="note-task"
      checked={Boolean(checked)}
      readOnly
      aria-label={s.taskToggle}
      {...hint('no.nota.tarefa')}
    />
  )
}

const REMARK_PLUGINS = [remarkGfm, remarkSoftBreaks]
const REHYPE_PLUGINS = [rehypeSourceOffsets]
const REMARK_REHYPE_OPTIONS = { footnoteLabel: s.footnotes, footnoteBackLabel: (i: number) => s.footnoteBack(i) }
const COMPONENTS: Components = { img: SafeImage, input: TaskCheckbox }

export const MarkdownView = memo(function MarkdownView({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="note-md">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        remarkRehypeOptions={REMARK_REHYPE_OPTIONS}
        components={COMPONENTS}
        urlTransform={urlTransform}
      >
        {text}
      </Markdown>
    </div>
  )
})

// ------------------------------------------------------------------ nó

type EditSelection = { start: number; end: number } | 'end'

const noopSubscribe = (): (() => void) => () => undefined
const loadingSnapshot = (): NoteSnapshot => LOADING

/** Nó de nota: arquivo .md em .maestrinho/notes com visualização (Markdown) e edição. */
function NoteNodeImpl({ id, data, selected, width }: NodeProps<NoteRFNode>): React.JSX.Element {
  const file = data.node.file
  const dir = useApp((st) => st.active?.dir)
  const platform = useApp((st) => st.info?.platform)
  const updateNode = useApp((st) => st.updateNode)
  const confirmRemove = useApp((st) => st.confirmRemoveNodes)
  const toast = useApp((st) => st.toast)
  const lowZoom = useSettledZoom((z) => z.zoom < 0.4)

  const [controller, setController] = useState<NoteController | null>(null)
  const [mode, setMode] = useState<'view' | 'edit'>(() => (editRequests.has(id) ? 'edit' : 'view'))
  const pendingSelection = useRef<EditSelection | null>(mode === 'edit' ? 'end' : null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewScroll = useRef({ top: 0, atBottom: false })

  const hooksRef = useRef<NoteControllerHooks>({ onRenamed: () => undefined, onError: () => undefined })
  hooksRef.current = {
    onRenamed: (next) => {
      toast('info', s.renamed(file, next))
      updateNode(id, { file: next })
    },
    onError: (message) => toast('error', message)
  }

  useEffect(() => {
    editRequests.delete(id)
  }, [id])

  useEffect(() => {
    if (!dir) return
    const c = new NoteController(dir, file, {
      onRenamed: (next) => hooksRef.current.onRenamed(next),
      onError: (message) => hooksRef.current.onError(message)
    })
    setController(c)
    c.start()
    const off = onNoteChanged(dir, file, () => c.externalChange())
    const onUnload = (): void => c.flushNow()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      off()
      window.removeEventListener('beforeunload', onUnload)
      c.dispose()
    }
  }, [dir, file])

  const snap = useSyncExternalStore(
    controller ? controller.subscribe : noopSubscribe,
    controller ? controller.getSnapshot : loadingSnapshot
  )

  const enterEdit = useCallback((sel: EditSelection) => {
    pendingSelection.current = sel
    setMode('edit')
  }, [])

  const leaveEdit = useCallback(() => {
    void controller?.save()
    setMode('view')
  }, [controller])

  // Foco no editor ao entrar no modo de edição (com o cursor no ponto clicado).
  useLayoutEffect(() => {
    if (mode !== 'edit' || snap.status !== 'ready') return
    const sel = pendingSelection.current
    const ta = taRef.current
    if (!sel || !ta) return
    pendingSelection.current = null
    const len = ta.value.length
    const start = sel === 'end' ? len : Math.min(sel.start, len)
    const end = sel === 'end' ? len : Math.min(sel.end, len)
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(start, end)
    scrollCaretIntoView(ta, start)
  }, [mode, snap.status])

  // Visualização: restaura a rolagem ao voltar do editor e acompanha o fim do texto quando o
  // usuário está no fim (agente registrando progresso).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || mode !== 'view') return
    if (viewScroll.current.atBottom) el.scrollTop = el.scrollHeight
    else if (el.scrollTop !== viewScroll.current.top) el.scrollTop = viewScroll.current.top
  }, [snap.text, mode, snap.status])

  const onViewScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    const scrollable = el.scrollHeight > el.clientHeight
    viewScroll.current = { top: el.scrollTop, atBottom: scrollable && el.scrollHeight - el.scrollTop - el.clientHeight < 24 }
  }

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
    if (target) {
      const st = useApp.getState()
      const node = st.active?.doc.nodes.find((n) => n.kind === 'note' && sameFile(n.file, target))
      if (node) st.requestFocus(node.id)
      else toast('info', s.linkNotOnCanvas(target))
      return
    }
    toast('info', s.linkUnsupported)
  }

  const onViewClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    const box = target.closest('input.note-task')
    if (box) {
      // Sem preventDefault: o navegador desfaria a marcação depois de o React já ter aplicado o
      // novo estado (o texto alternado é a fonte da verdade da caixa).
      const li = box.closest<HTMLElement>('li[data-pos]')
      const pos = li ? Number(li.dataset['pos']) : NaN
      if (Number.isFinite(pos)) controller?.toggleTask(pos)
      return
    }
    const blocked = target.closest<HTMLElement>('[data-href]')
    if (blocked) {
      e.preventDefault()
      openLink(blocked.dataset['href'] ?? '')
      return
    }
    const link = target.closest('a')
    if (link) {
      e.preventDefault()
      openLink(link.getAttribute('href') ?? '')
    }
  }

  const onViewDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (target.closest('a, input, button, [data-href]')) return
    e.stopPropagation()
    const text = snap.text
    const el = target.closest<HTMLElement>('[data-pos]')
    const start = el ? Number(el.dataset['pos']) : NaN
    const end = el ? Number(el.dataset['end']) : NaN
    let caret = Number.isFinite(start) ? start : text.length
    // A palavra clicada (selecionada pelo duplo clique) localiza o ponto exato no fonte.
    const word = (window.getSelection()?.toString() ?? '').trim()
    if (word && Number.isFinite(start)) {
      const i = text.indexOf(word, start)
      if (i >= 0 && (!Number.isFinite(end) || i + word.length <= end)) caret = i + word.length
    }
    window.getSelection()?.removeAllRanges()
    enterEdit({ start: caret, end: caret })
  }

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    e.stopPropagation()
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void controller?.save()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      leaveEdit()
      return
    }
    if (e.key === 'Tab' && !ctrl && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      insertText(e.currentTarget, '  ')
    }
  }

  const openFolder = (): void => {
    if (!dir) return
    const sep = platform === 'win32' ? '\\' : '/'
    const slash = file.lastIndexOf('/')
    const parts = [dir.replace(/[\\/]+$/, ''), WORKSPACE_META_DIR, NOTES_DIR]
    if (slash > 0 && snap.status === 'ready') parts.push(file.slice(0, slash))
    void api.invoke('app:openPath', { path: parts.join(sep) }).catch((err) => toast('error', noteErrorMessage(err)))
  }

  const slash = file.lastIndexOf('/')
  const folder = slash >= 0 ? file.slice(0, slash + 1) : ''
  const baseName = slash >= 0 ? file.slice(slash + 1) : file
  const compact = (width ?? data.node.size.w) < COMPACT_WIDTH
  const fileHint: HintText = hintText['no.nota.arquivo']

  const header = (
    <>
      <IconNote size={14} />
      <span className="node-name note-title" {...hintOf({ title: s.location(file), body: fileHint.body })}>
        {folder && <span className="note-title-folder">{folder}</span>}
        <span className="note-title-name">{baseName}</span>
      </span>
      {snap.saveError ? (
        <span className="note-save error" title={s.saveFailedTitle(snap.saveError)}>
          {s.saveFailed}
        </span>
      ) : snap.dirty ? (
        <span className="note-save" {...hint('no.nota.naoSalvo')}>
          {s.unsaved}
        </span>
      ) : null}
      <span className="node-header-spacer" />
      <div className="note-mode nodrag" role="group" aria-label={s.modeGroup}>
        <button
          type="button"
          className={`note-mode-btn${mode === 'view' ? ' active' : ''}`}
          aria-pressed={mode === 'view'}
          {...hint('no.nota.visualizar', { label: true })}
          onClick={() => (mode === 'edit' ? leaveEdit() : undefined)}
        >
          <IconEye size={13} />
          <span>{s.view}</span>
        </button>
        <button
          type="button"
          className={`note-mode-btn${mode === 'edit' ? ' active' : ''}`}
          aria-pressed={mode === 'edit'}
          {...hint('no.nota.editar', { label: true })}
          onClick={() => (mode === 'view' ? enterEdit('end') : taRef.current?.focus({ preventScroll: true }))}
        >
          <IconEdit size={13} />
          <span>{s.edit}</span>
        </button>
      </div>
      <button
        type="button"
        className="icon-btn nodrag"
        {...hint('no.nota.abrirPasta')}
        aria-label={s.openFolder}
        onClick={openFolder}
      >
        <IconFolder size={14} />
      </button>
      <button
        type="button"
        className="icon-btn danger nodrag"
        {...hint('no.nota.remover')}
        aria-label={s.remove}
        onClick={() => {
          void controller?.save()
          confirmRemove([id])
        }}
      >
        <IconClose size={14} />
      </button>
    </>
  )

  /** Resolve o conflito e devolve o foco ao editor (o botão clicado some junto com o aviso). */
  const resolve = (action: 'disk' | 'mine'): void => {
    if (action === 'disk') controller?.takeDisk()
    else controller?.keepMine()
    if (mode === 'edit') requestAnimationFrame(() => taRef.current?.focus({ preventScroll: true }))
  }

  const banner = snap.conflict && (
    <div className={`note-banner nodrag${snap.conflict === 'removed' ? ' removed' : ''}`} role="alert">
      <div className="note-banner-text">
        <strong>{snap.conflict === 'removed' ? s.removedTitle : s.conflictTitle}</strong>
        <span>{snap.conflict === 'removed' ? s.removedBody : s.conflictBody}</span>
      </div>
      {snap.conflict === 'removed' ? (
        <>
          <button type="button" className="btn" {...hint('no.nota.descartar')} onClick={() => resolve('disk')}>
            {s.discard}
          </button>
          <button type="button" className="btn btn-primary" {...hint('no.nota.recriarComMeu')} onClick={() => resolve('mine')}>
            {s.recreateWithMine}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn" {...hint('no.nota.recarregar')} onClick={() => resolve('disk')}>
            {s.reload}
          </button>
          <button type="button" className="btn btn-primary" {...hint('no.nota.manterMeu')} onClick={() => resolve('mine')}>
            {s.keepMine}
          </button>
        </>
      )}
    </div>
  )

  let body: React.ReactNode
  if (!dir || snap.status === 'loading') {
    body = <div className="note-state muted">{s.loading}</div>
  } else if (snap.status === 'error') {
    body = (
      <div className="note-state nodrag">
        <strong>{s.readError}</strong>
        <p>{snap.readError}</p>
        <button type="button" className="btn" {...hint('no.nota.tentarDeNovo')} onClick={() => controller?.retry()}>
          {s.retry}
        </button>
      </div>
    )
  } else if (snap.status === 'missing') {
    body = (
      <div className="note-state nodrag">
        <strong>{s.missingTitle}</strong>
        <p>{s.missingBody(file)}</p>
        {snap.lastSeen && <p>{s.missingRestoreHint}</p>}
        {snap.saveError && <p className="note-state-error">{snap.saveError}</p>}
        <button type="button" className="btn btn-primary" {...hint('no.nota.recriar')} onClick={() => void controller?.recreate()}>
          {s.recreate}
        </button>
      </div>
    )
  } else if (mode === 'edit') {
    body = (
      <>
        <textarea
          ref={taRef}
          className="note-editor nodrag nowheel nopan"
          value={snap.text}
          spellCheck={false}
          placeholder={s.placeholder}
          aria-label={s.editorLabel(file)}
          onChange={(e) => controller?.edit(e.target.value)}
          onKeyDown={onEditorKeyDown}
          onBlur={() => void controller?.save()}
        />
        <div className="note-foot nodrag">
          {snap.saveError ? (
            <span className="note-foot-error" title={snap.saveError}>
              {s.saveFailedTitle(snap.saveError)}
            </span>
          ) : (
            <span>{s.editorHint}</span>
          )}
        </div>
      </>
    )
  } else {
    body = (
      <div
        ref={scrollRef}
        className="note-scroll nodrag nowheel nopan"
        onClick={onViewClick}
        onDoubleClick={onViewDoubleClick}
        onScroll={onViewScroll}
      >
        {/\S/.test(snap.text) ? (
          <MarkdownView text={snap.text} />
        ) : (
          <div className="note-empty">
            <span>{s.empty}</span>
            <span>{s.emptyHint}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <NodeFrame
      id={id}
      kind="note"
      selected={selected}
      minWidth={NOTE_MIN_SIZE.w}
      minHeight={NOTE_MIN_SIZE.h}
      header={header}
      className={compact ? 'note-compact' : undefined}
    >
      <div className="note-body">
        {banner}
        {body}
        {lowZoom && (
          <div className="note-lowzoom">
            <span>{baseName}</span>
          </div>
        )}
      </div>
    </NodeFrame>
  )
}

export const NoteNode = memo(NoteNodeImpl)
