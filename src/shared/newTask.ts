/**
 * "Nova tarefa": os agentes do andar começam uma conversa nova, sem o contexto da tarefa anterior; o chat
 * geral e as abas de cada agente ficam limpos (eles mostram a conversa atual de cada um). As conversas antigas
 * não são apagadas: continuam nos históricos dos próprios agentes.
 *
 * Terminais de shell (e SSH) ficam de fora: reiniciar derrubaria o que estiver rodando neles.
 */

export interface NewTaskTerminal {
  id: string
  name: string
  presetId: string
  hibernated?: boolean
}

export interface NewTaskRuntime {
  status: string
  activity?: string
}

export interface NewTaskPlan {
  /** Recomeçam agora: o processo reinicia numa conversa nova. */
  restart: NewTaskTerminal[]
  /** Hibernados ou parados: só esquecem a conversa; a nova começa quando o terminal for iniciado. */
  later: NewTaskTerminal[]
  /** Shells: não são tocados. */
  shells: NewTaskTerminal[]
  /** Dos que recomeçam, os que estão no meio de um turno (o trabalho em andamento é interrompido). */
  busy: NewTaskTerminal[]
}

export function planNewTask(
  terminals: NewTaskTerminal[],
  isShell: (presetId: string) => boolean,
  runtime: (id: string) => NewTaskRuntime | undefined
): NewTaskPlan {
  const plan: NewTaskPlan = { restart: [], later: [], shells: [], busy: [] }
  for (const t of terminals) {
    if (isShell(t.presetId)) {
      plan.shells.push(t)
      continue
    }
    const rt = runtime(t.id)
    if (t.hibernated || !rt) {
      plan.later.push(t)
      continue
    }
    plan.restart.push(t)
    if (rt.status === 'running' && rt.activity === 'busy') plan.busy.push(t)
  }
  return plan
}
