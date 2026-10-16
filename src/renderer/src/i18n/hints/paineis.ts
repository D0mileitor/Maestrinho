import type { HintText } from '../../hints/content'

/** Hints dos painéis: chat, quadro de chamados, mudanças e partituras prontas. */
export const paineisHints = {
  // ---------------------------------------------------------------- chat (fichário e chat geral)
  'chat.redimensionar': { title: 'Largura do chat', body: 'Arraste para alargar ou estreitar o painel. A largura escolhida fica guardada para a próxima vez.' },
  'chat.destacar': {
    title: 'Abrir numa janela separada',
    body: 'Leva o chat para uma janela própria, que dá para pôr em outro monitor. As conversas e a aba aberta continuam as mesmas.'
  },
  'chat.devolver': {
    title: 'Devolver à janela do Maestrinho',
    body: 'Fecha esta janela e reabre o chat como painel lateral da janela principal, na mesma aba.'
  },
  'chat.fechar': { title: 'Fechar o chat', body: 'Só esconde o painel: os agentes continuam trabalhando. Reabra pelo botão de chat na barra de cima.' },
  'chat.fecharJanela': {
    title: 'Fechar o chat',
    body: 'Fecha esta janela; os agentes continuam trabalhando. Reabra pelo botão de chat na barra de cima do Maestrinho.'
  },
  'chat.aba.geral': {
    title: 'Chat geral',
    body: 'Todos os agentes deste andar numa conversa só, inclusive os recados que um manda ao outro. O número mostra quantos esperam por você.'
  },
  'chat.nota.verNoCanvas': {
    title: 'Ver no canvas',
    body: 'Mostra a nota no canvas da janela principal, onde dá para editá-la. Aqui no chat ela é só para leitura.'
  },
  'chat.nota.voltar': { title: 'Voltar à conversa', body: 'Fecha a nota e volta para a aba que estava aberta no chat.' },
  'chat.agente.verNoCanvas': {
    title: 'Ver o terminal no canvas',
    body: 'Leva até o terminal deste agente no canvas, para ver a tela completa ou digitar direto nele.'
  },
  'chat.geral.responder': { title: 'Responder', body: 'Abre a aba deste agente, onde aparecem a pergunta dele e as opções de resposta.' },
  'chat.geral.novaTarefa': {
    title: 'Nova tarefa',
    body:
      'Limpa o chat geral e as abas: os agentes deste andar começam uma conversa nova, sem o contexto da tarefa anterior ' +
      '(o terminal reinicia; shells ficam como estão). Nada é apagado: as conversas antigas continuam nos históricos dos agentes. ' +
      'Antes, peça a eles que salvem o resumo da tarefa.'
  },
  'chat.geral.para': {
    title: 'Destinatários',
    body: 'Quem recebe a próxima mensagem: os agentes citados com @ ou, sem @, o último com quem você falou no chat geral.'
  },
  'chat.acoes': {
    title: 'Ações seguidas do agente',
    body: 'Leituras, edições e comandos em sequência ficam agrupados. Clique para ver cada um, com o resultado.'
  },
  'chat.pergunta.respostaLivre': {
    title: 'Enviar esta resposta',
    body: 'Escolhe a opção de resposta escrita e digita o seu texto no terminal do agente.',
    keys: ['Enter']
  },
  'chat.pergunta.abrirTerminal': {
    title: 'Abrir no terminal',
    body: 'Mostra o terminal no canvas para responder por lá, se as opções daqui não bastarem.'
  },
  'chat.enviar': {
    title: 'Enviar',
    body: 'Digita a mensagem no terminal do agente, com os anexos. Se ele estiver hibernando, acorda e retoma a conversa antes.',
    keys: ['Enter']
  },
  'chat.geral.enviar': {
    title: 'Enviar',
    body: 'Manda para quem está em "Para". Sem @, vai para o último agente com quem você falou aqui; vários de uma vez: @dev @qa.',
    keys: ['Enter']
  },
  'chat.anexar': {
    title: 'Anexar print ou PDF',
    body: 'Escolha imagens ou PDFs para mandar com a mensagem. Também dá para arrastar arquivos para cá ou colar um print no campo.',
    keys: ['Ctrl+V']
  },
  'chat.removerAnexo': { title: 'Remover anexo', body: 'Tira o anexo desta mensagem. O arquivo em si não é apagado.' },
  'chat.modelo': { title: 'Modelo e esforço', body: 'Os usados na última resposta do agente. Para trocar, use /model e /effort no terminal.' },
  'chat.aprovacaoCodex': {
    title: 'Aprovação de comandos',
    body: 'Quando o Codex pede a sua aprovação antes de executar um comando. Troque com /approvals no terminal.'
  },
  'chat.modo': {
    title: 'Modo de permissão',
    body: 'Alterna entre pedir permissão, aceitar edições, planejar e os demais modos do Claude Code. Faz o mesmo que Shift+Tab no terminal.'
  },
  'chat.parar': {
    title: 'Parar o agente',
    body: 'Envia Esc ao terminal e interrompe o que ele está fazendo agora. A conversa continua: é só mandar a próxima mensagem.'
  },
  'chat.regua': {
    title: 'Suas mensagens',
    body: 'Um traço por mensagem que você mandou. Passe o mouse para ver a lista e clique numa para voltar até ela na conversa.'
  },

  // ---------------------------------------------------------------- quadro de chamados
  'quadro.filtro': {
    title: 'Filtrar cartões',
    body: 'Mostra só os cartões cujo título, número do chamado, responsável ou nota contêm o texto. Também aceita o número do cartão, como #12.'
  },
  'quadro.colunas': { title: 'Colunas do quadro', body: 'Renomeie, reordene, pinte, crie ou exclua as etapas do fluxo do chamado.' },
  'quadro.novoCartao': {
    title: 'Novo cartão',
    body: 'Cria um cartão na primeira coluna. Para criar direto em outra etapa, use Adicionar cartão no pé dela.'
  },
  'quadro.novo.cancelar': { title: 'Cancelar', body: 'Descarta o cartão que você estava escrevendo.', keys: ['Esc'] },
  'quadro.novo.criar': { title: 'Criar cartão', body: 'Cria o cartão nesta coluna com o título e o número do chamado informados.', keys: ['Enter'] },
  'quadro.cartao.fechar': { title: 'Fechar', body: 'Fecha os detalhes do cartão. Cada campo é salvo assim que você sai dele.', keys: ['Esc'] },
  'quadro.cartao.coluna': {
    title: 'Coluna',
    body: 'Em que etapa o chamado está. Mudar aqui é o mesmo que arrastar o cartão para outra coluna.'
  },
  'quadro.cartao.responsavel': {
    title: 'Responsável',
    body: 'Só registra quem cuida do chamado. Para o agente receber o cartão no terminal, use Passar para o agente.'
  },
  'quadro.cartao.nota': {
    title: 'Nota ligada',
    body: 'Nota do workspace com os detalhes do chamado (ex.: chamado-atual.md). Quem receber o cartão é avisado dela.'
  },
  'quadro.cartao.abrirNota': { title: 'Abrir nota', body: 'Mostra a nota ligada no painel do chat, só para leitura.' },
  'quadro.cartao.agente': { title: 'Agente que vai receber', body: 'Escolha o terminal que vai assumir o chamado.' },
  'quadro.cartao.passar': {
    title: 'Passar para o agente',
    body: 'O agente vira o responsável e recebe no terminal uma mensagem com o cartão, a descrição e a nota. Se estiver hibernando, acorda antes.'
  },
  'quadro.cartao.comentar': { title: 'Comentar', body: 'Registra o comentário no histórico do cartão, em seu nome e com a hora.', keys: ['Enter'] },
  'quadro.cartao.excluir': {
    title: 'Excluir cartão',
    body: 'Apaga o cartão e o histórico dele do quadro, depois de confirmar. A nota ligada não é apagada.'
  },
  'quadro.colunas.fechar': {
    title: 'Fechar sem salvar',
    body: 'Descarta as mudanças nas colunas: elas só valem depois de Salvar colunas.',
    keys: ['Esc']
  },
  'quadro.colunas.cor': { title: 'Cor da coluna', body: 'Aparece no topo da coluna e ajuda a achar a etapa de relance.' },
  'quadro.colunas.subir': { title: 'Subir', body: 'Move a coluna uma posição para a esquerda no quadro.' },
  'quadro.colunas.descer': { title: 'Descer', body: 'Move a coluna uma posição para a direita no quadro.' },
  'quadro.colunas.excluir': { title: 'Excluir coluna', body: 'Tira a coluna da lista. Ao salvar, os cartões dela vão para a primeira coluna.' },
  'quadro.colunas.nova': { title: 'Nova coluna', body: 'Acrescenta uma etapa no fim da lista. O quadro aceita até 12 colunas.' },
  'quadro.colunas.padrao': {
    title: 'Voltar às colunas padrão',
    body: 'Troca a lista pelas etapas padrão, de A fazer a Concluído. Só vale depois de salvar; cartões de colunas que saírem vão para a primeira.'
  },
  'quadro.colunas.salvar': {
    title: 'Salvar colunas',
    body: 'Aplica as mudanças no quadro. Cartões de colunas excluídas vão para a primeira coluna.'
  },

  // ---------------------------------------------------------------- revisão das mudanças (git)
  'mudancas.repositorio': {
    title: 'Repositório',
    body: 'Os repositórios git dentro do workspace. Escolha qual revisar; ao lado aparece a branch atual.'
  },
  'mudancas.branch': { title: 'Branch atual', body: 'O commit feito aqui entra nesta branch.' },
  'mudancas.atualizar': {
    title: 'Atualizar',
    body: 'Lê de novo o que mudou. A lista também se atualiza sozinha quando um agente termina de trabalhar.'
  },
  'mudancas.filtro.todos': { title: 'Todos', body: 'Mostra todos os arquivos alterados, editados por qualquer agente ou por ninguém.' },
  'mudancas.filtro.semAgente': {
    title: 'Sem agente',
    body: 'Arquivos que não aparecem no histórico de nenhum agente: mudanças feitas por você ou por outros programas.'
  },
  'mudancas.selecionarTodos': {
    title: 'Selecionar todos',
    body: 'Marca ou desmarca todos os arquivos da lista, respeitando o filtro de quem editou. Os marcados entram no commit ou no descarte.'
  },
  'mudancas.marcar': { title: 'Marcar arquivo', body: 'Os arquivos marcados entram no próximo commit ou no descarte.' },
  'mudancas.descartarMarcados': {
    title: 'Descartar marcados',
    body: 'Volta os arquivos marcados à versão do último commit, depois de confirmar. O conteúdo atual vai para a lixeira.'
  },
  'mudancas.checkpoints': {
    title: 'Checkpoints',
    body: 'Antes de cada turno de um agente, o app guarda o estado dos arquivos deste repositório (sem mexer no seu stage nem nas branches). Daqui dá para voltar a qualquer um deles.'
  },
  'mudancas.checkpointVoltar': {
    title: 'Voltar a este checkpoint',
    body: 'Mostra o que muda e pede confirmação. Os arquivos voltam ao conteúdo daquele momento; os criados depois vão para a lixeira. O estado atual é guardado antes, para desfazer.'
  },
  'mudancas.revisor': { title: 'Quem revisa', body: 'Terminal que recebe o pedido de revisão. Sugestão: quem tem o papel Revisor ou um agente que não editou estes arquivos.' },
  'mudancas.pedirRevisao': {
    title: 'Pedir revisão',
    body: 'Manda ao revisor a lista dos arquivos marcados, quem os editou e como ver o diff. Ele revisa sem alterar nada e responde no terminal (e pelo orq a quem editou, se estiver conectado).'
  },
  'mudancas.commit': {
    title: 'Fazer commit',
    body: 'Faz o commit só dos arquivos marcados, com a mensagem acima, na branch atual. Nada é enviado ao servidor (sem push).',
    keys: ['Ctrl+Enter']
  },
  'mudancas.pedirAjuste': {
    title: 'Pedir ajuste',
    body: 'Escreva o que precisa mudar neste arquivo e mande a um agente. Para falar de uma linha só, clique no número dela.'
  },
  'mudancas.descartarArquivo': {
    title: 'Descartar este arquivo',
    body: 'Volta o arquivo à versão do último commit, depois de confirmar. O conteúdo atual vai para a lixeira.'
  },
  'mudancas.pedido.para': { title: 'Para qual agente', body: 'Quem recebe o pedido. Já vem escolhido o agente que editou o arquivo.' },
  'mudancas.pedido.cancelar': { title: 'Cancelar', body: 'Fecha o pedido sem enviar nada.', keys: ['Esc'] },
  'mudancas.pedido.enviar': {
    title: 'Enviar pedido',
    body: 'Manda ao terminal do agente uma mensagem de revisão com o arquivo, a linha e o trecho do código.',
    keys: ['Ctrl+Enter']
  },
  'mudancas.linha': {
    title: 'Pedir ajuste nesta linha',
    body: 'Abre um pedido logo abaixo da linha, já com o número e o código dela, para mandar a um agente.'
  },

  // ---------------------------------------------------------------- partituras prontas
  'hub.fechar': { title: 'Fechar as partituras prontas', body: 'Esconde o painel. Ele volta pelo botão de grade na barra de cima.' },
  'uso.atualizar': { title: 'Atualizar o uso', body: 'Lê de novo o que o Claude Code e o Codex guardaram. O painel também se atualiza sozinho a cada minuto.' },
  'uso.fechar': { title: 'Fechar o painel de uso', body: 'Ele volta pelo botão de medidor na barra de título.', keys: ['Esc'] },
  'hub.buscar': { title: 'Buscar no catálogo', body: 'Procura entre as partituras prontas pelo texto, como revisão, bug ou playwright.' },
  'hub.inserir': {
    title: 'Inserir no centro',
    body: 'Monta o fluxo no meio da área visível do canvas: terminais, notas, conexões e papéis. A partitura também fica na biblioteca do projeto.'
  },
} satisfies Record<string, HintText>

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

