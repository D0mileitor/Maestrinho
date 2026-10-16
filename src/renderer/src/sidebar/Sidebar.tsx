import type { WorkspaceListItem } from '@shared/ipc'
import { useApp } from '../store/appStore'
import { IconClose, IconFolder, IconPlus, IconSidebar } from '../lib/icons'
import { api, errorMessage } from '../lib/api'
import { t } from '../i18n'
import { hint, hintOf, type HintAttrs } from '../hints/hint'
import type { HintText } from '../hints/content'
import { hintText } from '../i18n/hints'

function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Hint de um workspace da lista: nome, pasta e o que acontece ao clicar (ou por que está indisponível). */
function workspaceHint(w: WorkspaceListItem, opts: { label?: boolean } = {}): HintAttrs {
  const h: HintText = hintText[w.exists ? 'lateral.workspace' : 'lateral.ausente']
  return hintOf({ title: w.name, body: [w.dir, h.body].filter(Boolean).join('\n'), ...(w.exists && h.keys ? { keys: h.keys } : {}) }, opts)
}

/** Lista de workspaces (pastas de projeto). Um ponto de latão marca os que estão com terminais vivos. */
export function Sidebar(): React.JSX.Element {
  const workspaces = useApp((s) => s.workspaces)
  const open = useApp((s) => s.sidebarOpen)
  const setSidebar = useApp((s) => s.setSidebar)
  const openWorkspace = useApp((s) => s.openWorkspace)
  const pick = useApp((s) => s.pickAndOpenWorkspace)
  const closeWorkspace = useApp((s) => s.closeWorkspace)
  const forget = useApp((s) => s.forgetWorkspace)
  const setDialog = useApp((s) => s.setDialog)
  const toast = useApp((s) => s.toast)

  if (!open) {
    return (
      <nav className="sidebar collapsed" aria-label={t.sidebar.title}>
        <button className="icon-btn" {...hint('lateral.expandir')} aria-label={t.sidebar.expand} onClick={() => setSidebar(true)}>
          <IconSidebar />
        </button>
        {workspaces.map((w) => (
          <button
            key={w.dir}
            className={`ws-mini${w.active ? ' active' : ''}${w.live ? ' live' : ''}`}
            {...workspaceHint(w, { label: true })}
            onClick={() => void openWorkspace(w.dir)}
          >
            {initials(w.name)}
          </button>
        ))}
        <button className="icon-btn" {...hint('lateral.adicionar')} aria-label={t.sidebar.add} onClick={() => void pick()}>
          <IconPlus />
        </button>
      </nav>
    )
  }

  return (
    <nav className="sidebar" aria-label={t.sidebar.title}>
      <div className="sidebar-head">
        <span className="sidebar-title">{t.sidebar.title}</span>
        <button className="icon-btn" {...hint('lateral.adicionar')} aria-label={t.sidebar.add} onClick={() => void pick()}>
          <IconPlus />
        </button>
        <button className="icon-btn" {...hint('lateral.recolher')} aria-label={t.sidebar.collapse} onClick={() => setSidebar(false)}>
          <IconSidebar />
        </button>
      </div>
      <ul className="ws-list">
        {workspaces.map((w) => (
          <li key={w.dir} className={`ws-item${w.active ? ' active' : ''}${w.exists ? '' : ' missing'}`}>
            <button
              className="ws-open"
              {...workspaceHint(w)}
              disabled={!w.exists}
              onClick={() => void openWorkspace(w.dir)}
            >
              <span className={`ws-dot${w.live ? ' live' : ''}`} {...(w.live ? hint('lateral.aoVivo') : {})} />
              <span className="ws-name">{w.name}</span>
              {!w.exists && <span className="muted"> ({t.welcome.missing})</span>}
            </button>
            <span className="ws-actions">
              {w.exists && (
                <button
                  className="icon-btn"
                  {...hint('lateral.abrirPasta')}
                  aria-label={t.sidebar.openFolder}
                  onClick={() => void api.invoke('app:openPath', { path: w.dir }).catch((e) => toast('error', errorMessage(e)))}
                >
                  <IconFolder size={13} />
                </button>
              )}
              <button
                className="icon-btn danger"
                {...hint(w.live ? 'lateral.fechar' : 'lateral.esquecer')}
                aria-label={w.live ? t.sidebar.close : t.sidebar.forget}
                onClick={() =>
                  w.live
                    ? setDialog({
                        kind: 'confirm',
                        title: 'Fechar workspace?',
                        body: `Os terminais de "${w.name}" serão encerrados. O layout fica salvo e volta quando você abrir a pasta de novo.`,
                        confirmLabel: 'Fechar workspace',
                        danger: true,
                        onConfirm: () => closeWorkspace(w.dir)
                      })
                    : void forget(w.dir)
                }
              >
                <IconClose size={13} />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </nav>
  )
}
