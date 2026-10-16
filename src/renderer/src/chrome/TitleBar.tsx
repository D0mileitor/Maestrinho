import { APP_NAME } from '@shared/constants'
import { useApp } from '../store/appStore'
import { IS_CHAT_WINDOW } from '../lib/windowKind'
import { UsageButton } from '../usage/UsagePanel'
import { ActivityButton } from '../activity/ActivityPanel'
import { titleBarText as T } from '../i18n/titleBar'

/**
 * Barra de título do app (a nativa do Windows fica escondida). Arrasta a janela, duplo clique maximiza;
 * os botões do sistema ficam à direita, sobre a área reservada (variáveis env(titlebar-area-*)).
 */
export function TitleBar(): React.JSX.Element {
  const name = useApp((s) => s.active?.doc.name ?? null)
  return (
    <header className="titlebar">
      <span className="titlebar-mark" aria-hidden="true" />
      <span className="titlebar-title">
        {IS_CHAT_WINDOW && <span className="titlebar-kind">{T.chat}</span>}
        {name ? <strong>{name}</strong> : null}
        <span className="titlebar-app">{name ? ` — ${APP_NAME}` : APP_NAME}</span>
      </span>
      {!IS_CHAT_WINDOW && <ActivityButton />}
      {!IS_CHAT_WINDOW && <UsageButton />}
    </header>
  )
}
