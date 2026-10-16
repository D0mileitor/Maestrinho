import type { Routine, RoutineTrigger } from './schemas'

/**
 * Divide o texto de uma routine em passos. Uma linha contendo apenas `&&` separa passos: cada passo
 * só é enviado depois que o agente terminou (ficou ocioso) o anterior. Passos vazios são ignorados.
 *
 *   Rode os testes
 *   &&
 *   Corrija o que falhou
 */
export function parseRoutineSteps(script: string): string[] {
  const lines = script.replace(/\r\n?/g, '\n').split('\n')
  const steps: string[] = []
  let current: string[] = []
  const push = (): void => {
    const text = current.join('\n').trim()
    if (text) steps.push(text)
    current = []
  }
  for (const line of lines) {
    if (line.trim() === '&&') push()
    else current.push(line)
  }
  push()
  return steps
}

/**
 * Próximo disparo: a cada `intervalMinutes` a partir do último disparo (ou da criação). Se o app
 * ficou fechado e perdeu disparos, a routine roda uma única vez assim que possível (não acumula).
 */
export function nextRunAt(routine: Pick<Routine, 'intervalMinutes' | 'lastRunAt' | 'createdAt'>): number {
  const base = Date.parse(routine.lastRunAt ?? routine.createdAt)
  const anchor = Number.isFinite(base) ? base : 0
  return anchor + routine.intervalMinutes * 60_000
}

export function isDue(
  routine: Pick<Routine, 'intervalMinutes' | 'lastRunAt' | 'createdAt' | 'enabled'> & { trigger?: RoutineTrigger },
  now: number
): boolean {
  // Gatilhos por evento não disparam pelo relógio.
  if (routine.trigger && routine.trigger.kind !== 'interval') return false
  return routine.enabled && now >= nextRunAt(routine)
}

/** Texto curto para "a cada N minutos" (pt-BR). */
export function describeInterval(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440
    return d === 1 ? 'todo dia' : `a cada ${d} dias`
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60
    return h === 1 ? 'a cada hora' : `a cada ${h} horas`
  }
  return minutes === 1 ? 'a cada minuto' : `a cada ${minutes} minutos`
}

// ------------------------------------------------------------------ gatilhos por evento

/** Acontecimento que pode disparar rotinas (vindo do app: agentes, mensagens, quadro, arquivos). */
export type RoutineEvent =
  | { kind: 'agentDone'; terminalId: string }
  | { kind: 'message'; fromId: string; toId: string; mood: 'complaint' | 'praise' | null }
  | { kind: 'boardColumn'; column: string }
  | { kind: 'fileChange'; files: string[] }

function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

/**
 * Padrão glob ("src/**\/*.ts", "*.{ts,tsx}") em expressão regular, para caminhos com "/". `ignoreCase`
 * para sistemas de arquivos que não diferenciam maiúsculas (Windows).
 */
export function globToRegExp(pattern: string, ignoreCase = false): RegExp {
  let re = ''
  const p = pattern.trim().split('\\').join('/').replace(/^\.\//, '')
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]!
    if (ch === '*') {
      if (p[i + 1] === '*') {
        // "**/" casa zero ou mais pastas; "**" no fim casa tudo.
        const slash = p[i + 2] === '/'
        re += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else re += '[^/]*'
    } else if (ch === '?') re += '[^/]'
    else if (ch === '{' && p.indexOf('}', i) > i) {
      const end = p.indexOf('}', i)
      const options = p.slice(i + 1, end).split(',').map((x) => escapeRe(x).split('\\*').join('[^/]*'))
      re += `(?:${options.join('|')})`
      i = end
    } else re += escapeRe(ch)
  }
  // Padrão sem "/" (ex.: "*.ts") vale em qualquer pasta, como no .gitignore.
  return new RegExp(p.includes('/') ? `^${re}$` : `(?:^|/)${re}$`, ignoreCase ? 'i' : '')
}

/** Arquivos (relativos ao workspace, com "/") que batem com algum dos padrões separados por vírgula. */
export function matchingFiles(files: string[], patterns: string, ignoreCase = false): string[] {
  const res = patterns
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => globToRegExp(p, ignoreCase))
  return files.filter((f) => res.some((re) => re.test(f)))
}

/** O evento dispara este gatilho? */
export function triggerMatches(trigger: RoutineTrigger, event: RoutineEvent, ignoreCase = false): boolean {
  switch (trigger.kind) {
    case 'interval':
      return false
    case 'agentDone':
      return event.kind === 'agentDone' && event.terminalId === trigger.sourceId
    case 'message':
      return (
        event.kind === 'message' &&
        (!trigger.fromId || trigger.fromId === event.fromId) &&
        (!trigger.toId || trigger.toId === event.toId) &&
        (trigger.mood === 'any' || trigger.mood === event.mood)
      )
    case 'boardColumn':
      return event.kind === 'boardColumn' && event.column === trigger.column
    case 'fileChange':
      return event.kind === 'fileChange' && matchingFiles(event.files, trigger.pattern, ignoreCase).length > 0
  }
}

/**
 * Troca {origem}, {destino}, {tom}, {cartao} e {arquivos} no texto da rotina pelos dados do evento.
 * Chaves desconhecidas ficam como estão.
 */
export function renderRoutineScript(script: string, vars: Record<string, string>): string {
  return script.replace(/\{(origem|destino|tom|cartao|arquivos)\}/g, (m, k: string) => vars[k] ?? m)
}

/** Ainda cabe um disparo nesta hora? `fired` = instantes dos disparos anteriores (é podado). */
export function underHourlyCap(fired: number[], maxPerHour: number, now: number): boolean {
  while (fired.length > 0 && now - fired[0]! >= 3_600_000) fired.shift()
  return fired.length < maxPerHour
}

/** "quando construtor terminar", "quando revisor mandar reprovação para construtor"... (pt-BR). */
export function describeTrigger(
  routine: Pick<Routine, 'intervalMinutes'> & { trigger?: RoutineTrigger },
  nameOf: (id: string) => string,
  columnName: (id: string) => string = (id) => id
): string {
  const t = routine.trigger ?? { kind: 'interval' }
  switch (t.kind) {
    case 'interval':
      return describeInterval(routine.intervalMinutes)
    case 'agentDone':
      return `quando ${nameOf(t.sourceId)} terminar`
    case 'message': {
      const what = t.mood === 'complaint' ? 'uma reprovação' : t.mood === 'praise' ? 'uma aprovação' : 'mensagem'
      return `quando ${t.fromId ? nameOf(t.fromId) : 'um agente'} mandar ${what}${t.toId ? ` para ${nameOf(t.toId)}` : ''}`
    }
    case 'boardColumn':
      return `quando um cartão entrar em "${columnName(t.column)}"`
    case 'fileChange':
      return `quando mudar ${t.pattern}`
  }
}
