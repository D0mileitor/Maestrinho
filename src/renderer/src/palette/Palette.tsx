import { useEffect, useMemo, useRef, useState } from 'react'
import type { SearchResult } from '@shared/ipc'
import { useApp } from '../store/appStore'
import { useUi } from '../store/uiStore'
import { canvasBridge, DEFAULT_TERMINAL_SIZE, snap } from '../canvas/bridge'
import { multiTermScore } from './fuzzy'
import { IconGlobe, IconNote, IconSearch, IconTerminal, IconText, IconFolder, IconBaton, IconBack } from '../lib/icons'
import { api, errorMessage } from '../lib/api'
import { revealInTerminal } from '../terminal/registry'
import { askNewTask } from '../chat/newTask'
import { teamChatText as G } from '../i18n/teamChat'
import { hint } from '../hints/hint'
import type { HintKey } from '../i18n/hints'

interface Item {
  key: string
  kind: 'terminal' | 'note' | 'portal' | 'shape' | 'workspace' | 'action' | 'floor' | 'output'
  label: string
  detail?: string
  fields: string[]
  run: () => void
  boost?: number
  /** Explicação da ação (balão ao parar o mouse). */
  help?: HintKey
}

type Mode =
  | { kind: 'search' }
  | { kind: 'pick'; purpose: 'ask' | 'check' }
  | { kind: 'ask'; id: string; name: string; dir: string }
  | { kind: 'check'; id: string; name: string; dir: string }

function Highlight({ text, positions }: { text: string; positions: number[] }): React.JSX.Element {
  if (positions.length === 0) return <>{text}</>
  const set = new Set(positions)
  return (
    <>
      {[...text].map((ch, i) => (set.has(i) ? <b key={i}>{ch}</b> : <span key={i}>{ch}</span>))}
    </>
  )
}

const KIND_ICON = {
  terminal: IconTerminal,
  note: IconNote,
  portal: IconGlobe,
  shape: IconText,
  workspace: IconFolder,
  floor: IconFolder,
  action: IconBaton,
  output: IconSearch
}

/** Prévia ao vivo da tela de um terminal (texto limpo, atualizado a cada ~0,7 s). */
function LivePreview({ id }: { id: string }): React.JSX.Element {
  const [text, setText] = useState('')
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void api
        .invoke('pty:readText', { id, lines: 40 })
        .then((t) => {
          if (alive) setText(t)
        })
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 700)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [id])
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [text])
  return (
    <pre ref={ref} className="palette-preview">
      {text || 'Sem saída ainda.'}
    </pre>
  )
}