/** Hints dos painéis com dado variável (nome do agente, arquivo, coluna, contagem), para `hintOf`. */
export const paineisHintsDin = {
  /** Aba de um agente no fichário: estado e mensagens novas vêm de `teamChatText`. */
  chatAbaAgente: (name: string, role: string | undefined, state: string, unread: string): HintText => ({
    title: role ? `${name} · ${role}` : name,
    body: `${cap(state)}${unread ? ` · ${unread}` : ''}. Abre a conversa só com este agente: o que você escreve aqui é digitado no terminal dele.`
  }),
  chatNota: (file: string): HintText => ({
    title: file,
    body: 'Abre a nota aqui no chat, só para leitura; ela se atualiza sozinha quando um agente grava. Para editar, use Ver no canvas.'
  }),
  chatAbrirAgente: (name: string): HintText => ({ title: name, body: 'Abre a conversa só com este agente, com o histórico completo dele.' }),
  chatOpcao: (label: string): HintText => ({
    title: label,
    body: 'Responde a pergunta do agente com esta opção; o Maestrinho aperta as teclas no terminal por você.'
  }),

  quadroAgente: (name: string, sleeping: boolean): HintText => ({
    title: name,
    body: `Solte um cartão aqui para passar o chamado: o agente vira o responsável e recebe a mensagem no terminal.${sleeping ? ' Está hibernando: acorda antes de receber.' : ''}`
  }),
  quadroAdicionar: (column: string): HintText => ({
    title: `Adicionar cartão em ${column}`,
    body: 'Cria um cartão direto nesta etapa. Digite o título e, se quiser, o número do chamado.'
  }),
  quadroCartao: (title: string): HintText => ({
    title,
    body: 'Clique para ver e editar os detalhes. Arraste para outra coluna para mudar a etapa, ou até um agente para passar o chamado.'
  }),
  quadroNotaLigada: (file: string): HintText => ({ title: file, body: 'Nota ligada a este cartão, com os detalhes do chamado.' }),
  quadroUltimaMovimentacao: (by: string, text: string): HintText => ({ title: 'Última movimentação', body: cut(`${by}: ${text}`, 200) }),

  mudancasArquivo: (path: string, kind: string, editedBy: string): HintText => ({
    title: path,
    body: `${cap(kind)}${editedBy ? ` · ${editedBy}` : ''}. Clique para ver o que mudou, linha a linha.`
  }),
  mudancasFiltroAgente: (name: string): HintText => ({ title: name, body: `Mostra só os arquivos que ${name} editou.` }),

  hubCartao: (name: string): HintText => ({
    title: name,
    body: 'Arraste para o canvas para montar este fluxo onde soltar. Nenhum comando vem do arquivo: os terminais usam os presets desta máquina.'
  }),
  hubEtiqueta: (tag: string, count: number, on: boolean): HintText => ({
    title: tag,
    body: on
      ? 'Filtro ativo. Clique de novo para ver o catálogo inteiro.'
      : `Mostra só ${count === 1 ? 'a partitura' : `as ${count} partituras`} com esta etiqueta.`
  })
} as const
