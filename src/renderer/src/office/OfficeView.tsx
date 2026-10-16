import { useEffect, useMemo, useRef, useState } from 'react'
import { buildScene, effectiveLook, type OfficeActivity } from '@shared/office'
import type { TerminalNodeData } from '@shared/schemas'
import type { TerminalRuntimeInfo } from '@shared/runtime'
import { useApp } from '../store/appStore'
import { useChat } from '../store/chatStore'
import { useUi } from '../store/uiStore'
import { api } from '../lib/api'
import { ARCHIVE_ID, OfficeEngine, type AgentActivity, type AgentInfo, type OfficeAction } from './engine'
import { ScenePicker, useSceneryChoice } from './ScenePicker'
import { t } from '../i18n'
import { hint } from '../hints/hint'
import '../styles/office.css'

const O = t.office

function resolveActivity(rt: TerminalRuntimeInfo | undefined, act: OfficeActivity | undefined, attention: boolean, isShell: boolean): AgentActivity {
  if (!rt || rt.status !== 'running') return 'off'
  if (act?.waiting) return 'waiting'
  if (rt.activity === 'busy') {
    if (act?.tool && !act.turnEnded) return act.tool.done ? 'thinking' : act.tool.kind
    if (act?.turnEnded) return attention ? 'attention' : 'idle'
    return isShell ? 'terminal' : 'thinking'
  }
  return attention ? 'attention' : 'idle'
}

interface Menu {
  id: string
  /** Menu de um agente (mesa) ou de um quadro (nota). */
  kind: 'agent' | 'board'
  x: number
  y: number
  /** "Interagir com…": escolhendo quem visitar, depois o que fazer na mesa dele. */
  step?: 'alvo' | 'acao'
  target?: string
}

/** Ações do menu "Interagir com…", na ordem em que aparecem. */
const ACTIONS: OfficeAction[] = ['jornal', 'galinha', 'luva', 'mjolnir', 'faca', 'sorteio', 'comemorar']

/**
 * Visão "Escritório": o mesmo desenho do canvas em pixel art. Cada terminal é uma mesa com o seu agente,
 * cada conexão um tapete, cada nota um quadro. Clicar num agente abre o chat ligado a ele.
 */
