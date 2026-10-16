/**
 * Strings da interface das notas (nó de nota e diálogo de criação), em pt-BR.
 * Funções recebem os valores dinâmicos; nada de concatenação espalhada pelos componentes.
 */
export const notesStrings = {
  node: {
    view: 'Visualizar',
    edit: 'Editar',
    modeGroup: 'Modo da nota',
    openFolder: 'Abrir a pasta das notas no explorador',
    remove: 'Remover do canvas (o arquivo .md é mantido)',
    location: (file: string) => `.maestrinho/notes/${file}`,
    loading: 'Carregando…',
    empty: 'Nota vazia.',
    emptyHint: 'Clique duas vezes para escrever.',
    missingTitle: 'Arquivo não encontrado',
    missingBody: (file: string) => `.maestrinho/notes/${file} não existe (foi removido ou renomeado fora do app).`,
    missingRestoreHint: 'O último conteúdo visto será restaurado.',
    recreate: 'Recriar arquivo',
    readError: 'Não foi possível ler a nota',
    retry: 'Tentar de novo',
    unsaved: 'não salvo',
    saveFailed: 'erro ao salvar',
    saveFailedTitle: (msg: string) => `A última gravação falhou: ${msg}`,
    conflictTitle: 'O arquivo mudou fora do editor',
    conflictBody: 'Um agente ou outro programa alterou esta nota enquanto você editava.',
    removedTitle: 'O arquivo foi removido fora do editor',
    removedBody: 'Suas alterações ainda não foram gravadas.',
    reload: 'Recarregar',
    keepMine: 'Manter o meu',
    recreateWithMine: 'Recriar com o meu texto',
    discard: 'Descartar',
    editorLabel: (file: string) => `Editor da nota ${file}`,
    editorHint: 'Markdown · Ctrl+S salva · Esc volta à visualização',
    placeholder: 'Escreva em Markdown…',
    imageLabel: (alt: string) => `[imagem: ${alt}]`,
    imageNoAlt: 'sem descrição',
    linkNotOnCanvas: (file: string) => `A nota ${file} não está neste canvas.`,
    linkUnsupported: 'Este tipo de link não é aberto pelo app.',
    taskToggle: 'Marcar/desmarcar tarefa',
    footnotes: 'Notas de rodapé',
    footnoteBack: (index: number) => `Voltar à referência ${index + 1}`,
    renamed: (from: string, to: string) => `${from} já tinha sido recriado por fora; seu texto foi salvo em ${to}.`,
    finalSaveFailed: (file: string, msg: string) => `Não foi possível gravar ${file}: ${msg}`
  },
  create: {
    title: 'Nova nota',
    lead: 'Crie um arquivo Markdown em .maestrinho/notes ou coloque no canvas uma nota que já existe.',
    name: 'Nome do arquivo',
    nameHint: 'Termina em .md (acrescentado se faltar). Use "pasta/nome.md" para uma subpasta.',
    existsHint: 'Já existe uma nota com esse nome: ela será aberta no canvas.',
    existing: 'Notas existentes',
    noExisting: 'Nenhuma nota neste workspace ainda.',
    noMatches: 'Nenhuma nota existente com esse nome.',
    nameRequired: 'Informe o nome da nota.',
    loadingList: 'Carregando notas…',
    onCanvas: 'no canvas',
    size: (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`),
    create: 'Criar nota',
    open: 'Abrir nota',
    noWorkspace: 'Abra um workspace antes de criar notas.'
  },
  common: {
    cancel: 'Cancelar'
  },
  errors: {
    invalidName: (reason: string) => `Nome inválido: ${reason}`
  }
} as const

export type NotesStrings = typeof notesStrings
