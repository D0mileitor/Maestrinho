import { CLI_NAME } from '@shared/constants'

/**
 * Strings (pt-BR) do gerenciador de papéis, da edição de terminal e do menu "⋯" do nó de terminal.
 * Funções recebem os valores dinâmicos; os componentes não concatenam texto.
 */

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

export const rolesText = {
  title: 'Papéis',
  lead: `Instruções reutilizáveis que definem como cada agente trabalha. O texto entra nas instruções do agente junto com a referência do ${CLI_NAME} e vale para terminais iniciados ou reiniciados depois de salvar.`,
  listLabel: 'Papéis cadastrados',
  newRole: 'Novo papel',
  defaultName: 'Novo papel',
  builtin: 'de fábrica',
  noInstructions: 'sem instruções',
  unsaved: 'não salvo',
  empty: 'Nenhum papel cadastrado. Crie um para começar.',
  fields: {
    name: 'Nome',
    nameHint: `Gerentes usam o nome em "${CLI_NAME} recruit --role <papel>".`,
    color: 'Cor do selo',
    colorHint: 'Formato #RRGGBB. Vazio usa a cor padrão.',
    colorInvalid: 'Use o formato #RRGGBB (ex.: #5fb98e).',
    colorPresets: 'Cores sugeridas',
    noColor: 'Sem cor',
    swatch: (color: string) => `Usar a cor ${color}`,
    picker: 'Escolher outra cor',
    preview: 'Prévia do selo',
    instructions: 'Instruções',
    instructionsHint: 'Escreva em segunda pessoa ("Você revisa…"). Ctrl+Enter salva.',
    count: (n: number, max: number) => `${n.toLocaleString('pt-BR')} / ${max.toLocaleString('pt-BR')}`
  },
  save: 'Salvar papel',
  delete: 'Excluir papel',
  saved: (name: string) => `Papel "${name}" salvo.`,
  deleted: (name: string) => `Papel "${name}" excluído.`,
  affected: (names: string[]) =>
    `${plural(names.length, 'O terminal', 'Os terminais')} ${names.join(', ')} ${plural(names.length, 'está', 'estão')} em execução com este papel e só ${plural(names.length, 'recebe', 'recebem')} o novo texto ao reiniciar.`,
  restartAffected: (n: number) => (n === 1 ? 'Reiniciar agora' : `Reiniciar os ${n} agora`),
  confirmDelete: (name: string, using: number) => {
    const parts = [`Excluir o papel "${name}"?`]
    if (using > 0) {
      parts.push(`${using} ${plural(using, 'terminal deste workspace usa', 'terminais deste workspace usam')} este papel.`)
    }
    parts.push(
      'Terminais em execução com este papel continuam rodando com as instruções atuais até serem reiniciados; depois disso ficam sem papel.'
    )
    return parts.join('\n\n')
  },
  confirmDiscard: 'Descartar as alterações não salvas deste papel?',
  errors: {
    duplicate: 'já existe um papel com esse nome',
    invalidValue: 'valor inválido',
    field: (field: string, message: string) => (field ? `${field}: ${message}` : message)
  }
} as const

export const editTerminalText = {
  title: (name: string) => `Editar terminal "${name}"`,
  titleMissing: 'Editar terminal',
  lead: 'Nome, agente, papel e pasta deste terminal.',
  missing: 'Este terminal não existe mais no workspace.',
  fields: {
    name: 'Nome',
    nameHint: `Usado pelos agentes em "${CLI_NAME} send <nome>". Sem espaços.`,
    preset: 'Agente',
    notFound: ' — não encontrado no PATH',
    missingPreset: (id: string) => `(preset "${id}" não existe mais)`,
    role: 'Papel',
    noRole: 'Sem papel',
    deletedRole: '(papel excluído)',
    manager: 'Modo gerente (pode recrutar, dispensar e conectar agentes)',
    cwd: 'Diretório de trabalho',
    cwdHint: 'Relativo à pasta do workspace (ou do floor) ou absoluto. Vazio = raiz. Pasta inexistente = raiz.'
  },
  applyNote:
    'Renomear vale na hora. Agente, papel, modo gerente e pasta só valem quando o processo do terminal reinicia.',
  errors: {
    nameTaken: 'já existe um terminal com esse nome',
    invalidName: 'nome inválido',
    invalidValue: 'valor inválido',
    invalid: (field: string, message: string) => (field ? `${field}: ${message}` : message)
  },
  restartTitle: 'Reiniciar para aplicar?',
  restartBody: (name: string) =>
    `"${name}" ainda está rodando com a configuração anterior. Reiniciar encerra o processo atual — o agente perde a conversa em andamento — e o inicia de novo com as alterações.`,
  restartNow: 'Reiniciar agora para aplicar',
  later: 'Depois'
} as const

export const terminalMenuText = {
  trigger: 'Mais ações',
  label: (name: string) => `Ações do terminal ${name}`,
  edit: 'Editar…',
  restart: 'Reiniciar',
  newSession: 'Nova conversa (sem retomar a sessão)',
  copyName: 'Copiar nome',
  copySend: `Copiar comando ${CLI_NAME} send`,
  close: 'Fechar',
  copiedName: (name: string) => `Nome "${name}" copiado.`,
  copiedSend: (cmd: string) => `Copiado: ${cmd}`,
  copyFailed: 'Não foi possível copiar para a área de transferência.'
} as const
