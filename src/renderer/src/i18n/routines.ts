/** Textos do "Quando" das rotinas (intervalo ou gatilho por evento). */
export const routinesText = {
  when: 'Quando',
  kinds: {
    interval: 'A cada N minutos',
    agentDone: 'Quando um agente terminar',
    message: 'Quando um agente mandar mensagem a outro',
    boardColumn: 'Quando um cartão entrar numa coluna do quadro',
    fileChange: 'Quando arquivos mudarem'
  },
  intervalLabel: 'Intervalo (minutos)',
  source: 'Agente',
  from: 'De',
  to: 'Para',
  anyAgent: 'qualquer agente',
  mood: 'Tom',
  moods: { any: 'qualquer mensagem', complaint: 'reprovação', praise: 'aprovação' },
  column: 'Coluna',
  pattern: 'Arquivos (padrão)',
  patternHint: 'Ex.: src/**/*.ts, *.md (vários separados por vírgula). node_modules, .git e pastas de build ficam de fora.',
  vars: {
    agentDone: 'No texto, {origem} vira o nome do agente que terminou.',
    message: 'No texto: {origem} quem mandou, {destino} quem recebeu, {tom} reprovação/aprovação.',
    boardColumn: 'No texto, {cartao} vira o número e o título do cartão.',
    fileChange: 'No texto, {arquivos} vira a lista dos arquivos que mudaram.'
  },
  cap: 'Máximo de disparos por hora',
  waiting: 'aguardando o evento'
}
