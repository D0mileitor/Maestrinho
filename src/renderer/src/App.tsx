import { useEffect, useRef } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useApp } from './store/appStore'
import { Sidebar } from './sidebar/Sidebar'
import { Welcome } from './welcome/Welcome'
import { TopBar } from './canvas/TopBar'
import { Canvas } from './canvas/Canvas'
import { PresetPickerDialog } from './dialogs/PresetPickerDialog'
import { PresetsDialog } from './dialogs/PresetsDialog'
import { ConfirmDialog, CorruptedDialog, Toasts } from './dialogs/SimpleDialogs'
import { ExtraDialogs } from './dialogs/ExtraDialogs'
import { Palette } from './palette/Palette'
import { ContextMenu } from './canvas/ContextMenu'
import { LiftOverlay } from './terminal/LiftOverlay'
import { ChatPanel } from './chat/ChatPanel'
import { OfficeView } from './office/OfficeView'
import { BoardView } from './board/BoardView'
import { ChangesView } from './changes/ChangesView'
import { HubPanel } from './hub/HubPanel'
import { UsagePanel } from './usage/UsagePanel'
import { ActivityPanel, AwayCard } from './activity/ActivityPanel'
import { useAwayWatch } from './store/activityStore'
import { setCharacterDir } from './office/customSprites'
import { useUi } from './store/uiStore'
import { useGlobalShortcuts } from './lib/useGlobalShortcuts'
import { setTerminalAppearance, themeFromCss } from './terminal/registry'
import { t } from './i18n'
import { teamChatText } from './i18n/teamChat'
import { useChat } from './store/chatStore'
import { CHAT_WINDOW_START, IS_CHAT_WINDOW } from './lib/windowKind'
import { TitleBar } from './chrome/TitleBar'
import { uiFontVars } from '@shared/uiFont'
import { HintLayer } from './hints/HintLayer'

function DialogHost(): React.JSX.Element | null {
  const dialog = useApp((s) => s.dialog)
  switch (dialog.kind) {
    case 'none':
      return null
    case 'presetPicker':
      return <PresetPickerDialog rect={dialog.rect} />
    case 'presets':
      return <PresetsDialog />
    case 'confirm':
      return <ConfirmDialog title={dialog.title} body={dialog.body} confirmLabel={dialog.confirmLabel} danger={dialog.danger} onConfirm={dialog.onConfirm} />
    case 'corrupted':
      return <CorruptedDialog dir={dialog.dir} error={dialog.error} backups={dialog.backups} />
    default:
      return <ExtraDialogs dialog={dialog} />
  }
}

/** "Mostrar minimapa ao abrir": vale ao abrir o app e quando a configuração muda (Ctrl+Shift+M continua alternando). */
function useMinimapSetting(): void {
  const show = useApp((s) => s.config?.settings.showMinimap)
  useEffect(() => {
    if (show !== undefined) useUi.getState().setMinimap(show)
  }, [show])
}

/** Fonte e tamanho do texto da interface (Configurações → Geral) nas variáveis CSS da raiz. */
function useInterfaceFont(): void {
  const family = useApp((s) => s.config?.settings.uiFontFamily)
  const size = useApp((s) => s.config?.settings.uiFontSize)
  useEffect(() => {
    if (family === undefined || size === undefined) return
    const style = document.documentElement.style
    for (const [name, value] of Object.entries(uiFontVars({ uiFontFamily: family, uiFontSize: size }))) {
      if (value === null) style.removeProperty(name)
      else style.setProperty(name, value)
    }
  }, [family, size])
}

/** Personagens próprios do escritório: valem os do workspace ativo. */
function useCharacterDir(): void {
  const dir = useApp((s) => s.active?.dir ?? '')
  useEffect(() => setCharacterDir(dir), [dir])
}

/** Mantém o tema/fonte dos terminais em sincronia com as configurações. */
function useTerminalAppearance(): void {
  const theme = useApp((s) => s.theme)
  const settings = useApp((s) => s.config?.settings)
  useEffect(() => {
    if (!settings) return
    // Lê as variáveis CSS depois que o data-theme foi aplicado.
    requestAnimationFrame(() =>
      setTerminalAppearance({
        theme: themeFromCss(theme),
        fontFamily: settings.terminalFontFamily,
        fontSize: settings.terminalFontSize,
        scrollback: settings.scrollback
      })
    )
  }, [theme, settings])
}

/** Janela do chat destacado: só o chat (abas e chat geral), do workspace ativo. */
function ChatWindowApp(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const active = useApp((s) => s.active)
  const init = useApp((s) => s.init)
  const started = useRef(false)
  useInterfaceFont()
  useCharacterDir()

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (!active) return
    document.title = teamChatText.windowTitle(active.doc.name)
    if (started.current) return
    started.current = true
    useChat.getState().setOpen(true, active.dir)
    if (CHAT_WINDOW_START.dir === active.dir) useChat.getState().selectTab(CHAT_WINDOW_START.tab)
  }, [active])

  if (!ready) return <div className="boot">{t.app.loading}</div>
  return (
    <div className="app-frame">
      <TitleBar />
      <div className="app-shell chat-window">
        <ChatPanel />
        <DialogHost />
        <Toasts />
        <HintLayer />
      </div>
    </div>
  )
}

export function App(): React.JSX.Element {
  return IS_CHAT_WINDOW ? <ChatWindowApp /> : <MainApp />
}

function MainApp(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const active = useApp((s) => s.active)
  const init = useApp((s) => s.init)
  const view = useUi((s) => s.view)
  useGlobalShortcuts()
  useTerminalAppearance()
  useInterfaceFont()
  useAwayWatch()
  useCharacterDir()
  useMinimapSetting()

  useEffect(() => {
    void init()
  }, [init])

  if (!ready) return <div className="boot">{t.app.loading}</div>

  return (
    <div className="app-frame">
      <TitleBar />
      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
          {active ? (
            <ReactFlowProvider key={active.dir}>
              <TopBar />
              <Canvas />
              {view === 'office' && <OfficeView />}
              {view === 'board' && <BoardView />}
              {view === 'changes' && <ChangesView />}
              {view === 'canvas' && <HubPanel />}
            </ReactFlowProvider>
          ) : (
            <Welcome />
          )}
          <ChatPanel />
          <UsagePanel />
          <ActivityPanel />
          <AwayCard />
        </div>
        <LiftOverlay />
        <DialogHost />
        <Palette />
        <ContextMenu />
        <Toasts />
        <HintLayer />
      </div>
    </div>
  )
}
