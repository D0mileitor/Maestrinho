import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangedFile, DiffLine, FileDiff } from '@shared/changes'
import type { TerminalNodeData } from '@shared/schemas'
import { useApp } from '../store/appStore'
import { api, errorMessage } from '../lib/api'
import { IconRestart } from '../lib/icons'
import { changesText as C } from '../i18n/changes'
import { paineisHintsDin as PH } from '../i18n/hints/paineis'
import { hint, hintOf } from '../hints/hint'
import { defaultReviewer, reviewRequest } from './review'
import { CheckpointsMenu } from './Checkpoints'
import '../styles/changes.css'

interface Repo {
  root: string
  label: string
  branch: string
}

const NO_AGENT = '\u0000sem'

function toast(level: 'info' | 'error', message: string): void {
  useApp.getState().toast(level, message)
}

/** Recarrega quando algum agente termina uma vez de trabalho (ele pode ter mexido em arquivos). */
function useIdleTick(): number {
  const key = useApp((s) =>
    Object.values(s.runtime)
      .map((r) => `${r.id}:${r.activity}`)
      .sort()
      .join(',')
  )
  const [tick, setTick] = useState(0)
  const prev = useRef(key)
  useEffect(() => {
    const before = new Map(prev.current.split(',').map((p) => p.split(':') as [string, string]))
    prev.current = key
    const someoneIdled = key.split(',').some((p) => {
      const [id, act] = p.split(':')
      return act === 'idle' && before.get(id!) === 'busy'
    })
    if (!someoneIdled) return
    const t = setTimeout(() => setTick((n) => n + 1), 1500)
    return () => clearTimeout(t)
  }, [key])
  return tick
}

/**
 * Visão "Mudanças": o que mudou no repositório desde o último commit, arquivo por arquivo, com quem
 * editou (pelos históricos dos agentes). Dá para pedir ajuste a um agente (no arquivo ou numa linha),
 * descartar (vai para a lixeira) e fazer commit dos arquivos escolhidos.
 */