/** Busca rápida (Ctrl+K / Ctrl+P): nós de todos os workspaces abertos, notas, ações e Perguntar/Acompanhar. */
export function Palette(): React.JSX.Element | null {
  const open = useApp((s) => s.paletteOpen)
  const setPalette = useApp((s) => s.setPalette)
  const active = useApp((s) => s.active)
  const workspaces = useApp((s) => s.workspaces)
  const config = useApp((s) => s.config)
  const runtime = useApp((s) => s.runtime)
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<Mode>({ kind: 'search' })
  const [remote, setRemote] = useState<SearchResult[]>([])
  const [message, setMessage] = useState('')
  const [sentCount, setSentCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const restoreFocus = useRef<Element | null>(null)

  useEffect(() => {
    if (open) {
      restoreFocus.current = document.activeElement
      setQ('')
      setIndex(0)
      setMode({ kind: 'search' })
      setRemote([])
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    if (mode.kind === 'ask') setTimeout(() => textRef.current?.focus(), 0)
    else if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [mode, open])

  // Busca global (outros workspaces e corpo das notas) com debounce.
  useEffect(() => {
    if (!open || mode.kind !== 'search' || !q.trim()) {
      setRemote([])
      return
    }
    const timer = setTimeout(() => {
      void api
        .invoke('search:query', { q })
        .then(setRemote)
        .catch(() => setRemote([]))
    }, 120)
    return () => clearTimeout(timer)
  }, [q, open, mode.kind])

  const close = (refocus = true): void => {
    setPalette(false)
    if (refocus) {
      const el = restoreFocus.current as HTMLElement | null
      setTimeout(() => el?.focus?.(), 0)
    }
  }

  const goTo = (dir: string, id: string, floorId?: string): void => {
    const s = useApp.getState()
    close(false)
    const focus = (): void => {
      const doc = useApp.getState().active?.doc
      if (doc && (doc.activeFloorId ?? null) !== (floorId ?? null)) {
        void useApp.getState().applyOps([{ op: 'setActiveFloor', floorId: floorId ?? null }])
      }
      setTimeout(() => useApp.getState().requestFocus(id), 80)
    }
    if (s.active?.dir !== dir) void s.openWorkspace(dir).then(() => setTimeout(focus, 150))
    else focus()
  }

  const items = useMemo<Item[]>(() => {
    const s = useApp.getState()
    const out: Item[] = []
    const doc = active?.doc
    if (doc && active) {
      for (const n of doc.nodes) {
        const where = n.floorId ? `floor ${doc.floors.find((f) => f.id === n.floorId)?.name ?? ''}` : 'térreo'
        const go = (): void => goTo(active.dir, n.id, n.floorId)
        if (n.kind === 'terminal') {
          const preset = config?.presets.find((p) => p.id === n.presetId)?.label ?? n.presetId
          const role = n.roleId ? config?.roles.find((r) => r.id === n.roleId)?.name : undefined
          out.push({
            key: n.id,
            kind: 'terminal',
            label: n.name,
            detail: [preset, role, where].filter(Boolean).join(', '),
            fields: [n.name, 'terminal', preset, role ?? '', doc.name],
            run: go,
            boost: s.attention[n.id] ? 3 : 0
          })
        } else if (n.kind === 'note') {
          out.push({ key: n.id, kind: 'note', label: n.file, detail: `nota, ${where}`, fields: [n.file, 'nota', doc.name], run: go })
        } else if (n.kind === 'portal') {
          out.push({ key: n.id, kind: 'portal', label: n.title || n.url, detail: n.url, fields: [n.title ?? n.url, 'portal', n.url], run: go })
        } else if (n.kind === 'shape' && n.text.trim()) {
          out.push({ key: n.id, kind: 'shape', label: n.text.split('\n')[0]!.slice(0, 60), detail: 'texto', fields: [n.text, 'texto'], run: go })
        }
      }
      for (const f of doc.floors) {
        out.push({
          key: `floor:${f.id}`,
          kind: 'floor',
          label: `Floor ${f.name}`,
          detail: `branch ${f.branch}`,
          fields: [f.name, 'floor', f.branch],
          run: () => {
            close(false)
            void s.applyOps([{ op: 'setActiveFloor', floorId: f.id }])
          }
        })
      }
    }
    for (const w of workspaces) {
      if (w.active || !w.exists) continue
      out.push({
        key: `ws:${w.dir}`,
        kind: 'workspace',
        label: w.name,
        detail: w.dir,
        fields: [w.name, 'workspace', w.dir],
        run: () => {
          close(false)
          void s.openWorkspace(w.dir)
        }
      })
    }
    const actions: [string, () => void, HintKey][] = [
      ['Perguntar a um terminal…', () => setMode({ kind: 'pick', purpose: 'ask' }), 'busca.perguntar'],
      ['Acompanhar um terminal…', () => setMode({ kind: 'pick', purpose: 'check' }), 'busca.acompanhar'],
      [
        'Novo terminal',
        () => {
          close(false)
          const c = canvasBridge()?.viewportCenter() ?? { x: 0, y: 0 }
          s.setDialog({
            kind: 'presetPicker',
            rect: { x: snap(c.x - DEFAULT_TERMINAL_SIZE.w / 2), y: snap(c.y - DEFAULT_TERMINAL_SIZE.h / 2), ...DEFAULT_TERMINAL_SIZE }
          })
        },
        'busca.novoTerminal'
      ],
      ['Nova nota', () => (close(false), s.setTool('note')), 'busca.novaNota'],
      ['Novo portal', () => (close(false), s.setTool('portal')), 'busca.novoPortal'],
      ['Novo floor (git worktree)', () => (close(false), s.setDialog({ kind: 'floorCreate' })), 'floors.novo'],
      ['Abrir pasta de projeto…', () => (close(false), void s.pickAndOpenWorkspace()), 'lateral.adicionar'],
      ['Presets de agentes', () => (close(false), s.setDialog({ kind: 'presets' })), 'topo.presets'],
      ['Papéis', () => (close(false), s.setDialog({ kind: 'roles' })), 'topo.papeis'],
      ['Rotinas', () => (close(false), s.setDialog({ kind: 'routines' })), 'topo.rotinas'],
      ['Partituras', () => (close(false), s.setDialog({ kind: 'partituras' })), 'topo.partituras'],
      ['Configurações', () => (close(false), s.setDialog({ kind: 'settings' })), 'topo.configuracoes'],
      ['Enquadrar tudo', () => (close(false), canvasBridge()?.fitView()), 'canvas.enquadrarTudo'],
      ['Alternar tema claro/escuro', () => (close(false), s.toggleTheme()), 'topo.tema'],
      ['Mostrar/ocultar barra lateral', () => (close(false), s.setSidebar(!s.sidebarOpen)), 'busca.barraLateral'],
      ['Mostrar/ocultar minimapa', () => (close(false), useUi.getState().setMinimap(!useUi.getState().minimapOpen)), 'busca.minimapa'],
      [
        'Redefinir foco (devolve o teclado ao canvas)',
        () => {
          close(false)
          ;(document.activeElement as HTMLElement | null)?.blur?.()
          s.setTool('select')
          useUi.getState().setConnectFrom(null)
        },
        'busca.redefinirFoco'
      ]
    ]
    if (active) {
      actions.push([G.newTaskAction, () => (close(false), askNewTask()), 'chat.geral.novaTarefa'])
      actions.push([
        'Abrir pasta do workspace no explorador',
        () => (close(false), void api.invoke('app:openPath', { path: active.dir })),
        'lateral.abrirPasta'
      ])
    }
    for (const [label, run, help] of actions) {
      out.push({ key: `act:${label}`, kind: 'action', label, fields: [label, 'ação comando'], run, help })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, workspaces, config, open])

  const results = useMemo(() => {
    if (mode.kind === 'pick') {
      const terms = items.filter((i) => i.kind === 'terminal')
      const list = q.trim()
        ? terms
            .map((item) => ({ item, ...multiTermScore(q, item.fields) }))
            .filter((r) => r.score >= 0)
            .sort((a, b) => b.score - a.score)
        : terms.map((item) => ({ item, score: 0, positions: [] as number[] }))
      return list.map(({ item, positions }) => ({
        item: {
          ...item,
          run: () => {
            if (!active) return
            setQ('')
            setMessage('')
            setSentCount(0)
            setMode({ kind: mode.purpose, id: item.key, name: item.label, dir: active.dir })
          }
        },
        positions
      }))
    }
    if (!q.trim()) {
      return items.filter((i) => i.kind === 'action' || i.kind === 'terminal').map((item) => ({ item, positions: [] as number[] }))
    }
    const local = items.flatMap((item) => {
      const r = multiTermScore(q, item.fields)
      // Não casou: fica de fora (o bônus só ordena o que casou).
      if (r.score < 0) return []
      return [{ item, score: r.score + (item.boost ?? 0) + (item.kind === 'action' ? 0 : 5), positions: r.positions }]
    })
    const seen = new Set(local.map((r) => r.item.key))
    const fromMain = remote
      .filter((r) => !seen.has(r.kind === 'workspace' ? `ws:${r.id}` : r.id))
      .map((r) => ({
        item: {
          key: `remote:${r.id}`,
          kind: r.kind === 'action' ? 'action' : r.kind,
          label: r.kind === 'output' ? `${r.label}: saída` : r.label,
          detail: r.detail,
          fields: [r.label],
          run: () => {
            if (r.kind === 'output' && r.dir && r.terminalId) {
              const term = r.terminalId
              const query = q.trim()
              goTo(r.dir, term, r.floorId)
              setTimeout(() => revealInTerminal(term, query, r.line), 450)
            } else if (r.kind === 'workspace') {
              close(false)
              void useApp.getState().openWorkspace(r.id)
            } else if (r.dir) goTo(r.dir, r.id, r.floorId)
          }
        } as Item,
        score: r.score,
        positions: [] as number[]
      }))
    return [...local, ...fromMain].sort((a, b) => b.score - a.score).slice(0, 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, q, remote, mode])

  if (!open) return null
  const run = (i: number): void => results[i]?.item.run()

  const sendAsk = async (): Promise<void> => {
    if (mode.kind !== 'ask' || !message.trim()) return
    try {
      await api.invoke('pty:sendMessage', { id: mode.id, text: message })
      setMessage('')
      setSentCount((c) => c + 1)
    } catch (err) {
      useApp.getState().toast('error', errorMessage(err))
    }
  }

  const back = (): void => {
    setQ('')
    setIndex(0)
    setMode(mode.kind === 'ask' || mode.kind === 'check' ? { kind: 'pick', purpose: mode.kind } : { kind: 'search' })
  }

  if (mode.kind === 'ask' || mode.kind === 'check') {
    const info = runtime[mode.id]
    return (
      <div className="scrim palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <div
          className="palette palette-wide"
          role="dialog"
          aria-label={mode.kind === 'ask' ? `Perguntar a ${mode.name}` : `Acompanhar ${mode.name}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              back()
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              goTo(mode.dir, mode.id)
            } else if (mode.kind === 'check' && e.key === 'Enter') {
              e.preventDefault()
              goTo(mode.dir, mode.id)
            }
          }}
          tabIndex={-1}
        >
          <div className="palette-head">
            <button className="icon-btn" {...hint('busca.voltar')} aria-label="Voltar" onClick={back}>
              <IconBack size={14} />
            </button>
            <strong>{mode.kind === 'ask' ? `Perguntar a ${mode.name}` : `Acompanhando ${mode.name}`}</strong>
            <span className="muted">{info ? (info.activity === 'busy' ? 'trabalhando' : info.status === 'running' ? 'aguardando' : info.status) : ''}</span>
            <span className="spacer" />
            <span className="muted">Ctrl+Enter vai ao terminal</span>
          </div>
          <LivePreview id={mode.id} />
          {mode.kind === 'ask' && (
            <div className="palette-compose">
              <textarea
                ref={textRef}
                className="textarea"
                rows={3}
                value={message}
                placeholder="Mensagem (Enter envia, Shift+Enter quebra a linha)"
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault()
                    void sendAsk()
                  }
                }}
              />
              {sentCount > 0 && <small className="muted">{sentCount} mensagem(ns) enviada(s). O agente continua trabalhando se você sair.</small>}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="scrim palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Busca rápida">
        <div className="palette-input">
          {mode.kind === 'pick' ? (
            <button className="icon-btn" {...hint('busca.voltar')} aria-label="Voltar" onClick={back}>
              <IconBack size={14} />
            </button>
          ) : (
            <IconSearch />
          )}
          <input
            ref={inputRef}
            value={q}
            placeholder={
              mode.kind === 'pick'
                ? mode.purpose === 'ask'
                  ? 'Escolha o terminal para perguntar…'
                  : 'Escolha o terminal para acompanhar…'
                : 'Buscar terminais, saída dos terminais, notas, workspaces e ações…'
            }
            onChange={(e) => {
              setQ(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                if (mode.kind === 'pick') back()
                else close()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(results.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(index)
              }
            }}
          />
        </div>
        <ul className="palette-list" role="listbox">
          {results.map(({ item, positions }, i) => {
            const Icon = KIND_ICON[item.kind] ?? IconBaton
            return (
              <li
                key={item.key}
                role="option"
                aria-selected={i === index}
                className={`palette-item${i === index ? ' selected' : ''}`}
                {...(item.help ? hint(item.help) : {})}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  run(i)
                }}
              >
                <Icon size={15} />
                <span className="palette-label">
                  <Highlight text={item.label} positions={positions} />
                </span>
                {item.detail && <span className="palette-detail">{item.detail}</span>}
              </li>
            )
          })}
          {results.length === 0 && <li className="palette-empty">Nada encontrado para “{q}”.</li>}
        </ul>
      </div>
    </div>
  )
}
