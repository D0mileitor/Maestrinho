/** Textos de exportar/importar um time pronto. */
export const teamText = {
  section: 'Time completo',
  sectionLead:
    'Leve o time inteiro deste canvas para outra máquina ou colega: terminais com funções, modelo e esforço, notas, conexões, presets usados e colunas do quadro. Sessões, caminhos locais e hibernação não vão.',
  name: 'Nome do time',
  description: 'Descrição (opcional)',
  includeNotes: 'Incluir o conteúdo das notas (sem marcar, as notas vão vazias)',
  includeNotesHint: 'Confira se as notas não têm senhas, dados de clientes ou endereços internos antes de compartilhar.',
  export: 'Exportar time…',
  exported: (path: string) => `Time exportado em ${path}`,
  import: 'Importar time…',
  importTitle: (name: string) => `Importar o time "${name}"`,
  importLead:
    'Confira o que vai entrar. Nada roda sozinho: os terminais iniciam com os presets desta máquina, a menos que você aceite um preset do arquivo.',
  terminals: 'Terminais',
  roles: 'Funções',
  notes: 'Notas',
  presets: 'Presets do arquivo',
  presetsHint: 'Marque só presets em que você confia: eles definem o comando que cada terminal executa.',
  presetStatus: {
    igual: 'igual ao desta máquina',
    diferente: 'diferente do desta máquina (marcado: entra como preset novo; sem marcar: usa o seu)',
    novo: 'não existe nesta máquina (sem marcar: o terminal vira shell)',
    ausente: 'sem preset nesta máquina (vira shell)'
  } as Record<string, string>,
  roleStatus: { nova: 'nova', existente: 'já existe (usa a sua)' } as Record<string, string>,
  noteStatus: { nova: 'nova', igual: 'igual à sua', copia: 'você já tem uma diferente (entra como cópia)' } as Record<string, string>,
  renamed: (to: string) => `já existe um terminal com esse nome aqui: o novo vira "${to}" (tire o antigo do canvas antes, se o time novo for substituí-lo)`,
  noteReuse: 'você já tem uma com esse nome: o time novo usa a sua, como está',
  noteCopy: 'você já tem uma com esse nome: entra o modelo do time como cópia (nome com -2)',
  applyBoard: (cols: string) => `Usar as colunas do quadro do time: ${cols}`,
  applyBoardHint: 'Cartões de colunas que deixarem de existir vão para a primeira coluna.',
  confirm: 'Importar time',
  cancel: 'Cancelar',
  presetsAdded: (names: string[]) => `Presets adicionados: ${names.join(', ')}.`
} as const