export function OfficeView(): React.JSX.Element {
  const active = useApp((s) => s.active)
  const hasActive = Boolean(active)
  const runtime = useApp((s) => s.runtime)
  const attention = useApp((s) => s.attention)
  const config = useApp((s) => s.config)
  const setDialog = useApp((s) => s.setDialog)
  const nodes = active?.doc.nodes
  const edges = active?.doc.edges
  const floorId = active?.doc.activeFloorId ?? null
  const dir = active?.dir ?? ''
  const engine = useRef(new OfficeEngine()).current
  const wrap = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const bubbleLayer = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const activities = useRef(new Map<string, OfficeActivity>())
  const [actVersion, setActVersion] = useState(0)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [scenePicker, setScenePicker] = useState(false)
  const defaultScene = config?.settings.officeScene ?? 'escritorio'
  const scenery = useSceneryChoice(dir, active?.doc.officeScene ?? defaultScene)
  // Área disponível na tela: a sala é montada nessa proporção e ocupa a área inteira.
  const [fit, setFit] = useState({ w: 0, h: 0 })

  const scene = useMemo(
    () => buildScene(nodes ?? [], edges ?? [], floorId, fit.w > 0 && fit.h > 0 ? fit : undefined),
    [nodes, edges, floorId, fit]
  )
  const terminals = useMemo(() => {
    const map = new Map<string, TerminalNodeData>()
    for (const n of nodes ?? []) if (n.kind === 'terminal') map.set(n.id, n)
    return map
  }, [nodes])

  useEffect(() => {
    engine.setScene(scene)
  }, [engine, scene])

  useEffect(() => {
    engine.setScenery(scenery.id, scenery.image)
  }, [engine, scenery.id, scenery.image])

  // Quem é quem e o que está fazendo
  const infos = useMemo<AgentInfo[]>(() => {
    void actVersion
    return scene.desks.flatMap((d) => {
      const n = terminals.get(d.id)
      if (!n) return []
      const role = config?.roles.find((r) => r.id === n.roleId)
      const preset = config?.presets.find((p) => p.id === n.presetId)
      return [
        {
          id: n.id,
          name: n.name,
          roleColor: role?.color || '#7d8597',
          look: effectiveLook(n.look, n.id, role?.color || undefined),
          activity: n.hibernated ? 'off' : resolveActivity(runtime[n.id], activities.current.get(n.id), Boolean(attention[n.id]), Boolean(preset?.isShell)),
          sleeping: n.hibernated === true
        }
      ]
    })
  }, [scene, terminals, config, runtime, attention, actVersion])

  useEffect(() => {
    engine.setInfo(infos)
  }, [engine, infos])

  const reactions = config?.settings.officeReactions ?? 'sorteio'
  useEffect(() => {
    engine.reactions = reactions
  }, [engine, reactions])

  // O processo principal acompanha a atividade dos terminais desta cena enquanto a visão está aberta.
  const idsKey = scene.desks.map((d) => d.id).join(',')
  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : []
    void api.invoke('office:watch', { ids }).catch(() => undefined)
  }, [idsKey])
  useEffect(() => () => void api.invoke('office:watch', { ids: [] }).catch(() => undefined), [])

  useEffect(() => {
    // Contador de usos do histórico por terminal: o primeiro valor visto é só a referência (consultas
    // antigas, de antes de abrir o escritório, não viram caminhada).
    const archiveSeen = new Map<string, number>()
    const offAct = api.on('office:activity', (a) => {
      const seen = archiveSeen.get(a.id)
      if (seen !== undefined && a.archive.seq > seen) engine.visitArchive(a.id, a.archive.mode)
      archiveSeen.set(a.id, a.archive.seq)
      activities.current.set(a.id, a)
      engine.setHelpers(a.id, a.helpers ?? [])
      setActVersion((v) => v + 1)
    })
    const offEdge = api.on('edge:activity', (e) => {
      if (e.kind === 'send') engine.message(e.from, e.to, 'send', e.mood)
      else if (e.kind === 'note' && engine.scene.desks.some((d) => d.id === e.from)) engine.message(e.from, e.to, 'note')
    })
    return () => {
      offAct()
      offEdge()
    }
  }, [engine])

  // Tamanho da área (a cena acompanha a proporção dela).
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = (): void => {
      const r = el.getBoundingClientRect()
      const w = Math.floor(r.width)
      const h = Math.floor(r.height)
      setFit((f) => (f.w === w && f.h === h ? f : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasActive])

  // Laço de animação
  useEffect(() => {
    const cv = canvas.current
    const g = cv?.getContext('2d')
    if (!cv || !g || fit.w === 0) return
    const dpr = window.devicePixelRatio || 1
    const K = Math.max(1, Math.ceil((fit.w * dpr) / scene.width))
    cv.width = scene.width * K
    cv.height = scene.height * K
    let raf = 0
    let last = performance.now()
    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      engine.update(dt)
      g.setTransform(K, 0, 0, K, 0, 0)
      g.imageSmoothingEnabled = false
      engine.draw(g)
      const layer = bubbleLayer.current
      if (layer) {
        const list = engine.bubbles()
        while (layer.children.length < list.length) layer.appendChild(document.createElement('div'))
        Array.from(layer.children).forEach((el, i) => {
          const b = list[i]
          const div = el as HTMLDivElement
          if (!b) {
            div.hidden = true
            return
          }
          div.hidden = false
          div.className = `office-say${b.tone ? ` ${b.tone}` : ''}`
          if (div.textContent !== b.text) div.textContent = b.text
          div.style.left = `${(b.x / scene.width) * 100}%`
          div.style.top = `${(b.y / scene.height) * 100}%`
        })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [engine, fit, scene.width, scene.height])

  const toScene = (e: React.MouseEvent): { x: number; y: number } => {
    const r = box.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * scene.width, y: ((e.clientY - r.top) / r.height) * scene.height }
  }
  const openChat = (id: string): void => useChat.getState().openFor(dir, id)
  const openNote = (id: string): void => useChat.getState().openNote(dir, id)

  const onMove = (e: React.MouseEvent): void => {
    const p = toScene(e)
    const helper = engine.hitHelper(p.x, p.y)
    const hi = helper ? engine.helperInfo(helper) : null
    if (helper && hi) {
      engine.hovered = helper
      const el = tip.current
      if (!el) return
      el.hidden = false
      el.textContent = `${O.helperOf(terminals.get(hi.parent)?.name ?? '')}: ${hi.title}${hi.type ? ` (${hi.type})` : ''} · ${hi.working ? O.helperWorking : O.helperLeaving}`
      el.style.left = `${(hi.x / scene.width) * 100}%`
      el.style.top = `${((hi.y + 8) / scene.height) * 100}%`
      return
    }
    const id = engine.hit(p.x, p.y)
    const board = id ? null : engine.hitBoard(p.x, p.y)
    const archive = !id && !board && engine.hitArchive(p.x, p.y)
    engine.hovered = id ?? board ?? (archive ? ARCHIVE_ID : null)
    const el = tip.current
    if (!el) return
    if (archive && scene.archive) {
      el.hidden = false
      el.textContent = O.archiveTip
      el.style.left = `${((scene.archive.x - 60) / scene.width) * 100}%`
      el.style.top = `${((scene.archive.y + 6) / scene.height) * 100}%`
      return
    }
    if (board) {
      const b = scene.boards.find((x) => x.id === board)!
      el.hidden = false
      el.textContent = O.boardTip(b.file)
      el.style.left = `${(b.x / scene.width) * 100}%`
      el.style.top = `${((b.y + 4) / scene.height) * 100}%`
      return
    }
    if (!id) {
      el.hidden = true
      return
    }
    const info = infos.find((i) => i.id === id)
    const node = terminals.get(id)
    const act = activities.current.get(id)
    const detail = info && act?.tool && !act.turnEnded && info.activity === act.tool.kind ? act.tool.detail : ''
    el.hidden = false
    el.textContent = `${node?.name ?? ''} · ${O.activity[info?.activity ?? 'idle'] ?? ''}${detail ? ` — ${detail}` : ''}`
    const pos = engine.actorPos(id)!
    el.style.left = `${(pos.x / scene.width) * 100}%`
    el.style.top = `${((pos.y + 8) / scene.height) * 100}%`
  }

  /** Ajudantes trabalhando para um agente (para a etiqueta da mesa). */
  const helpersOf = (id: string): number => activities.current.get(id)?.helpers?.filter((h) => h.status === 'running').length ?? 0

  if (!active) return <div className="office-root" />

  return (
    <div
      className="office-root"
      ref={wrap}
      onClick={() => {
        setMenu(null)
        setScenePicker(false)
      }}
    >
      {scene.desks.length === 0 ? (
        <div className="office-empty">
          <p>{O.empty}</p>
          <button type="button" className="btn" {...hint('escritorio.voltarCanvas')} onClick={() => useUi.getState().setView('canvas')}>
            {O.backToCanvas}
          </button>
        </div>
      ) : (
        <div className="office-box" ref={box} style={{ width: fit.w, height: fit.h }}>
          <canvas
            ref={canvas}
            aria-label={O.office}
            onMouseMove={onMove}
            onMouseLeave={() => {
              engine.hovered = null
              if (tip.current) tip.current.hidden = true
            }}
            onClick={(e) => {
              e.stopPropagation()
              setMenu(null)
              const p = toScene(e)
              // estagiário: abre o chat de quem o chamou (a resposta dele aparece lá)
              const helper = engine.hitHelper(p.x, p.y)
              const parent = helper ? engine.helperInfo(helper)?.parent : undefined
              if (parent) {
                engine.selected = parent
                openChat(parent)
                return
              }
              const id = engine.hit(p.x, p.y)
              const board = id ? null : engine.hitBoard(p.x, p.y)
              const archive = !id && !board && engine.hitArchive(p.x, p.y)
              engine.selected = id ?? board ?? (archive ? ARCHIVE_ID : null)
              if (id) openChat(id)
              else if (board) openNote(board)
              else if (archive) useChat.getState().openNoteFile(dir, O.archiveFile)
            }}
            onDoubleClick={(e) => {
              const p = toScene(e)
              const id = engine.hit(p.x, p.y) ?? engine.hitBoard(p.x, p.y)
              if (id) useApp.getState().requestFocus(id)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              const p = toScene(e)
              const id = engine.hit(p.x, p.y)
              const board = id ? null : engine.hitBoard(p.x, p.y)
              const r = wrap.current!.getBoundingClientRect()
              const at = { x: e.clientX - r.left, y: e.clientY - r.top }
              setMenu(id ? { id, kind: 'agent', ...at } : board ? { id: board, kind: 'board', ...at } : null)
            }}
          />
          <div className="office-overlay">
            {scene.desks.map((d) => {
              const n = terminals.get(d.id)
              const role = config?.roles.find((r) => r.id === n?.roleId)
              const preset = config?.presets.find((p) => p.id === n?.presetId)
              return (
                <div
                  key={d.id}
                  className="office-tag"
                  style={{ left: `${(d.x / scene.width) * 100}%`, top: `${((d.y + 5) / scene.height) * 100}%`, '--c': role?.color || '#7d8597' } as React.CSSProperties}
                >
                  <span>{n?.name}</span> <small>{preset?.label ?? n?.presetId}</small>
                  {helpersOf(d.id) > 0 && <small className="office-tag-helpers">{O.helpersTag(helpersOf(d.id))}</small>}
                </div>
              )
            })}
            {scene.boards.map((b) => (
              <div key={b.id} className="office-tag note" style={{ left: `${(b.x / scene.width) * 100}%`, top: `${((b.y - 57) / scene.height) * 100}%` }}>
                {b.file}
              </div>
            ))}
            {scene.archive && (
              <div className="office-tag note archive" style={{ left: `${(scene.archive.x / scene.width) * 100}%`, top: `${((scene.archive.y - 51) / scene.height) * 100}%` }}>
                {O.archive}
              </div>
            )}
            <div ref={bubbleLayer} />
            <div ref={tip} className="office-tip" hidden />
          </div>
        </div>
      )}
      <div className="office-foot">
        {scene.desks.length > 0 && (
          <ScenePicker dir={dir} own={active.doc.officeScene} fallback={defaultScene} open={scenePicker} setOpen={setScenePicker} />
        )}
        <span className="office-hint">{O.hint}</span>
      </div>
      {menu?.kind === 'board' && (
        <div className="office-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" {...hint('escritorio.menu.nota')} onClick={() => (openNote(menu.id), setMenu(null))}>
            {O.openNote}
          </button>
          <button type="button" role="menuitem" {...hint('escritorio.menu.canvas')} onClick={() => (useApp.getState().requestFocus(menu.id), setMenu(null))}>
            {O.showOnCanvas}
          </button>
        </div>
      )}
      {menu?.kind === 'agent' && !menu.step && (
        <div className="office-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" {...hint('escritorio.menu.chat')} onClick={() => (openChat(menu.id), setMenu(null))}>
            {O.openChat}
          </button>
          <button
            type="button"
            role="menuitem"
            {...hint('escritorio.menu.aparencia')}
            onClick={() => (setDialog({ kind: 'editTerminal', id: menu.id, tab: 'look' }), setMenu(null))}
          >
            {O.look}
          </button>
          <button type="button" role="menuitem" {...hint('escritorio.menu.editar')} onClick={() => (setDialog({ kind: 'editTerminal', id: menu.id }), setMenu(null))}>
            {O.edit}
          </button>
          <button type="button" role="menuitem" {...hint('escritorio.menu.canvas')} onClick={() => (useApp.getState().requestFocus(menu.id), setMenu(null))}>
            {O.showOnCanvas}
          </button>
          <span className="office-menu-sep" aria-hidden="true" />
          <button type="button" role="menuitem" aria-haspopup="menu" {...hint('escritorio.menu.interagir')} onClick={() => setMenu({ ...menu, step: 'alvo' })}>
            {O.interact}
          </button>
        </div>
      )}
      {menu?.kind === 'agent' && menu.step === 'alvo' && (
        <div className="office-menu" role="menu" aria-label={O.interactWho(terminals.get(menu.id)?.name ?? '')} style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <span className="office-menu-title">{O.interactWho(terminals.get(menu.id)?.name ?? '')}</span>
          {scene.desks.filter((d) => d.id !== menu.id).length === 0 && <span className="office-menu-hint">{O.interactNobody}</span>}
          {scene.desks
            .filter((d) => d.id !== menu.id)
            .map((d) => (
              <button key={d.id} type="button" role="menuitem" onClick={() => setMenu({ ...menu, step: 'acao', target: d.id })}>
                {terminals.get(d.id)?.name ?? d.id}
              </button>
            ))}
          <span className="office-menu-sep" aria-hidden="true" />
          <button type="button" role="menuitem" {...hint('escritorio.menu.voltar')} onClick={() => setMenu({ ...menu, step: undefined })}>
            {O.back}
          </button>
        </div>
      )}
      {menu?.kind === 'agent' && menu.step === 'acao' && menu.target && (
        <div className="office-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <span className="office-menu-title">{O.interactWhat(terminals.get(menu.id)?.name ?? '', terminals.get(menu.target)?.name ?? '')}</span>
          {ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              {...hint(`escritorio.acao.${action}`)}
              onClick={() => {
                engine.interact(menu.id, menu.target!, action)
                setMenu(null)
              }}
            >
              {O.actions[action]}
            </button>
          ))}
          <span className="office-menu-sep" aria-hidden="true" />
          <button type="button" role="menuitem" {...hint('escritorio.menu.voltar')} onClick={() => setMenu({ ...menu, step: 'alvo', target: undefined })}>
            {O.back}
          </button>
        </div>
      )}
    </div>
  )
}
