import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  MiniMap,
  Controls,
  ControlButton,
  ConnectionMode,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useStore,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type EdgeTypes,
  type Viewport
} from '@xyflow/react'
import { newId } from '@shared/ids'
import type { CanvasNode, WorkspaceDoc } from '@shared/schemas'
import { edgeKey } from '@shared/workspaceOps'
import { pickHandles } from '@shared/layout'
import { useApp, visibleNodes, type FlowRect } from '../store/appStore'
import { useUi } from '../store/uiStore'
import { TerminalNode } from '../nodes/TerminalNode'
import { nodeTypesExtra } from '../nodes/registry'
import { ConnectionEdge } from '../edges/ConnectionEdge'
import { StaffBackground } from './StaffBackground'
import { CreationOverlay, type CreationTool } from './CreationOverlay'
import {
  DEFAULT_NOTE_SIZE,
  DEFAULT_PORTAL_SIZE,
  DEFAULT_TERMINAL_SIZE,
  canvasBridge,
  setCanvasBridge,
  snap,
  useSettledZoom
} from './bridge'
import type { AppRFNode, ConnectionRFEdge } from './types'
import { focusTerminal, getTerminal } from '../terminal/registry'
import { createShapeNode } from '../nodes/shapes'
import { t } from '../i18n'
import { useContextMenu, type MenuItem } from './ContextMenu'
import { copySelection, duplicateSelection, hasClipboard, pasteClipboard, tidySelection } from '../store/editing'
import { api } from '../lib/api'
import { HUB_DRAG_TYPE } from '@shared/hub'
import { insertFromHub } from '../hub/HubPanel'
import { hint } from '../hints/hint'

const nodeTypes: NodeTypes = { terminal: TerminalNode, ...nodeTypesExtra } as NodeTypes
const edgeTypes: EdgeTypes = { connection: ConnectionEdge } as EdgeTypes

/**
 * Botões de zoom do canto do canvas: os mesmos do React Flow (classes e ícones SVG copiados do
 * @xyflow/react, MIT, Copyright (c) 2019-2025 webkid GmbH), com os hints do app no lugar dos títulos em inglês.
 */
function ZoomButtons(): React.JSX.Element {
  const rf = useReactFlow()
  const minReached = useStore((s) => s.transform[2] <= s.minZoom)
  const maxReached = useStore((s) => s.transform[2] >= s.maxZoom)
  return (
    <>
      <ControlButton className="react-flow__controls-zoomin" {...hint('canvas.zoom.aproximar', { label: true })} disabled={maxReached} onClick={() => void rf.zoomIn()}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
          <path d="M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" />
        </svg>
      </ControlButton>
      <ControlButton className="react-flow__controls-zoomout" {...hint('canvas.zoom.afastar', { label: true })} disabled={minReached} onClick={() => void rf.zoomOut()}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 5">
          <path d="M0 0h32v4.2H0z" />
        </svg>
      </ControlButton>
      <ControlButton
        className="react-flow__controls-fitview"
        {...hint('canvas.enquadrarTudo', { label: true })}
        onClick={() => void rf.fitView({ padding: 0.12, duration: 250 })}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 30">
          <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
        </svg>
      </ControlButton>
    </>
  )
}

function toRfNode(n: CanvasNode, prev: AppRFNode | undefined): AppRFNode {
  const dragging = prev?.dragging
  const resizing = prev?.resizing
  return {
    id: n.id,
    type: n.kind,
    position: dragging || resizing ? prev!.position : { x: n.position.x, y: n.position.y },
    width: resizing ? prev!.width : n.size.w,
    height: resizing ? prev!.height : n.size.h,
    data: prev && prev.data.node === n ? prev.data : { node: n },
    selected: prev?.selected ?? false,
    dragging,
    resizing,
    dragHandle: '.node-drag',
    zIndex: n.kind === 'shape' ? 0 : 1
  } as AppRFNode
}

function buildNodes(doc: WorkspaceDoc, prev: AppRFNode[]): AppRFNode[] {
  const prevMap = new Map(prev.map((p) => [p.id, p]))
  return visibleNodes(doc).map((n) => toRfNode(n, prevMap.get(n.id)))
}

