import type { ActivityEvent, AwaySummary } from '@shared/activity'

const ROUTINE_OUTCOME: Record<string, string> = {
  completed: 'concluída',
  terminalNotRunning: 'terminal parado',
  skippedBusy: 'pulada (agente ocupado)',
  skippedLimit: 'pulada (limite da assinatura)',
  skippedCap: 'pulada (limite por hora)',
  failed: 'falhou',
  cancelled: 'cancelada'
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many.replace('#', String(n)))

/** Textos da linha do tempo e do resumo "enquanto você estava fora". */
export const activityText = {
  open: 'Linha do tempo',
  title: 'Linha do tempo',
  close: 'Fechar',
  empty: 'Nada aconteceu ainda nesta sessão. Aqui aparecem os agentes que terminam ou pedem você, as mensagens entre eles, o quadro e as rotinas.',
  unseen: (n: number) => plural(n, '1 novidade', '# novidades'),
  line(e: ActivityEvent): string {
    switch (e.kind) {
      case 'done':
        return `${e.who} terminou`
      case 'waiting':
        return `${e.who} precisa de você`
      case 'message':
        return `${e.who} → ${e.to ?? '?'}`
      case 'board':
        return `Quadro: ${e.detail ?? ''}`
      case 'routine':
        return `Rotina "${e.who}": ${ROUTINE_OUTCOME[e.detail ?? ''] ?? e.detail ?? ''}`
      case 'exited':
        return `${e.who} parou com erro${e.detail ? ` (${e.detail})` : ''}`
      case 'limit':
        return `Rotinas e gatilhos ${e.detail ?? ''}`
      case 'newTask':
        return `Nova tarefa: ${e.detail ?? ''}`
    }
  },
  mood: { complaint: 'reprovação', praise: 'aprovação' } as Record<string, string>,
  awayTitle: (minutes: number) => `Enquanto você estava fora (${minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 6) / 10} h`})`,
  awayLines(s: AwaySummary): { text: string; warn?: boolean }[] {
    const out: { text: string; warn?: boolean }[] = []
    if (s.waiting.length) out.push({ text: `Esperando você: ${s.waiting.join(', ')}`, warn: true })
    if (s.exited.length) out.push({ text: `Parou com erro: ${s.exited.join(', ')}`, warn: true })
    if (s.done.length) out.push({ text: s.done.map((d) => `${d.who} terminou ${plural(d.count, '1 vez', '# vezes')}`).join('; ') })
    if (s.messages) {
      const tones = [s.complaints ? plural(s.complaints, '1 reprovação', '# reprovações') : '', s.praises ? plural(s.praises, '1 aprovação', '# aprovações') : '']
        .filter(Boolean)
        .join(', ')
      out.push({ text: `${plural(s.messages, '1 mensagem', '# mensagens')} entre agentes${tones ? ` (${tones})` : ''}` })
    }
    if (s.board.length) out.push({ text: `Quadro: ${s.board.slice(-3).join('; ')}${s.board.length > 3 ? ` e mais ${s.board.length - 3}` : ''}` })
    if (s.routines) out.push({ text: plural(s.routines, '1 execução de rotina', '# execuções de rotinas') })
    for (const l of s.limit) out.push({ text: `Rotinas e gatilhos ${l}`, warn: l.startsWith('pausadas') })
    return out
  },
  seeTimeline: 'Ver linha do tempo',
  dismiss: 'Fechar'
}
