import { useEffect } from 'react'
import { useApp, type Tool } from '../store/appStore'
import { useChat } from '../store/chatStore'
import { useUi } from '../store/uiStore'
import { EditableName } from '../nodes/EditableName'
import {
  IconArrow,
  IconChat,
  IconHub,
  IconClock,
  IconGear,
  IconGlobe,
  IconMoon,
  IconNote,
  IconPencil,
  IconPointer,
  IconRect,
  IconScore,
  IconSearch,
  IconSun,
  IconTerminal,
  IconText,
  IconUsers
} from '../lib/icons'
import { FloorTabs } from './FloorTabs'
import { t } from '../i18n'
import { boardText } from '../i18n/board'
import { changesText } from '../i18n/changes'
import { hint } from '../hints/hint'
import type { HintKey } from '../i18n/hints'

const TOOLS: { tool: Tool; label: string; Icon: (p: { size?: number }) => React.JSX.Element }[] = [
  { tool: 'select', label: t.toolbar.select, Icon: IconPointer },
  { tool: 'terminal', label: t.toolbar.terminal, Icon: IconTerminal },
  { tool: 'note', label: t.toolbar.note, Icon: IconNote },
  { tool: 'text', label: t.toolbar.text, Icon: IconText },
  { tool: 'rect', label: t.toolbar.rect, Icon: IconRect },
  { tool: 'arrow', label: t.toolbar.arrow, Icon: IconArrow },
  { tool: 'draw', label: t.toolbar.draw, Icon: IconPencil },
  { tool: 'portal', label: t.toolbar.portal, Icon: IconGlobe }
]

/** Ferramentas de desenho que somem da barra em janela estreita (os atalhos L, B, A, D, P continuam). */
const EXTRA_TOOLS: ReadonlySet<Tool> = new Set(['text', 'rect', 'arrow', 'draw', 'portal'])

/** Barra superior: nome do workspace e floors à esquerda, ferramentas ao centro, ações à direita. */
export function TopBar(): React.JSX.Element {
  const active = useApp((s) => s.active)
  const tool = useApp((s) => s.tool)
  const setTool = useApp((s) => s.setTool)
  const setDialog = useApp((s) => s.setDialog)
  const setPalette = useApp((s) => s.setPalette)
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const applyOps = useApp((s) => s.applyOps)
  const chatOpen = useChat((s) => s.open || s.detached)
  const view = useUi((s) => s.view)
  const hubOpen = useUi((s) => s.hubOpen)

  // Cada workspace lembra a última visão (canvas ou escritório).
  useEffect(() => {
    useUi.getState().loadView(active?.dir ?? null)
  }, [active?.dir])

  useEffect(() => {
    document.title = active ? `${active.doc.name} — Maestrinho` : 'Maestrinho'
  }, [active])

  return (
    <header className="topbar">
      <div className="topbar-left">
        {active && (
          <EditableName
            className="ws-title"
            value={active.doc.name}
            title={`${active.dir}\nClique duas vezes para renomear o workspace. Canvas, notas, quadro e cenário ficam em .maestrinho dentro desta pasta.`}
            validate={(v) => (v.trim() ? null : 'dê um nome ao workspace')}
            onCommit={(name) => void applyOps([{ op: 'setName', name }])}
          />
        )}
        <FloorTabs />
      </div>
      <div className="toolbar" role="toolbar" aria-label="Ferramentas">
        <div className="view-toggle" role="group" aria-label={t.office.viewLabel}>
          <button type="button" aria-pressed={view === 'canvas'} {...hint('topo.visao.canvas')} onClick={() => useUi.getState().setView('canvas')}>
            {t.office.canvas}
          </button>
          <button type="button" aria-pressed={view === 'office'} {...hint('topo.visao.escritorio')} onClick={() => useUi.getState().setView('office')}>
            {t.office.office}
          </button>
          <button type="button" aria-pressed={view === 'board'} {...hint('topo.visao.quadro')} onClick={() => useUi.getState().setView('board')}>
            {boardText.view}
          </button>
          <button type="button" aria-pressed={view === 'changes'} {...hint('topo.visao.mudancas')} onClick={() => useUi.getState().setView('changes')}>
            {changesText.view}
          </button>
        </div>
        <span className="toolbar-sep" aria-hidden="true" />
        {view === 'canvas' && TOOLS.map(({ tool: tl, label, Icon }) => (
          <button
            key={tl}
            className={`tool-btn${tool === tl ? ' active' : ''}${EXTRA_TOOLS.has(tl) ? ' tool-extra' : ''}`}
            {...hint(`topo.ferramenta.${tl}` as HintKey)}
            aria-label={label}
            aria-pressed={tool === tl}
            onClick={() => setTool(tl)}
          >
            <Icon size={16} />
          </button>
        ))}
        {view === 'canvas' && <span className="toolbar-sep" aria-hidden="true" />}
        <button
          className={`tool-btn${chatOpen ? ' active' : ''}`}
          {...hint('topo.chat')}
          aria-label={t.chat.open}
          aria-pressed={chatOpen}
          onClick={() => {
            // Chat destacado: o botão traz a janela dele para a frente.
            const st = useChat.getState()
            st.setOpen(st.detached || !st.open, active?.dir ?? null)
          }}
        >
          <IconChat size={16} />
        </button>
      </div>
      <div className="topbar-right">
        <button className="tool-btn wide" {...hint('topo.buscar')} onClick={() => setPalette(true)}>
          <IconSearch size={15} />
          <span>{t.toolbar.search}</span>
          <span className="kbd">Ctrl K</span>
        </button>
        <button className="tool-btn" {...hint('topo.presets')} aria-label={t.toolbar.presets} onClick={() => setDialog({ kind: 'presets' })}>
          <IconTerminal size={16} />
        </button>
        <button className="tool-btn" {...hint('topo.papeis')} aria-label={t.toolbar.roles} onClick={() => setDialog({ kind: 'roles' })}>
          <IconUsers size={16} />
        </button>
        <button className="tool-btn" {...hint('topo.rotinas')} aria-label={t.toolbar.routines} onClick={() => setDialog({ kind: 'routines' })}>
          <IconClock size={16} />
        </button>
        <button
          className="tool-btn"
          {...hint('topo.partituras')}
          aria-label={t.toolbar.partituras}
          onClick={() => setDialog({ kind: 'partituras' })}
        >
          <IconScore size={16} />
        </button>
        {view === 'canvas' && (
          <button
            className={`tool-btn${hubOpen ? ' active' : ''}`}
            {...hint('topo.hub')}
            aria-label={t.hub.open}
            aria-pressed={hubOpen}
            onClick={() => useUi.getState().setHubOpen(!hubOpen)}
          >
            <IconHub size={16} />
          </button>
        )}
        <button className="tool-btn" {...hint('topo.tema')} aria-label={t.toolbar.theme} onClick={toggleTheme}>
          {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>
        <button className="tool-btn" {...hint('topo.configuracoes')} aria-label={t.toolbar.settings} onClick={() => setDialog({ kind: 'settings' })}>
          <IconGear size={16} />
        </button>
      </div>
    </header>
  )
}