function buildEdges(doc: WorkspaceDoc, visible: Set<string>, prev: ConnectionRFEdge[]): ConnectionRFEdge[] {
  const prevMap = new Map(prev.map((e) => [e.id, e]))
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  return doc.edges
    .filter((e) => visible.has(e.source) && visible.has(e.target))
    .map((e) => {
      // A conexão sai do lado voltado para o outro nó (recalculado quando os nós se movem).
      const a = byId.get(e.source)
      const b = byId.get(e.target)
      const handles = a && b ? pickHandles(a, b) : { sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null }
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
        type: 'connection' as const,
        selected: prevMap.get(e.id)?.selected ?? false
      }
    })
}

/** Ordem de leitura (linhas de cima para baixo, depois da esquerda para a direita). */
function readingOrder(nodes: CanvasNode[]): string[] {
  const terms = nodes.filter((n) => n.kind === 'terminal')
  return [...terms]
    .sort((a, b) => {
      const rowA = Math.round(a.position.y / 200)
      const rowB = Math.round(b.position.y / 200)
      return rowA !== rowB ? rowA - rowB : a.position.x - b.position.x
    })
    .map((n) => n.id)
}

export function Canvas(): React.JSX.Element {
  const active = useApp((s) => s.active)!
  const doc = active.doc
  const tool = useApp((s) => s.tool)
  const applyOps = useApp((s) => s.applyOps)
  const setDialog = useApp((s) => s.setDialog)
  const setSelection = useApp((s) => s.setSelection)
  const focusRequest = useApp((s) => s.focusRequest)
  const showGrid = useApp((s) => s.config?.settings.showGrid ?? true)
  const minimapOpen = useUi((s) => s.minimapOpen)
  const officeView = useUi((s) => s.view !== 'canvas')
  const setJumpOrder = useUi((s) => s.setJumpOrder)
  const connectFrom = useUi((s) => s.connectFrom)
  const setConnectFrom = useUi((s) => s.setConnectFrom)
  const setSettledZoom = useSettledZoom((s) => s.set)
  const rf = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [nodes, setNodes] = useState<AppRFNode[]>(() => buildNodes(doc, []))
  const [edges, setEdges] = useState<ConnectionRFEdge[]>([])

  useEffect(() => {
    setNodes((prev) => buildNodes(doc, prev))
  }, [doc])

  const visibleIds = useMemo(() => new Set(visibleNodes(doc).map((n) => n.id)), [doc])
  useEffect(() => {
    setEdges((prev) => buildEdges(doc, visibleIds, prev))
  }, [doc, visibleIds])

  useEffect(() => {
    setJumpOrder(readingOrder(visibleNodes(doc)))
  }, [doc, setJumpOrder])

  // Zoom inicial (o viewport vem do documento).
  useEffect(() => {
    setSettledZoom(doc.viewport.zoom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.dir])

  // Ponte para atalhos globais / paleta.
  useEffect(() => {
    setCanvasBridge({
      fitView: () => void rf.fitView({ padding: 0.12, duration: 250 }),
      zoomIn: () => void rf.zoomIn({ duration: 150 }),
      zoomOut: () => void rf.zoomOut({ duration: 150 }),
      centerOnNode: (id, frame) => {
        const n = rf.getNode(id)
        if (!n) return
        const w = n.width ?? n.measured?.width ?? 400
        const h = n.height ?? n.measured?.height ?? 300
        if (frame) {
          void rf.fitBounds({ x: n.position.x, y: n.position.y, width: w, height: h }, { padding: 0.15, duration: 280 })
        } else {
          void rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 0.85), duration: 280 })
        }
      },
      viewportCenter: () => {
        const el = wrapperRef.current
        const r = el?.getBoundingClientRect()
        if (!r) return { x: 0, y: 0 }
        return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      },
      screenToFlow: (p) => rf.screenToFlowPosition(p)
    })
    return () => setCanvasBridge(null)
  }, [rf])

  // Pedido de foco (paleta, notificação, Ctrl+1..9, atenção...).
  useEffect(() => {
    if (!focusRequest) return
    const n = rf.getNode(focusRequest.id)
    if (!n) return
    setNodes((prev) => prev.map((p) => ({ ...p, selected: p.id === focusRequest.id })))
    const w = n.width ?? 400
    const h = n.height ?? 300
    // Só move a vista se o nó não estiver inteiro na tela (ou se o zoom estiver ilegível).
    const el = wrapperRef.current?.getBoundingClientRect()
    const zoom = rf.getZoom()
    let moved = false
    if (el) {
      const tl = rf.flowToScreenPosition({ x: n.position.x, y: n.position.y })
      const br = rf.flowToScreenPosition({ x: n.position.x + w, y: n.position.y + h })
      const visible = tl.x >= el.left && tl.y >= el.top && br.x <= el.right && br.y <= el.bottom
      if (!visible || zoom < 0.5) {
        void rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(zoom, 0.75), duration: 260 })
        moved = true
      }
    }
    setTimeout(() => focusTerminal(focusRequest.id), moved ? 280 : 30)
  }, [focusRequest, rf])

  const onNodesChange = useCallback((changes: NodeChange<AppRFNode>[]) => {
    // Remoção só acontece por ação explícita (Ctrl+W/Delete com confirmação), nunca pelo React Flow.
    const allowed = changes.filter((c) => c.type !== 'remove')
    setNodes((nds) => applyNodeChanges(allowed, nds))
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange<ConnectionRFEdge>[]) => {
    const allowed = changes.filter((c) => c.type === 'select')
    setEdges((eds) => applyEdgeChanges(allowed, eds))
  }, [])

  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, _node: AppRFNode, dragged: AppRFNode[]) => {
      const ops = dragged.map((n) => ({
        op: 'updateNode' as const,
        id: n.id,
        patch: { position: { x: snap(n.position.x), y: snap(n.position.y) } }
      }))
      if (ops.length) void applyOps(ops)
    },
    [applyOps]
  )

  const isValidConnection = useCallback(
    (c: Connection | { source: string; target: string }) => {
      if (!c.source || !c.target || c.source === c.target) return false
      const a = doc.nodes.find((n) => n.id === c.source)
      const b = doc.nodes.find((n) => n.id === c.target)
      if (!a || !b || a.kind === 'shape' || b.kind === 'shape') return false
      const key = edgeKey(c.source, c.target)
      return !doc.edges.some((e) => edgeKey(e.source, e.target) === key)
    },
    [doc]
  )

  const connect = useCallback(
    (source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null) => {
      if (!isValidConnection({ source, target })) return
      void applyOps([
        { op: 'addEdges', edges: [{ id: newId('e'), source, target, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null }] }
      ])
    },
    [applyOps, isValidConnection]
  )

  const onConnect = useCallback(
    (c: Connection) => connect(c.source, c.target, c.sourceHandle, c.targetHandle),
    [connect]
  )

  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMoveEnd = useCallback(
    (_e: MouseEvent | TouchEvent | null, vp: Viewport) => {
      setSettledZoom(vp.zoom)
      if (viewportTimer.current) clearTimeout(viewportTimer.current)
      viewportTimer.current = setTimeout(() => {
        void applyOps([{ op: 'setViewport', viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } }])
      }, 600)
    },
    [applyOps, setSettledZoom]
  )

  const defaultSize = useCallback((tl: CreationTool) => {
    if (tl === 'terminal') return DEFAULT_TERMINAL_SIZE
    if (tl === 'note') return DEFAULT_NOTE_SIZE
    if (tl === 'portal') return DEFAULT_PORTAL_SIZE
    if (tl === 'text') return { w: 240, h: 60 }
    return { w: 240, h: 160 }
  }, [])

  const onCreate = useCallback(
    (tl: CreationTool, rect: FlowRect, points?: [number, number][]) => {
      if (tl === 'terminal') setDialog({ kind: 'presetPicker', rect })
      else if (tl === 'note') setDialog({ kind: 'noteCreate', rect })
      else if (tl === 'portal') setDialog({ kind: 'portalCreate', rect })
      else {
        const node = createShapeNode(tl, rect, points, doc.activeFloorId)
        void applyOps([{ op: 'addNodes', nodes: [node] }])
      }
    },
    [setDialog, applyOps, doc.activeFloorId]
  )

  const openPaneMenu = (x: number, y: number, p: { x: number; y: number }): void => {
    const at = (size: { w: number; h: number }): FlowRect => ({ x: snap(p.x), y: snap(p.y), ...size })
    useContextMenu.getState().show(x, y, [
      {
        label: 'Novo terminal aqui',
        hint: 'T',
        help: 'canvas.menu.novoTerminal',
        onSelect: () => setDialog({ kind: 'presetPicker', rect: at(DEFAULT_TERMINAL_SIZE) })
      },
      { label: 'Nova nota aqui', hint: 'N', help: 'canvas.menu.novaNota', onSelect: () => setDialog({ kind: 'noteCreate', rect: at(DEFAULT_NOTE_SIZE) }) },
      {
        label: 'Novo portal aqui',
        hint: 'P',
        help: 'canvas.menu.novoPortal',
        onSelect: () => setDialog({ kind: 'portalCreate', rect: at(DEFAULT_PORTAL_SIZE) })
      },
      'sep',
      { label: 'Colar', hint: 'Ctrl+V', help: 'canvas.menu.colar', disabled: !hasClipboard(), onSelect: () => pasteClipboard() },
      { label: 'Enquadrar tudo', hint: 'Ctrl+0', help: 'canvas.enquadrarTudo', onSelect: () => void rf.fitView({ padding: 0.12, duration: 250 }) }
    ])
  }

  const openNodeMenu = (x: number, y: number, id: string): void => {
    const s = useApp.getState()
    const node = s.active?.doc.nodes.find((n) => n.id === id)
    if (!node) return
    // Garante que a ação valha para o nó clicado (e para a seleção, se ele fizer parte dela).
    if (!s.selection.includes(id)) {
      setNodes((prev) => prev.map((p) => ({ ...p, selected: p.id === id })))
      s.setSelection([id])
    }
    const ids = useApp.getState().selection.includes(id) ? useApp.getState().selection : [id]
    const items: (MenuItem | 'sep')[] = []
    if (node.kind === 'terminal') {
      const ctrl = getTerminal(id)
      const selected = ctrl?.term.hasSelection() ? ctrl.term.getSelection() : ''
      items.push(
        {
          label: 'Copiar seleção',
          hint: 'Ctrl+Shift+C',
          help: 'canvas.menu.copiarSelecao',
          disabled: !selected,
          onSelect: () => void navigator.clipboard.writeText(selected).catch(() => undefined)
        },
        {
          label: 'Colar no terminal',
          hint: 'Ctrl+Shift+V',
          help: 'canvas.menu.colarTerminal',
          onSelect: () =>
            void navigator.clipboard
              .readText()
              .then(async (text) => {
                // Sem texto: pode ser um print (o caminho da imagem gravada é colado).
                if (!text) {
                  if (!(await ctrl?.pasteClipboardImage())) s.toast('info', 'A área de transferência está vazia.')
                  return
                }
                // Respeita o bracketed paste se o programa o pediu (o xterm cuida disso).
                ctrl?.term.paste(text)
                focusTerminal(id)
              })
              .catch(() => s.toast('warn', 'Não foi possível ler a área de transferência.'))
        },
        'sep',
        { label: 'Renomear', hint: 'F2', help: 'canvas.menu.renomear', onSelect: () => useUi.getState().requestRename(id) },
        { label: 'Editar terminal…', help: 'no.terminal.menu.editar', onSelect: () => setDialog({ kind: 'editTerminal', id }) },
        { label: 'Reiniciar processo', help: 'no.terminal.reiniciar', onSelect: () => void api.invoke('pty:restart', { id }) },
        { label: 'Nova conversa (descartar sessão)', help: 'no.terminal.menu.novaConversa', onSelect: () => void api.invoke('pty:newSession', { id }) },
        { label: 'Conectar a…', hint: 'Ctrl+L', help: 'canvas.menu.conectar', onSelect: () => useUi.getState().setConnectFrom(id) },
        'sep'
      )
    } else if (node.kind === 'note' || node.kind === 'portal') {
      items.push({ label: 'Conectar a…', hint: 'Ctrl+L', help: 'canvas.menu.conectar', onSelect: () => useUi.getState().setConnectFrom(id) }, 'sep')
    }
    items.push(
      { label: 'Duplicar', hint: 'Ctrl+D', help: 'canvas.menu.duplicar', onSelect: () => duplicateSelection() },
      { label: 'Copiar', hint: 'Ctrl+C', help: 'canvas.menu.copiar', onSelect: () => void copySelection() },
      {
        label: 'Organizar seleção em grade',
        hint: 'Ctrl+Shift+T',
        help: 'canvas.menu.organizar',
        disabled: ids.length < 2,
        onSelect: () => tidySelection()
      },
      { label: 'Enquadrar', hint: 'Ctrl+\\', help: 'canvas.menu.enquadrar', onSelect: () => canvasBridge()?.centerOnNode(id, true) },
      'sep',
      {
        label: ids.length > 1 ? `Remover ${ids.length} nós` : 'Remover',
        hint: 'Ctrl+W',
        help: 'canvas.menu.remover',
        danger: true,
        onSelect: () => s.confirmRemoveNodes(ids)
      }
    )
    useContextMenu.getState().show(x, y, items)
  }

  const onPaneDoubleClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement
    if (!target.classList.contains('react-flow__pane')) return
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setDialog({
      kind: 'presetPicker',
      rect: { x: snap(p.x - DEFAULT_TERMINAL_SIZE.w / 2), y: snap(p.y - 20), ...DEFAULT_TERMINAL_SIZE }
    })
  }

  const empty = nodes.length === 0

  return (
    <div
      className="canvas-root"
      ref={wrapperRef}
      onDoubleClick={onPaneDoubleClick}
      hidden={officeView}
      onDragOver={(e) => {
        // Cartão das partituras prontas sendo arrastado para o canvas.
        if (!e.dataTransfer.types.includes(HUB_DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(HUB_DRAG_TYPE)
        if (!id) return
        e.preventDefault()
        void insertFromHub(id, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
      }}
    >
      <ReactFlow<AppRFNode, ConnectionRFEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={({ nodes: sel }) => setSelection(sel.map((n) => n.id))}
        onNodeClick={(e, node) => {
          if (connectFrom) {
            connect(connectFrom, node.id)
            setConnectFrom(null)
            return
          }
          const el = e.target as HTMLElement
          if (node.type === 'terminal' && !el.closest('button, input, .node-name-edit')) focusTerminal(node.id)
        }}
        onPaneClick={() => {
          if (connectFrom) setConnectFrom(null)
          const ae = document.activeElement as HTMLElement | null
          if (ae && ae !== document.body) ae.blur()
        }}
        onMoveEnd={onMoveEnd}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
          openPaneMenu(e.clientX, e.clientY, p)
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault()
          openNodeMenu(e.clientX, e.clientY, node.id)
        }}
        defaultViewport={doc.viewport}
        minZoom={0.1}
        maxZoom={3}
        snapToGrid
        snapGrid={[20, 20]}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        disableKeyboardA11y
        zoomOnDoubleClick={false}
        panOnScroll
        zoomOnScroll={false}
        zoomActivationKeyCode={['Control', 'Meta', 'Alt']}
        panOnDrag={[1]}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={28}
        elevateNodesOnSelect
        nodeDragThreshold={3}
        proOptions={{ hideAttribution: true }}
        colorMode={useApp.getState().theme}
      >
        {showGrid && <StaffBackground />}
        {minimapOpen && <MiniMap pannable zoomable className="minimap" nodeBorderRadius={4} />}
        <Controls showInteractive={false} showZoom={false} showFitView={false} className="zoom-controls">
          <ZoomButtons />
        </Controls>
      </ReactFlow>
      {empty && tool === 'select' && (
        <div className="canvas-empty">
          <strong>{t.canvas.emptyTitle}</strong>
          <span>{t.canvas.emptyBody}</span>
        </div>
      )}
      {connectFrom && <div className="connect-hint">Clique no nó de destino para conectar (Esc cancela)</div>}
      {tool !== 'select' && <CreationOverlay tool={tool} onCreate={onCreate} defaultSize={defaultSize} />}
    </div>
  )
}
