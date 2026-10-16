import { splitDuration } from '@shared/usage'

const pad = (n: number): string => String(n).padStart(2, '0')

/** "2 h 05 min", "35 min", "3 dias e 4 h". */
function duration(ms: number): string {
  const { days, hours, minutes } = splitDuration(ms)
  if (days > 0) return hours > 0 ? `${days} ${days === 1 ? 'dia' : 'dias'} e ${hours} h` : `${days} ${days === 1 ? 'dia' : 'dias'}`
  if (hours > 0) return `${hours} h ${pad(minutes)} min`
  return `${Math.max(1, minutes)} min`
}

/** Textos do painel de uso da assinatura dos agentes. */
export const usageText = {
  open: 'Uso da assinatura',
  title: 'Uso da assinatura',
  refresh: 'Atualizar',
  close: 'Fechar',
  providers: { claude: 'Claude', codex: 'OpenAI · Codex' } as Record<string, string>,
  session: 'Sessão (5 h)',
  weekly: (scope: string | null) => (scope ? `Semana · ${scope}` : 'Semana'),
  other: (minutes: number | null, scope: string | null) => {
    const base = minutes ? `Janela de ${duration(minutes * 60_000)}` : 'Outro limite'
    return scope ? `${base} · ${scope}` : base
  },
  notStarted: 'começa na próxima mensagem',
  reset: 'já reiniciou',
  resetsIn: (ms: number) => `reinicia em ${duration(ms)}`,
  resetsAt: (when: number) =>
    `reinicia ${new Date(when).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
  updated: (ms: number) => (ms < 60_000 ? 'atualizado agora' : `atualizado há ${duration(ms)}`),
  stale: {
    claude: 'O Claude Code atualiza estes números enquanto está aberto.',
    codex: 'O Codex grava estes números a cada resposta.'
  } as Record<string, string>,
  peak: (percent: number) => `Maior uso agora: ${percent}%`,
  empty:
    'Nenhum uso de assinatura encontrado neste computador. O painel mostra o que o Claude Code e o Codex guardam quando são usados: abra um deles e mande uma mensagem.',
  footer: 'Lido dos arquivos dos próprios agentes neste computador; nada vai para a rede.',
  byAgent: 'Por agente',
  periodSession: '5 h',
  periodWeek: 'Semana',
  agentsNote: 'Divisão aproximada entre os agentes do Maestrinho; o uso fora do app também conta no limite.',
  noAgents: 'Nenhum agente do Maestrinho usou esta assinatura no período.',
  tokens: (input: number, output: number, cache: number) => `${compact(input)} entrada · ${compact(output)} saída · ${compact(cache)} cache`,
  paused: (provider: string, percent: number, window: string, until: number | null) =>
    `Rotinas e gatilhos pausados: ${provider} em ${percent}% (${window}).${until ? ` Voltam ${new Date(until).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.` : ''}`,
  settingsLink: 'Alertas e pausa automática…',
  pauseWindow: (kind: string, scope: string | null) => {
    const base = kind === 'session' ? 'sessão de 5 h' : kind === 'weekly' ? 'semana' : 'limite'
    return scope ? `${base}, ${scope}` : base
  },
  // Configurações → Geral → Agentes
  alertSetting: 'Avisar com uso acima de',
  pauseSetting: 'Pausar rotinas acima de',
  never: 'Nunca',
  percentOption: (n: number) => `${n}%`
}

const COMPACT = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })

/** 1234 → "1,2 mil"; 3400000 → "3,4 mi". */
function compact(n: number): string {
  return COMPACT.format(n)
}
