/** Textos do quadro de chamados (kanban). */
export const boardText = {
  view: 'Quadro',
  title: 'Quadro de chamados',
  lead: 'Arraste os cartões entre as colunas. Os agentes também criam e movem cartões com "orq board".',
  filter: 'Filtrar cartões',
  filterPlaceholder: 'Filtrar por título, chamado ou agente',
  newCard: 'Novo cartão',
  addHere: 'Adicionar cartão',
  columns: 'Colunas',
  agents: 'Agentes',
  agentsHint: 'Solte um cartão num agente para passar o chamado para ele (ele recebe a mensagem no terminal).',
  dropHere: 'Solte aqui',
  empty: 'Nenhum cartão',
  emptyBoard: 'O quadro está vazio. Crie o primeiro cartão ou peça a um agente: orq board add "<título>" --ticket <número>.',
  loading: 'Carregando o quadro…',
  card: {
    titleLabel: 'Título',
    ticket: 'Chamado',
    ticketPlaceholder: 'número do chamado',
    column: 'Coluna',
    assignee: 'Responsável',
    noAssignee: 'Ninguém',
    note: 'Nota ligada',
    notePlaceholder: 'ex.: chamado-atual.md',
    openNote: 'Abrir nota',
    description: 'Descrição',
    descriptionPlaceholder: 'O que precisa ser feito, critérios de aceite, links…',
    history: 'Histórico',
    comment: 'Comentar',
    commentPlaceholder: 'Escreva um comentário e tecle Enter',
    send: 'Passar para o agente',
    sent: (name: string) => `Cartão passado para ${name}.`,
    remove: 'Excluir cartão',
    confirmRemove: (title: string) => `O cartão "${title}" e o histórico dele serão apagados do quadro. A nota ligada não é apagada.`,
    close: 'Fechar',
    created: (by: string, when: string) => `Criado por ${by} ${when}`,
    save: 'Salvar',
    seq: (n: number) => `#${n}`
  },
  columnsDialog: {
    title: 'Colunas do quadro',
    lead: 'Renomeie, reordene, crie ou exclua colunas. Cartões de uma coluna excluída vão para a primeira.',
    add: 'Nova coluna',
    up: 'Subir',
    down: 'Descer',
    remove: 'Excluir coluna',
    name: 'Nome da coluna',
    save: 'Salvar colunas',
    reset: 'Voltar às colunas padrão'
  },
  ago: (ms: number) => {
    const m = Math.round(ms / 60_000)
    if (m < 1) return 'agora'
    if (m < 60) return `há ${m} min`
    const h = Math.round(m / 60)
    if (h < 24) return `há ${h} h`
    const d = Math.round(h / 24)
    return `há ${d} d`
  },
  you: 'você'
} as const
