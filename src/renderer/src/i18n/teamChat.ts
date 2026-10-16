/** Textos do chat em abas (fichário) e do chat geral. */
export const teamChatText = {
  tabsLabel: 'Conversas',
  notes: 'Notas',
  detach: 'Abrir o chat numa janela separada (dá para levar a outro monitor)',
  dock: 'Devolver o chat para a janela do Maestrinho',
  windowTitle: (ws: string) => `Chat — ${ws}`,
  general: 'Chat geral',
  generalHint: 'Todos os agentes numa conversa só, inclusive os recados entre eles. Use @ para falar com um agente.',
  generalEmpty: 'Nada por aqui ainda: as conversas dos agentes deste andar aparecem aqui, em ordem.',
  noAgents: 'Nenhum terminal neste andar. Crie um (duplo clique no canvas) e volte aqui.',
  to: 'Para',
  mentionHint: 'Digite @ para chamar um agente; vários: @dev @qa',
  placeholder: '@agente mensagem… (Enter envia)',
  sentTo: (names: string[]) => `Mensagem enviada para ${names.join(', ')}.`,
  noTarget: 'Diga para quem é a mensagem: comece com @ e o nome do agente.',
  youTo: (names: string) => `você → ${names}`,
  needsYou: (name: string) => `${name} precisa de você`,
  answer: 'Responder',
  working: (names: string) => `${names} trabalhando…`,
  noTranscript: (names: string) => `Sem histórico legível (veja na aba): ${names}`,
  tabState: {
    busy: 'trabalhando',
    idle: 'aguardando',
    attention: 'terminou',
    waiting: 'precisa de você',
    sleeping: 'hibernando',
    off: 'parado'
  } as Record<string, string>,
  unread: (n: number) => (n === 1 ? '1 mensagem nova' : `${n} mensagens novas`),
  newTask: 'Nova tarefa',
  newTaskAction: 'Nova tarefa: limpar o chat e começar conversas novas nos agentes',
  newTaskTitle: 'Começar uma nova tarefa?',
  newTaskConfirm: (p: { now: string[]; later: string[]; busy: string[]; shells: string[] }): string => {
    const names = (list: string[]): string => (list.length > 1 ? `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}` : (list[0] ?? ''))
    const all = [...p.now, ...p.later]
    const lines = [
      `${names(all)} ${all.length === 1 ? 'começa' : 'começam'} uma conversa nova, sem o contexto da tarefa anterior. O chat geral e as abas dos agentes ficam limpos.`
    ]
    if (p.later.length) lines.push(`${names(p.later)} ${p.later.length === 1 ? 'está parado ou hibernando: a conversa nova começa' : 'estão parados ou hibernando: a conversa nova começa'} quando ${p.later.length === 1 ? 'ele iniciar' : 'eles iniciarem'}.`)
    if (p.busy.length) lines.push(`Atenção: ${names(p.busy)} ${p.busy.length === 1 ? 'está trabalhando agora e será interrompido' : 'estão trabalhando agora e serão interrompidos'}.`)
    if (p.shells.length) lines.push(`Terminais de shell não são reiniciados: ${names(p.shells)}.`)
    lines.push('Nada é apagado: as conversas antigas continuam nos históricos dos agentes. Se o resumo da tarefa ainda não foi salvo, peça isso antes.')
    return lines.join('\n\n')
  },
  newTaskConfirmLabel: 'Começar nova tarefa',
  newTaskNone: 'Nenhum agente neste andar para recomeçar (terminais de shell não são reiniciados).',
  newTaskDone: (n: number) => (n === 1 ? 'Nova tarefa: 1 agente começou uma conversa nova.' : `Nova tarefa: ${n} agentes começaram conversas novas.`)
} as const
