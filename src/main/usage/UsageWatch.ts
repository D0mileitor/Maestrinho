import { usageAlerts, usagePauseFor, type UsagePause, type UsageReport, type UsageWindow } from '@shared/usage'

/** Conferência periódica do uso (é só ler arquivos locais pequenos). */
const CHECK_MS = 3 * 60_000
const FIRST_CHECK_MS = 20_000

const PROVIDER: Record<string, string> = { claude: 'Claude', codex: 'Codex' }

export interface UsageWatchDeps {
  read(): Promise<UsageReport>
  settings(): { usageAlertPercent: number; usagePausePercent: number }
  notify(title: string, body: string): void
  /** A pausa automática começou ou acabou (rotinas e gatilhos consultam `paused()`). */
  onPauseChanged(pause: UsagePause | null): void
}

function windowName(w: Pick<UsageWindow, 'kind' | 'scope'>): string {
  const base = w.kind === 'session' ? 'sessão de 5 h' : w.kind === 'weekly' ? 'semana' : 'limite'
  return w.scope ? `${base} (${w.scope})` : base
}

function untilText(until: number | null): string {
  if (until === null) return ''
  return ` Reinicia ${new Date(until).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`
}

/**
 * Avisa quando uma janela da assinatura passa do percentual escolhido (uma vez por janela) e, se
 * configurado, pausa rotinas e gatilhos até a janela reiniciar.
 */
export class UsageWatch {
  private timer: NodeJS.Timeout | null = null
  private first: NodeJS.Timeout | null = null
  private readonly alerted = new Set<string>()
  private pause: UsagePause | null = null
  private checking = false

  constructor(private readonly deps: UsageWatchDeps) {}

  start(): void {
    if (this.timer) return
    this.first = setTimeout(() => void this.check(), FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check(), CHECK_MS)
    this.first.unref?.()
    this.timer.unref?.()
  }

  stop(): void {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
    this.first = this.timer = null
  }

  /** Motivo da pausa automática, ou null. */
  paused(): UsagePause | null {
    return this.pause
  }

  async check(now = Date.now()): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const s = this.deps.settings()
      const report = s.usageAlertPercent > 0 || s.usagePausePercent > 0 ? await this.deps.read() : { providers: [] }
      for (const a of usageAlerts(report, s.usageAlertPercent, now)) {
        if (this.alerted.has(a.key)) continue
        this.alerted.add(a.key)
        this.deps.notify(
          `${PROVIDER[a.provider] ?? a.provider}: ${Math.round(a.percent)}% da ${windowName(a.window)}`,
          `A assinatura está perto do limite.${untilText(a.window.resetsAt)}`
        )
      }
      const pause = usagePauseFor(report, s.usagePausePercent, now)
      const before = this.pause
      // Nada mudou (inclusive sem pausa antes e agora): não avisa nem registra "retomadas" a cada leitura.
      const same = pause && before ? pause.provider === before.provider && pause.kind === before.kind && pause.scope === before.scope : !pause && !before
      if (same) {
        this.pause = pause
        return
      }
      this.pause = pause
      if (pause) {
        this.deps.notify(
          'Rotinas e gatilhos pausados',
          `${PROVIDER[pause.provider] ?? pause.provider}: ${Math.round(pause.percent)}% da ${windowName(pause)}.${untilText(pause.until)}`
        )
      } else if (before) {
        this.deps.notify('Rotinas e gatilhos retomados', 'O uso da assinatura voltou para baixo do limite escolhido.')
      }
      this.deps.onPauseChanged(pause)
    } catch {
      // leitura falhou: tenta de novo no próximo ciclo
    } finally {
      this.checking = false
    }
  }
}