export function ChangesView(): React.JSX.Element | null {
  const active = useApp((s) => s.active)
  const dir = active?.dir ?? ''
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [root, setRoot] = useState('')
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const [branch, setBranch] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [agentFilter, setAgentFilter] = useState<string>('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [reviewer, setReviewer] = useState('')
  const idleTick = useIdleTick()

  const terminals = useMemo(
    () => (active?.doc.nodes ?? []).filter((n): n is TerminalNodeData => n.kind === 'terminal').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [active?.doc.nodes]
  )

  useEffect(() => {
    if (!dir) return
    let alive = true
    setRepos(null)
    api
      .invoke('changes:repos', { dir })
      .then((list) => {
        if (!alive) return
        setRepos(list)
        setRoot((r) => (list.some((x) => x.root === r) ? r : (list[0]?.root ?? '')))
      })
      .catch((err: unknown) => {
        toast('error', errorMessage(err))
        if (alive) setRepos([])
      })
    return () => {
      alive = false
    }
  }, [dir])

  const load = useCallback(async () => {
    if (!dir || !root) return
    setLoading(true)
    try {
      const st = await api.invoke('changes:status', { dir, root })
      setFiles(st.files)
      setBranch(st.branch)
      setTruncated(st.truncated)
      setSelected((sel) => new Set([...sel].filter((p) => st.files.some((f) => f.path === p))))
      setCurrent((cur) => (cur && st.files.some((f) => f.path === cur) ? cur : (st.files[0]?.path ?? null)))
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [dir, root])

  useEffect(() => {
    void load()
  }, [load, idleTick])

  if (!active) return null

  const agentsInFiles = [...new Set((files ?? []).flatMap((f) => f.agents))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const shown = (files ?? []).filter((f) =>
    agentFilter === '' ? true : agentFilter === NO_AGENT ? f.agents.length === 0 : f.agents.includes(agentFilter)
  )
  const allSelected = shown.length > 0 && shown.every((f) => selected.has(f.path))
  const currentFile = files?.find((f) => f.path === current) ?? null

  const selectedFiles = (files ?? []).filter((f) => selected.has(f.path))
  const editors = [...new Set(selectedFiles.flatMap((f) => f.agents))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const reviewerId = terminals.some((t) => t.id === reviewer) ? reviewer : (defaultReviewer(terminals, editors)?.id ?? '')

  const askReview = async (): Promise<void> => {
    const node = terminals.find((t) => t.id === reviewerId)
    if (!node || selectedFiles.length === 0) return
    try {
      const text = reviewRequest({ root, branch: branch || null, files: selectedFiles, kinds: C.kinds, editors })
      await api.invoke('pty:sendMessage', { id: node.id, text })
      toast('info', C.reviewSent(node.name, selectedFiles.length))
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  const toggle = (p: string): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })

  const commit = async (): Promise<void> => {
    if (busy || selected.size === 0 || !message.trim()) return
    setBusy(true)
    try {
      const { hash } = await api.invoke('changes:commit', { dir, root, paths: [...selected], message })
      toast('info', C.committed(hash))
      setMessage('')
      setSelected(new Set())
      await load()
    } catch (err) {
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const discard = (paths: string[]): void => {
    if (paths.length === 0) return
    useApp.getState().setDialog({
      kind: 'confirm',
      title: C.confirmDiscardTitle,
      body: C.confirmDiscard(paths.length),
      confirmLabel: C.discard,
      danger: true,
      onConfirm: async () => {
        try {
          await api.invoke('changes:discard', { dir, root, paths })
          toast('info', C.discarded)
          setSelected((s) => new Set([...s].filter((p) => !paths.includes(p))))
          await load()
        } catch (err) {
          toast('error', errorMessage(err))
        }
      }
    })
  }

  return (
    <div className="changes-root">
      <header className="changes-head">
        <h2>{C.title}</h2>
        {repos && repos.length > 0 && (
          <select className="select changes-repo" aria-label={C.repo} {...hint('mudancas.repositorio')} value={root} onChange={(e) => setRoot(e.target.value)}>
            {repos.map((r) => (
              <option key={r.root} value={r.root}>
                {r.label} — {r.branch}
              </option>
            ))}
          </select>
        )}
        {branch && (
          <span className="changes-branch" {...hint('mudancas.branch')}>
            {branch}
          </span>
        )}
        <span className="spacer" />
        {dir && <CheckpointsMenu dir={dir} root={root} onRestored={() => void load()} />}
        <button className="btn" {...hint('mudancas.atualizar')} onClick={() => void load()} disabled={loading || !root}>
          <IconRestart size={13} /> {C.refresh}
        </button>
      </header>

      {repos && repos.length === 0 ? (
        <p className="changes-empty">{C.noRepo}</p>
      ) : (
        <div className="changes-body">
          <aside className="changes-list">
            {agentsInFiles.length > 0 && (
              <div className="changes-filter" role="group" aria-label={C.filterAgent}>
                {[['', C.all], ...agentsInFiles.map((a) => [a, a]), [NO_AGENT, C.noAgent]].map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={agentFilter === v}
                    {...(v === ''
                      ? hint('mudancas.filtro.todos')
                      : v === NO_AGENT
                        ? hint('mudancas.filtro.semAgente')
                        : hintOf(PH.mudancasFiltroAgente(label!)))}
                    onClick={() => setAgentFilter(v!)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {files === null ? (
              <p className="changes-empty">{C.loading}</p>
            ) : files.length === 0 ? (
              <p className="changes-empty">{C.clean}</p>
            ) : (
              <>
                <label className="changes-all" {...hint('mudancas.selecionarTodos')}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s)
                        for (const f of shown) {
                          if (allSelected) n.delete(f.path)
                          else n.add(f.path)
                        }
                        return n
                      })
                    }
                  />
                  {C.selectAll} · {C.files(shown.length)}
                </label>
                {truncated && <p className="changes-warn">{C.truncated}</p>}
                <ul>
                  {shown.map((f) => (
                    <li key={f.path} className={f.path === current ? 'current' : undefined}>
                      <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggle(f.path)} aria-label={f.path} {...hint('mudancas.marcar')} />
                      <button
                        className="changes-file"
                        onClick={() => setCurrent(f.path)}
                        {...hintOf(PH.mudancasArquivo(f.path, C.kinds[f.kind] ?? f.kind, f.agents.length > 0 ? C.editedBy(f.agents) : ''))}
                      >
                        <span className={`changes-kind k-${f.kind === '?' ? 'new' : f.kind}`}>{f.kind === '?' ? 'N' : f.kind}</span>
                        <span className="changes-name">
                          <span className="changes-base">{f.path.split('/').pop()}</span>
                          <span className="changes-dir">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span>
                        </span>
                        <span className="changes-counts">
                          {f.binary ? 'bin' : (
                            <>
                              {f.added > 0 && <span className="plus">+{f.added}</span>}
                              {f.deleted > 0 && <span className="minus">−{f.deleted}</span>}
                            </>
                          )}
                        </span>
                      </button>
                      {f.agents.length > 0 && <span className="changes-agents">{f.agents.join(', ')}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="changes-commit">
              <label className="field">
                <span>{C.commitMessage}</span>
                <textarea
                  className="input"
                  rows={3}
                  value={message}
                  maxLength={20_000}
                  placeholder={C.commitPlaceholder}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void commit()
                  }}
                />
              </label>
              <div className="changes-review">
                {terminals.length > 0 ? (
                  <label>
                    {C.reviewer}{' '}
                    <select className="select" value={reviewerId} {...hint('mudancas.revisor')} onChange={(e) => setReviewer(e.target.value)}>
                      {terminals.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="changes-review-none">{C.noReviewer}</span>
                )}
                <button className="btn" disabled={selected.size === 0 || !reviewerId} {...hint('mudancas.pedirRevisao')} onClick={() => void askReview()}>
                  {C.askReview(selected.size)}
                </button>
              </div>
              <div className="changes-commit-actions">
                <button className="btn btn-danger" disabled={selected.size === 0} {...hint('mudancas.descartarMarcados')} onClick={() => discard([...selected])}>
                  {C.discardSelected(selected.size)}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || selected.size === 0 || !message.trim()}
                  {...hint('mudancas.commit')}
                  onClick={() => void commit()}
                >
                  {C.commit(selected.size)}
                </button>
              </div>
            </div>
          </aside>
          <section className="changes-diff">
            {currentFile ? (
              <DiffPane key={`${root}|${currentFile.path}`} dir={dir} root={root} file={currentFile} terminals={terminals} onDiscard={() => discard([currentFile.path])} />
            ) : (
              <p className="changes-empty">{files && files.length > 0 ? C.pickFile : ''}</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function DiffPane({
  dir,
  root,
  file,
  terminals,
  onDiscard
}: {
  dir: string
  root: string
  file: ChangedFile
  terminals: TerminalNodeData[]
  onDiscard: () => void
}): React.JSX.Element {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [askLine, setAskLine] = useState<DiffLine | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [text, setText] = useState('')
  const preferred = terminals.find((t) => file.agents.includes(t.name)) ?? terminals[0]
  const [to, setTo] = useState(preferred?.id ?? '')

  useEffect(() => {
    let alive = true
    api
      .invoke('changes:diff', { dir, root, path: file.path })
      .then((d) => alive && setDiff(d))
      .catch((err: unknown) => toast('error', errorMessage(err)))
    return () => {
      alive = false
    }
  }, [dir, root, file.path])

  const send = async (): Promise<void> => {
    const node = terminals.find((t) => t.id === to)
    if (!node || !text.trim()) return
    const line = askLine ? (askLine.new ?? askLine.old ?? null) : null
    try {
      await api.invoke('pty:sendMessage', { id: node.id, text: C.message(file.path, line, askLine?.text ?? null, text.trim()) })
      toast('info', C.sent(node.name))
      setText('')
      setAskLine(null)
      setAskOpen(false)
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  // Sem terminal no workspace, o número da linha não abre pedido: nada de hint prometendo isso.
  const lineHint = terminals.length > 0 ? hint('mudancas.linha') : {}

  const askBox = (placeholder: string): React.JSX.Element => (
    <div className="changes-ask">
      <textarea
        className="input"
        rows={2}
        autoFocus
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send()
          if (e.key === 'Escape') {
            setAskLine(null)
            setAskOpen(false)
          }
        }}
      />
      <div className="changes-ask-row">
        <label>
          {C.askTo}{' '}
          <select className="select" value={to} {...hint('mudancas.pedido.para')} onChange={(e) => setTo(e.target.value)}>
            {terminals.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <button
          className="btn"
          {...hint('mudancas.pedido.cancelar')}
          onClick={() => {
            setAskLine(null)
            setAskOpen(false)
          }}
        >
          {C.cancel}
        </button>
        <button className="btn btn-primary" disabled={!text.trim() || !to} {...hint('mudancas.pedido.enviar')} onClick={() => void send()}>
          {C.send}
        </button>
      </div>
    </div>
  )

  return (
    <div className="changes-pane">
      <header>
        <strong title={file.path}>{file.path}</strong>
        <span className="changes-kind-label">{C.kinds[file.kind]}</span>
        {file.agents.length > 0 && <span className="changes-agents">{C.editedBy(file.agents)}</span>}
        <span className="spacer" />
        {terminals.length > 0 && (
          <button className="btn" {...hint('mudancas.pedirAjuste')} onClick={() => setAskOpen((v) => !v)} aria-expanded={askOpen}>
            {C.ask}
          </button>
        )}
        <button className="btn btn-danger" {...hint('mudancas.descartarArquivo')} onClick={onDiscard}>
          {C.discard}
        </button>
      </header>
      {askOpen && !askLine && askBox(C.askPlaceholder)}
      {!diff ? (
        <p className="changes-empty">{C.loading}</p>
      ) : diff.binary ? (
        <p className="changes-empty">{C.binary}</p>
      ) : (
        <div className="changes-code" role="table" aria-label={file.path}>
          {diff.truncated && <p className="changes-warn">{C.diffTruncated}</p>}
          {diff.hunks.map((h, hi) => (
            <div key={hi} className="changes-hunk">
              <div className="changes-hunk-head">{h.header}</div>
              {h.lines.map((l, li) => {
                const asking = askLine === l
                return (
                  <div key={li}>
                    <div className={`changes-line ${l.type}`} role="row">
                      <button className="ln" {...lineHint} onClick={() => terminals.length > 0 && setAskLine(l)}>
                        {l.old ?? ''}
                      </button>
                      <button className="ln" {...lineHint} onClick={() => terminals.length > 0 && setAskLine(l)}>
                        {l.new ?? ''}
                      </button>
                      <span className="mark">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                      <code>{l.text || ' '}</code>
                    </div>
                    {asking && askBox(C.askLinePlaceholder(l.new ?? l.old ?? 0))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
