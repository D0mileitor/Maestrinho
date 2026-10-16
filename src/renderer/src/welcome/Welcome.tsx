import { useApp } from '../store/appStore'
import { IconFolder } from '../lib/icons'
import { t } from '../i18n'
import { hint } from '../hints/hint'

/** Tela sem workspace aberto: convite direto para abrir uma pasta. */
export function Welcome(): React.JSX.Element {
  const pick = useApp((s) => s.pickAndOpenWorkspace)
  const workspaces = useApp((s) => s.workspaces)
  const openWorkspace = useApp((s) => s.openWorkspace)
  const info = useApp((s) => s.info)
  return (
    <main className="welcome">
      <div className="welcome-card">
        <div className="welcome-mark" aria-hidden="true" />
        <h1>{t.welcome.title}</h1>
        <p>{t.welcome.body}</p>
        <button className="btn btn-primary welcome-open" {...hint('boasvindas.abrir')} onClick={() => void pick()}>
          <IconFolder /> {t.welcome.open}
        </button>
        {workspaces.length > 0 && (
          <section className="welcome-recent">
            <h2>{t.welcome.recent}</h2>
            <ul>
              {workspaces.map((w) => (
                <li key={w.dir}>
                  <button
                    className="recent-item"
                    {...hint(w.exists ? 'boasvindas.recente' : 'lateral.ausente')}
                    disabled={!w.exists}
                    onClick={() => void openWorkspace(w.dir)}
                  >
                    <strong>{w.name}</strong>
                    <span className="muted">{w.exists ? w.dir : `${w.dir} — ${t.welcome.missing}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {info && (
          <p className="welcome-foot muted">
            {info.appName} {info.version}, Electron {info.electron}. Tudo roda localmente.
          </p>
        )}
      </div>
    </main>
  )
}
