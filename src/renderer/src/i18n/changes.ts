/** Textos da revisão das mudanças (git). */
export const changesText = {
  view: 'Mudanças',
  title: 'Mudanças',
  refresh: 'Atualizar',
  repo: 'Repositório',
  noRepo: 'Nenhum repositório git neste workspace. A revisão de mudanças funciona em pastas com git.',
  loading: 'Lendo as mudanças…',
  clean: 'Nada mudou desde o último commit.',
  truncated: 'Muitos arquivos alterados: mostrando os primeiros.',
  all: 'Todos',
  noAgent: 'Sem agente',
  filterAgent: 'Quem editou',
  selectAll: 'Selecionar todos',
  files: (n: number) => (n === 1 ? '1 arquivo' : `${n} arquivos`),
  kinds: { M: 'modificado', A: 'novo', D: 'apagado', R: 'renomeado', '?': 'novo (fora do git)', U: 'em conflito' } as Record<string, string>,
  editedBy: (names: string[]) => `editado por ${names.join(', ')}`,
  binary: 'Arquivo binário: sem diff para mostrar.',
  diffTruncated: 'Diff grande demais: mostrando o começo.',
  pickFile: 'Escolha um arquivo para ver o que mudou.',
  commitMessage: 'Mensagem do commit',
  commitPlaceholder: 'Ex.: Chamado 1042: busca de segurados por CPF com pontuação',
  commit: (n: number) => (n === 1 ? 'Commit de 1 arquivo' : `Commit de ${n} arquivos`),
  committed: (hash: string) => `Commit ${hash} feito.`,
  discard: 'Descartar',
  reviewer: 'Revisor',
  checkpoints: 'Checkpoints',
  ckBefore: (name: string) => `Antes do turno de ${name}`,
  ckSafety: 'Antes de voltar a um checkpoint',
  ckGoBack: 'Voltar aqui',
  ckEmpty: 'Nenhum checkpoint ainda. Eles são gravados quando um agente começa um turno neste repositório.',
  ckOff: 'Os checkpoints estão desligados (Configurações → Geral → Agentes); os antigos continuam aqui.',
  ckFooter: 'Arquivos ignorados pelo git (ex.: node_modules) e a pasta .maestrinho não são guardados nem restaurados.',
  ckNothing: 'Nada mudou desde este checkpoint.',
  ckConfirmTitle: 'Voltar a este checkpoint?',
  ckConfirm: (what: string, when: string, restore: string[], remove: string[]) => {
    const sample = (list: string[]) => list.slice(0, 6).join(', ') + (list.length > 6 ? ` e mais ${list.length - 6}` : '')
    const parts = [`${what} (${when}).`]
    if (restore.length) parts.push(`${restore.length === 1 ? '1 arquivo volta' : `${restore.length} arquivos voltam`} ao conteúdo daquele momento: ${sample(restore)}.`)
    if (remove.length) parts.push(`${remove.length === 1 ? '1 arquivo criado depois vai' : `${remove.length} arquivos criados depois vão`} para a lixeira: ${sample(remove)}.`)
    parts.push('O estado atual fica guardado num checkpoint de segurança, para desfazer. De preferência, faça isso com os agentes parados.')
    return parts.join(' ')
  },
  ckRestored: (restored: number, removed: number) =>
    `Checkpoint restaurado: ${restored === 1 ? '1 arquivo voltou' : `${restored} arquivos voltaram`}${removed ? `, ${removed} foram para a lixeira` : ''}.`,
  ckWhen: (at: number) => {
    const diff = Date.now() - at
    if (diff < 60_000) return 'agora'
    if (diff < 60 * 60_000) return `há ${Math.round(diff / 60_000)} min`
    const d = new Date(at)
    const sameDay = d.toDateString() === new Date().toDateString()
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    return sameDay ? `hoje, ${time}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${time}`
  },
  askReview: (n: number) => (n === 1 ? 'Pedir revisão de 1 arquivo' : `Pedir revisão de ${n} arquivos`),
  reviewSent: (name: string, n: number) => `Pedido de revisão (${n === 1 ? '1 arquivo' : `${n} arquivos`}) enviado para ${name}.`,
  noReviewer: 'Para pedir revisão, abra no canvas deste workspace um terminal com o agente revisor.',
  discardSelected: (n: number) => (n === 1 ? 'Descartar 1 arquivo' : `Descartar ${n} arquivos`),
  confirmDiscardTitle: 'Descartar mudanças?',
  confirmDiscard: (n: number) =>
    `${n === 1 ? 'O arquivo volta' : `Os ${n} arquivos voltam`} à versão do último commit. Nada se perde de vez: arquivos novos e uma cópia do conteúdo atual dos modificados vão para a lixeira.`,
  discarded: 'Mudanças descartadas (o conteúdo anterior está na lixeira).',
  ask: 'Pedir ajuste',
  askTo: 'Para',
  askPlaceholder: 'O que precisa mudar neste arquivo?',
  askLinePlaceholder: (n: number) => `O que precisa mudar na linha ${n}?`,
  send: 'Enviar',
  cancel: 'Cancelar',
  sent: (name: string) => `Pedido enviado a ${name}.`,
  lineHint: 'Clique no número de uma linha para pedir um ajuste nela',
  message: (file: string, line: number | null, code: string | null, text: string) =>
    `[Revisão do usuário] Em ${file}${line ? `, linha ${line}` : ''}${code ? ` (\`${code.trim().slice(0, 120)}\`)` : ''}: ${text}`
} as const
