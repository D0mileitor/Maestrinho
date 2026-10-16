import type { HintText } from '../../hints/content'

/** Hints dos diálogos: configurações, presets, papéis, rotinas, partituras, floors, notas, portais e time. */
export const dialogosHints = {
  // ------------------------------------------------------------ comuns
  'dialogo.comum.fechar': { title: 'Fechar', body: 'Fecha esta janela.', keys: ['Esc'] },
  'dialogo.aviso.dispensar': { title: 'Dispensar aviso', body: 'Tira este aviso da tela.' },
  'dialogo.confirmar.cancelar': { title: 'Cancelar', body: 'Fecha sem fazer nada.', keys: ['Esc'] },
  'dialogo.corrompido.restaurar': {
    title: 'Restaurar este backup',
    body: 'Volta o workspace para a cópia salva nesse momento. O arquivo com problema é guardado com outro nome.'
  },
  'dialogo.corrompido.vazio': {
    title: 'Começar com o canvas vazio',
    body: 'Abre o workspace sem terminais nem conexões. O arquivo com problema é guardado com outro nome e as notas continuam na pasta.'
  },
  'dialogo.corrompido.cancelar': { title: 'Cancelar', body: 'Fecha sem abrir o workspace; nada é alterado na pasta.', keys: ['Esc'] },

  // ------------------------------------------------------------ configurações
  'dialogo.config.aba.geral': {
    title: 'Geral',
    body: 'Aparência, avisos de quando um agente termina, retomada das conversas, hibernação e o escritório.'
  },
  'dialogo.config.aba.terminal': { title: 'Terminal', body: 'Fonte, tamanho da letra e quantas linhas de histórico cada terminal guarda.' },
  'dialogo.config.aba.resumo': {
    title: 'Assistente de resumo',
    body: 'Opcional: um modelo de IA que você controla resume em poucas frases o que o agente fez quando ele termina.'
  },
  'dialogo.config.aba.atalhos': { title: 'Atalhos', body: 'Todas as teclas de atalho do app, inclusive o prefixo Ctrl+B no estilo do tmux.' },
  'dialogo.config.aba.sobre': {
    title: 'Sobre e segurança',
    body: 'Versão instalada, onde achar as novas e o que o app faz (e não faz) com os seus dados.'
  },
  'dialogo.config.tema': {
    title: 'Tema',
    body: 'Escuro é o padrão. "Acompanhar o sistema" troca sozinho quando o Windows muda entre claro e escuro.'
  },
  'dialogo.config.cenario': {
    title: 'Cenário padrão do escritório',
    body:
      'Fundo da visão Escritório nos workspaces que ainda não escolheram um cenário próprio. Cada workspace pode escolher o seu (inclusive com uma imagem própria) pelo botão Cenário no escritório.'
  },
  'dialogo.config.grade': {
    title: 'Pautas do canvas',
    body: 'As linhas de fundo que ajudam a alinhar terminais e notas. Desmarque para um fundo liso.'
  },
  'dialogo.config.minimapa': {
    title: 'Minimapa',
    body: 'Miniatura do canvas no canto, para se localizar e navegar. Dá para mostrar ou esconder a qualquer momento.',
    keys: ['Ctrl+Shift+M']
  },
  'dialogo.config.avisar': {
    title: 'Aviso quando um agente termina',
    body:
      'Avisa quando um agente termina, faz uma pergunta ou pede permissão. Desmarcado, nenhum aviso aparece (o status continua nos terminais).'
  },
  'dialogo.config.soForaDeFoco': {
    title: 'Notificação do Windows só fora do app',
    body:
      'Vale quando o estilo usa a notificação do Windows: ela só aparece com a janela do Maestrinho fora de foco. Desmarcado, aparece mesmo com o app em primeiro plano.'
  },
  'dialogo.config.estiloAviso': {
    title: 'Como avisar',
    body:
      'O personagem do agente no canto da tela, a notificação da central do Windows ou os dois juntos. O personagem aparece quando um agente termina, faz uma pergunta, pede permissão ou para com erro e você não está no terminal dele; sai andando quando você abre o terminal, clica em ×, volta ao app ou depois de 1 minuto.'
  },
  'dialogo.config.testarAviso': {
    title: 'Ver como fica',
    body: 'Mostra o personagem de aviso no canto da tela por alguns segundos, com o visual de um agente deste workspace.'
  },
  'dialogo.config.retomar': {
    title: 'Retomar conversas',
    body: 'Claude Code e Codex continuam a conversa de onde pararam ao reabrir o app ou reiniciar o terminal. Desmarcado, cada início começa do zero.'
  },
  'dialogo.config.estadoExato': {
    title: 'Estado exato dos agentes',
    body:
      'O próprio Claude Code (hooks) e o Codex (notificações) avisam quando terminam ou param pedindo aprovação: sem falso "terminou" em comandos demorados e com o "preciso de você" na hora. Os demais agentes seguem pelo silêncio da tela. Vale ao reiniciar o terminal. Desmarque só se os hooks ou as notificações atrapalharem.'
  },
  'dialogo.config.checkpoints': {
    title: 'Checkpoints',
    body: 'Antes de cada turno de um agente, guarda o estado dos arquivos do repositório numa referência própria do git (não mexe no stage, nas branches nem no histórico). Volte a qualquer um pela visão Mudanças → Checkpoints.'
  },
  'dialogo.config.usoAviso': {
    title: 'Aviso de uso da assinatura',
    body: 'Avisa uma vez por janela quando a sessão de 5 h ou a semana do Claude ou do Codex passar deste percentual. O uso é lido dos arquivos dos próprios agentes a cada 3 minutos.'
  },
  'dialogo.config.usoPausa': {
    title: 'Pausa automática de rotinas e gatilhos',
    body:
      'Acima deste percentual do uso da assinatura (sessão de 5 h ou semana, de cada assinatura), rotinas e gatilhos deixam de disparar sozinhos (aparecem como "pulada"); tudo volta sozinho quando a janela reinicia. Mensagens entre agentes e o que você manda continuam normais.'
  },
  'dialogo.config.hibernar': {
    title: 'Hibernação',
    body:
      'Encerra o processo de agentes ociosos para poupar memória, com a conversa guardada; eles acordam (retomando a sessão) em alguns segundos quando você abre o terminal, manda mensagem pelo chat ou outro agente fala com eles. Shells, agentes sem conversa retomável e os que esperam aprovação nunca hibernam. Atenção: o que o agente deixou rodando em segundo plano (ex.: um servidor iniciado por ele) também é encerrado. Padrão: nunca.'
  },
  'dialogo.config.reacoes': {
    title: 'Bronca e comemoração',
    body:
      'Quando um agente reprova ("REPROVADO", "não passou"…) ou aprova o trabalho de outro pelo orq, vai até a mesa dele dar uma bronca ou comemorar. Só enfeite: não muda o trabalho dos agentes. O sorteio deixa a facadinha de fora.'
  },
  'dialogo.config.fonteInterface': {
    title: 'Fonte da interface',
    body:
      'Fonte de todo o app: menus, painéis, notas, chat, quadro e escritório. Os terminais têm fonte própria, na aba Terminal. A lista mostra as fontes instaladas; em "Outra fonte…" digite qualquer nome (ou vários, separados por vírgula: vale o primeiro instalado).'
  },
  'dialogo.config.tamanhoInterface': {
    title: 'Tamanho do texto',
    body: 'Em pixels, de 10 a 20 (padrão 13). O texto do app inteiro cresce ou diminui na mesma proporção, mantendo títulos maiores que legendas.'
  },
  'dialogo.config.fonte': {
    title: 'Fonte do terminal',
    body: 'Fontes em ordem de preferência, separadas por vírgula; vale a primeira instalada. Use fontes monoespaçadas.'
  },
  'dialogo.config.tamanhoFonte': {
    title: 'Tamanho da fonte do terminal',
    body: 'Em pixels, de 8 a 32 (padrão 13). Aumente se o texto ficar pequeno em telas de alta resolução.'
  },
  'dialogo.config.scrollback': {
    title: 'Histórico do terminal',
    body: 'Quantas linhas antigas dá para rolar para cima (padrão 10.000). Valores altos gastam mais memória em cada terminal.'
  },
  'dialogo.config.resumoAtivo': {
    title: 'Resumo automático',
    body: 'Quando um agente termina, o resumo aparece no aviso e numa mensagem no canto do app. Só funciona com endpoint e modelo preenchidos.'
  },
  'dialogo.config.resumoEndpoint': {
    title: 'Endpoint',
    body: 'Base de uma API compatível com a da OpenAI, terminando em /v1. O padrão é o Ollama nesta máquina (porta 11434).'
  },
  'dialogo.config.resumoModelo': {
    title: 'Modelo do resumo',
    body: 'Nome do modelo como o servidor o conhece. Modelos pequenos bastam: só as últimas linhas da tela são enviadas.'
  },
  'dialogo.config.resumoChave': { title: 'Chave da API', body: 'Só se o servidor exigir. Ollama e LM Studio rodando nesta máquina não pedem chave.' },
  'dialogo.config.versoes': {
    title: 'Ver versões no GitHub',
    body: 'Abre no navegador a página de versões do Maestrinho. O app não procura versões novas sozinho.'
  },
  'dialogo.config.cancelar': { title: 'Cancelar', body: 'Fecha sem salvar: as configurações continuam como estavam.', keys: ['Esc'] },
  'dialogo.config.salvar': {
    title: 'Salvar',
    body: 'Grava as configurações de todas as abas e fecha. A maioria vale na hora; o que muda o agente vale ao reiniciar o terminal.'
  },

  // ------------------------------------------------------------ presets de agentes
  'dialogo.presets.item': {
    title: 'Editar este preset',
    body: 'Mostra ao lado como o agente é iniciado e recebe mensagens. Alterações valem para terminais novos ou reiniciados.'
  },
  'dialogo.presets.novo': {
    title: 'Novo preset',
    body: 'Cadastra outro programa de agente, como uma CLI de IA que você instalou. Preencha ao menos o comando e salve.'
  },
  'dialogo.presets.restaurar': {
    title: 'Restaurar presets de fábrica',
    body: 'Volta Shell, Claude Code, Codex e os outros de fábrica à configuração original (pede confirmação). Os que você criou continuam.'
  },
  'dialogo.presets.nome': {
    title: 'Nome exibido',
    body: 'Como o agente aparece na escolha do novo terminal e nas listas. Pode ter espaços e acentos.'
  },
  'dialogo.presets.id': {
    title: 'Identificador',
    body: 'Nome fixo usado pelos terminais e pelos gerentes em "orq recruit --agent <id>". Só pode ser escolhido ao criar o preset.'
  },
  'dialogo.presets.comando': {
    title: 'Comando',
    body: 'O programa que o terminal executa (ex.: claude, codex, powershell.exe). Precisa estar no PATH ou ser um caminho completo.'
  },
  'dialogo.presets.args': {
    title: 'Argumentos',
    body: 'Um por linha, sem aspas. Os marcadores entre chaves são trocados ao iniciar: {name} pelo nome do terminal, {role} pelo papel.'
  },
  'dialogo.presets.entrega': {
    title: 'Entrega de mensagens',
    body: 'Como o texto de outro agente chega ao programa. Colagem serve para agentes de tela cheia; digitação direta, para shells.'
  },
  'dialogo.presets.instrucoes': {
    title: 'Instruções do papel',
    body: 'Por onde o agente recebe o papel e o manual do orq. Nenhuma: o agente não sabe que faz parte de um time.'
  },
  'dialogo.presets.atrasoEnter': {
    title: 'Atraso antes do Enter',
    body: 'Espera entre colar a mensagem e apertar Enter (padrão 200 ms). Aumente se o texto chega mas fica parado sem ser enviado.'
  },
  'dialogo.presets.ocioso': {
    title: 'Ocioso após silêncio',
    body: 'Tempo sem nada novo na tela para considerar que o agente terminou (padrão 4000 ms). Aumente se ele pensa muito sem escrever.'
  },
  'dialogo.presets.padroes': {
    title: 'Padrões de ociosidade',
    body: 'Expressões regulares testadas na última linha da tela: se uma bater, o agente conta como pronto na hora, sem esperar o silêncio.'
  },
  'dialogo.presets.modelo': {
    title: 'Modelo da mensagem recebida',
    body: 'Moldura em volta do que outro agente envia: {from} é quem mandou e {text} a mensagem. Para shells, use só {text}.'
  },
  'dialogo.presets.shell': {
    title: 'É um shell',
    body: 'Marque para PowerShell, bash e similares: o que chega de outro agente é executado como comando. Shells não hibernam.'
  },
  'dialogo.presets.avancado': {
    title: 'Retomada de sessão',
    body: 'Como o agente continua a conversa ao reabrir o app e como avisa que terminou. Os presets de fábrica já vêm prontos.'
  },
  'dialogo.presets.argsSessao': {
    title: 'Argumentos para sessão nova',
    body: 'Usados na primeira vez, para o agente adotar o id de sessão que o terminal guarda. Vazio: o agente não retoma conversas.'
  },
  'dialogo.presets.argsRetomar': {
    title: 'Argumentos para retomar',
    body: 'Usados no lugar dos de sessão nova quando a conversa já existe, ao reabrir o app ou reiniciar o terminal.'
  },
  'dialogo.presets.sessaoOnde': {
    title: 'Onde verificar a sessão',
    body: 'Pasta onde o agente guarda as conversas. Se a sessão não estiver lá, o app começa uma nova em vez de tentar retomar e falhar.'
  },
  'dialogo.presets.eventos': {
    title: 'Aviso de estado do agente',
    body: 'Hooks para Claude Code, notificações para Codex; outros programas ficam com o silêncio da tela. Depende do "Estado exato" nas Configurações.'
  },
  'dialogo.presets.excluir': {
    title: 'Excluir preset',
    body: 'Apaga na hora, sem confirmação. Terminais que o usam passam a abrir o Shell ao reiniciar.'
  },
  'dialogo.presets.fechar': { title: 'Fechar', body: 'Fecha a janela. Alterações não salvas neste preset são descartadas.', keys: ['Esc'] },
  'dialogo.presets.salvar': {
    title: 'Salvar preset',
    body: 'Grava as alterações. Valem para terminais novos ou reiniciados; os que estão rodando não mudam.'
  },

  // ------------------------------------------------------------ papéis
  'dialogo.papeis.item': {
    title: 'Editar este papel',
    body: 'Abre o papel ao lado. Se houver alterações não salvas no atual, o app pergunta antes de trocar.'
  },
  'dialogo.papeis.novo': {
    title: 'Novo papel',
    body: 'Cria uma função para o time (ex.: revisor, testador) com instruções próprias, para atribuir aos terminais.'
  },
  'dialogo.papeis.nome': {
    title: 'Nome do papel',
    body: 'Aparece no selo do terminal e na escolha de papel. Precisa ser único, sem contar acentos e maiúsculas.'
  },
  'dialogo.papeis.cor': {
    title: 'Cor do selo',
    body: 'Pinta o selo do papel nos terminais e a camiseta do agente no escritório. Digite #RRGGBB ou escolha uma cor sugerida.'
  },
  'dialogo.papeis.corSeletor': { title: 'Escolher outra cor', body: 'Abre o seletor de cores do sistema para qualquer tom.' },
  'dialogo.papeis.corPrevia': { title: 'Prévia do selo', body: 'Como o selo deste papel aparece nos terminais.' },
  'dialogo.papeis.semCor': { title: 'Sem cor', body: 'O selo usa a cor padrão do tema.' },
  'dialogo.papeis.instrucoes': {
    title: 'Instruções',
    body: 'O que o agente com este papel faz e como se comporta no time. Entra junto com o manual do orq quando o terminal inicia.'
  },
  'dialogo.papeis.reiniciar': {
    title: 'Reiniciar agora',
    body: 'Inicia de novo os terminais listados para que recebam o texto novo. O que eles estiverem fazendo agora é interrompido.'
  },
  'dialogo.papeis.excluir': {
    title: 'Excluir papel',
    body: 'Pede confirmação. Terminais com este papel seguem com as instruções atuais até reiniciar; depois ficam sem papel.'
  },
  'dialogo.papeis.fechar': {
    title: 'Fechar',
    body: 'Fecha a janela. Se houver alterações não salvas, o app pergunta antes de descartar.',
    keys: ['Esc']
  },
  'dialogo.papeis.salvar': {
    title: 'Salvar papel',
    body: 'Grava o papel. Terminais iniciados ou reiniciados depois disso recebem o texto novo.',
    keys: ['Ctrl+Enter']
  },

  // ------------------------------------------------------------ modelo e esforço
  'dialogo.modelo.modelo': {
    title: 'Modelo',
    body: 'Nome ou apelido do modelo, com sugestões ao digitar. Vazio segue o padrão do papel ou, sem ele, o do próprio agente.'
  },
  'dialogo.modelo.esforco': {
    title: 'Esforço',
    body: 'Quanto o agente pensa antes de responder. Mais esforço costuma dar respostas melhores, porém mais lentas e caras.'
  },

  // ------------------------------------------------------------ rotinas
  'dialogo.rotinas.cancelar': {
    title: 'Cancelar execução',
    body: 'Para de enviar os próximos passos. O que o agente já recebeu continua sendo feito.'
  },
  'dialogo.rotinas.executar': {
    title: 'Executar agora',
    body: 'Dispara a rotina já, mesmo com o agente ocupado. A contagem do próximo disparo recomeça a partir de agora.'
  },
  'dialogo.rotinas.pausar': { title: 'Pausar', body: 'Suspende os disparos automáticos sem apagar a rotina. Executar agora continua funcionando.' },
  'dialogo.rotinas.retomar': { title: 'Retomar', body: 'Volta a disparar no intervalo configurado. Se o horário já passou, roda logo.' },
  'dialogo.rotinas.editar': { title: 'Editar rotina', body: 'Muda o nome, o terminal alvo, o intervalo e os passos.' },
  'dialogo.rotinas.excluir': {
    title: 'Excluir rotina',
    body: 'Apaga a rotina deste workspace (pede confirmação). Se estiver rodando, os próximos passos não são enviados.'
  },
  'dialogo.rotinas.fechar': {
    title: 'Fechar',
    body: 'As rotinas ativas continuam disparando com a janela fechada, enquanto o workspace estiver aberto.',
    keys: ['Esc']
  },
  'dialogo.rotinas.nova': {
    title: 'Nova rotina',
    body: 'Agenda mensagens para um agente deste workspace, como pedir para rodar os testes a cada 30 minutos.'
  },
  'dialogo.rotinas.alvo': {
    title: 'Terminal alvo',
    body: 'O agente que recebe as mensagens. Se estiver hibernando, ele acorda; se estiver parado, a execução fica registrada como "terminal parado".'
  },
  'dialogo.rotinas.quando': {
    title: 'Quando a rotina dispara',
    body: 'A cada N minutos, ou quando algo acontece no workspace. Juntando gatilhos dá para montar fluxos: quando o construtor terminar, mande ao revisor; quando o revisor reprovar, mande de volta ao construtor.'
  },
  'dialogo.rotinas.quemTerminar': { title: 'Agente que terminou', body: 'Dispara quando este agente termina uma vez de trabalho (não vale quando ele para pedindo aprovação).' },
  'dialogo.rotinas.mensagemDe': { title: 'Quem mandou', body: 'Só mensagens deste agente (orq send). "Qualquer agente" aceita todas.' },
  'dialogo.rotinas.mensagemPara': { title: 'Para quem', body: 'Só mensagens para este agente. O alvo da rotina, se estiver ocupado com a mensagem, é esperado até ficar livre.' },
  'dialogo.rotinas.tom': {
    title: 'Tom da mensagem',
    body: 'O app classifica cada mensagem entre agentes como reprovação ("reprovado", "não passou"...), aprovação ("aprovado", "pode seguir"...) ou neutra.'
  },
  'dialogo.rotinas.coluna': { title: 'Coluna do quadro', body: 'Dispara quando um cartão entra nesta coluna, movido por você ou por um agente (orq board move), ou criado nela.' },
  'dialogo.rotinas.arquivos': {
    title: 'Arquivos observados',
    body: 'Padrões glob relativos à pasta do workspace: ** qualquer pasta, * qualquer nome, {ts,tsx} alternativas. As mudanças de 2 segundos viram um disparo só.'
  },
  'dialogo.rotinas.teto': {
    title: 'Teto por hora',
    body: 'Protege contra laços (A dispara B, que dispara A...) gastando a assinatura: acima disto na mesma hora, o disparo é pulado e aparece no histórico.'
  },
  'dialogo.rotinas.intervalo': {
    title: 'Intervalo',
    body: 'Minutos entre disparos, contados da última execução. Se o app ficou fechado, a rotina roda uma vez só ao abrir, sem acumular.'
  },
  'dialogo.rotinas.intervaloPronto': { title: 'Intervalo pronto', body: 'Preenche o campo de intervalo com este valor.' },
  'dialogo.rotinas.prompt': {
    title: 'Prompt',
    body: 'O texto enviado ao agente, como se você digitasse. Cada passo espera o agente terminar o anterior (até 30 minutos por passo).'
  },
  'dialogo.rotinas.pularOcupado': {
    title: 'Pular se ocupado',
    body: 'Se o agente estiver no meio de outra tarefa na hora marcada, a rotina não o interrompe e espera o próximo intervalo.'
  },
  'dialogo.rotinas.notificar': {
    title: 'Avisar a cada execução',
    body: 'Avisa, do jeito escolhido nas Configurações, quando a rotina termina e quantos passos foram concluídos.'
  },
  'dialogo.rotinas.ativa': { title: 'Ativa', body: 'Desmarcada, a rotina fica salva mas pausada: só roda com Executar agora.' },
  'dialogo.rotinas.voltar': { title: 'Voltar', body: 'Volta para a lista sem salvar as alterações desta rotina.' },
  'dialogo.rotinas.salvar': {
    title: 'Salvar rotina',
    body: 'Grava a rotina. O próximo disparo conta a partir da última execução (ou de quando ela foi criada).'
  },

  // ------------------------------------------------------------ partituras
  'dialogo.partituras.nome': {
    title: 'Nome da partitura',
    body: 'Como ela aparece na biblioteca deste workspace. Antes de salvar, selecione no canvas os terminais, notas e conexões do time.'
  },
  'dialogo.partituras.salvar': {
    title: 'Salvar partitura',
    body: 'Guarda os itens selecionados, com papéis e o texto das notas, em .maestrinho/partituras para reusar depois.'
  },
  'dialogo.partituras.inserir': {
    title: 'Inserir no canvas',
    body: 'Cria uma cópia do time no centro da tela. Papéis e notas que faltarem são criados; os terminais usam os presets desta máquina.'
  },
  'dialogo.partituras.exportar': {
    title: 'Exportar',
    body: 'Salva a partitura num arquivo .json para mandar a um colega ou guardar fora do projeto.'
  },
  'dialogo.partituras.apagar': {
    title: 'Apagar partitura',
    body: 'Remove da biblioteca (pede confirmação). Os times já inseridos no canvas não mudam.'
  },
  'dialogo.partituras.importar': {
    title: 'Importar arquivo',
    body: 'Escolhe um arquivo .json de partitura, guarda uma cópia na biblioteca e insere o time no centro do canvas.'
  },
  'dialogo.partituras.fechar': { title: 'Fechar', body: 'Fecha a janela sem inserir nada.', keys: ['Esc'] },

  // ------------------------------------------------------------ time completo
  'dialogo.time.nome': { title: 'Nome do time', body: 'Aparece para quem importar, no título da prévia. O padrão é o nome do workspace.' },
  'dialogo.time.descricao': { title: 'Descrição', body: 'Texto mostrado na prévia da importação: para que serve o time e como usar.' },
  'dialogo.time.notas': {
    title: 'Conteúdo das notas',
    body: 'Útil quando as notas são modelos (fluxo, checklist). Desmarque para o time chegar limpo ou se as notas tiverem dados internos.'
  },
  'dialogo.time.exportar': {
    title: 'Exportar time',
    body: 'Pergunta onde salvar e gera um único arquivo com o time todo deste workspace, pronto para mandar a um colega.'
  },
  'dialogo.time.importar': {
    title: 'Importar time',
    body: 'Escolhe um arquivo de time ou partitura e mostra uma prévia do que vai entrar antes de mudar qualquer coisa no canvas.'
  },
  'dialogo.time.reusarNota': {
    title: 'Usar a nota que você já tem',
    body: 'Desmarque para receber o texto que veio no arquivo, numa cópia separada. A sua nota não é alterada em nenhum caso.'
  },
  'dialogo.time.aceitarPreset': {
    title: 'Aceitar este preset',
    body: 'Os terminais do time passam a executar o comando ao lado. Sem marcar, usam o preset desta máquina ou viram shell.'
  },
  'dialogo.time.quadro': {
    title: 'Colunas do quadro',
    body: 'Troca as colunas do Quadro de chamados deste workspace pelas do time. Desmarcado, o seu quadro fica como está.'
  },
  'dialogo.time.cancelar': { title: 'Cancelar', body: 'Fecha sem importar nada.', keys: ['Esc'] },
  'dialogo.time.confirmar': {
    title: 'Importar time',
    body: 'Insere terminais e notas no centro da tela e adiciona as funções novas e só os presets marcados.'
  },

  // ------------------------------------------------------------ novo terminal e edição de terminal
  'dialogo.terminal.abaAgente': { title: 'Agente', body: 'Programa, nome, papel, modelo e pasta do novo terminal.' },
  'dialogo.terminal.abaTerminal': { title: 'Terminal', body: 'Nome, agente, papel, modelo e pasta deste terminal.' },
  'dialogo.terminal.abaAparencia': {
    title: 'Aparência',
    body: 'Como o agente aparece na visão Escritório: pele, cabelo, roupas e acessórios.'
  },
  'dialogo.terminal.nome': {
    title: 'Nome do terminal',
    body: 'Também aparece no chat, no escritório e nos avisos. Precisa ser único no workspace; use letras, números, ".", "_" ou "-".'
  },
  'dialogo.terminal.agente': {
    title: 'Agente',
    body: 'O programa que roda neste terminal (preset). Os marcados como não encontrados precisam ser instalados antes.'
  },
  'dialogo.terminal.papel': {
    title: 'Papel',
    body: 'Função no time: as instruções do papel entram no agente ao iniciar, e a cor dele vira o selo e a camiseta no escritório.'
  },
  'dialogo.terminal.pasta': {
    title: 'Diretório de trabalho',
    body: 'Onde o agente roda e enxerga os arquivos. Útil para limitar um agente a uma subpasta (ex.: frontend) de um projeto maior.'
  },
  'dialogo.terminal.ssh': {
    title: 'Servidor SSH',
    body: 'Destino no formato usuario@servidor ou um apelido do ~/.ssh/config. Se o servidor pedir senha, digite no próprio terminal.'
  },
  'dialogo.terminal.gerente': {
    title: 'Modo gerente',
    body: 'Libera para este agente os comandos do orq que recrutam, dispensam e conectam outros agentes. Use no coordenador do time.'
  },
  'dialogo.terminal.criar': {
    title: 'Criar terminal',
    body: 'Coloca o terminal no canvas e já inicia o agente. Duplo clique num agente da lista faz o mesmo.'
  },
  'dialogo.terminal.cancelarNovo': { title: 'Cancelar', body: 'Fecha sem criar o terminal.', keys: ['Esc'] },
  'dialogo.terminal.salvar': {
    title: 'Salvar',
    body: 'O nome muda na hora. Se o resto mudou com o terminal rodando, o app pergunta se quer reiniciar para aplicar.'
  },
  'dialogo.terminal.cancelarEdicao': { title: 'Cancelar', body: 'Fecha sem alterar o terminal.', keys: ['Esc'] },
  'dialogo.terminal.reiniciar': {
    title: 'Reiniciar agora',
    body: 'Encerra o processo e o inicia de novo com as alterações. O que o agente estiver fazendo agora é interrompido.'
  },
  'dialogo.terminal.depois': {
    title: 'Depois',
    body: 'Mantém o terminal rodando como está; as alterações valem no próximo reinício.'
  },

  // ------------------------------------------------------------ nova nota
  'dialogo.nota.nome': {
    title: 'Nome do arquivo',
    body: 'Digitar também filtra a lista abaixo. Se o nome já existir, a nota existente vai para o canvas em vez de criar outra.'
  },
  'dialogo.nota.existente': { title: 'Usar esta nota', body: 'Preenche o nome com ela. Duplo clique já coloca a nota no canvas.' },
  'dialogo.nota.criar': {
    title: 'Criar nota',
    body: 'Cria o arquivo .md vazio em .maestrinho/notes e o coloca no canvas, já pronto para escrever.'
  },
  'dialogo.nota.abrir': {
    title: 'Abrir nota',
    body: 'Coloca no canvas a nota que já existe com esse nome, sem mudar o conteúdo dela.'
  },
  'dialogo.nota.cancelar': { title: 'Cancelar', body: 'Fecha sem criar nem colocar nota no canvas.', keys: ['Esc'] },

  // ------------------------------------------------------------ floors
  'dialogo.floor.nome': {
    title: 'Nome do floor',
    body: 'Aparece na aba do floor e dá nome à branch. Algo curto que descreva o experimento.'
  },
  'dialogo.floor.base': {
    title: 'Branch base',
    body: 'De onde o floor parte: a branch nova começa com o código desta. Ela própria não é alterada.'
  },
  'dialogo.floor.criar': {
    title: 'Criar floor',
    body: 'Cria a branch e uma cópia de trabalho em .maestrinho/floors e abre o canvas do floor. A pasta precisa ser um repositório git.'
  },
  'dialogo.floor.cancelar': { title: 'Cancelar', body: 'Fecha sem criar nada.', keys: ['Esc'] },
  'dialogo.floor.forcar': {
    title: 'Confirmar a perda',
    body: 'Libera o descarte mesmo com commits ou alterações que só existem neste floor. Não dá para desfazer.'
  },
  'dialogo.floor.descartar': {
    title: 'Descartar floor',
    body: 'Encerra os terminais do floor e apaga a cópia de trabalho e a branch. Para guardar o trabalho, incorpore antes.'
  },
  'dialogo.floor.fechar': { title: 'Fechar', body: 'Fecha sem mudar nada no floor.', keys: ['Esc'] },

  // ------------------------------------------------------------ portal
  'dialogo.portal.endereco': {
    title: 'Endereço',
    body: 'Página aberta dentro do canvas; sem http://, o app completa com https://. Logins feitos nos portais ficam numa sessão separada do app.'
  },
  'dialogo.portal.criar': { title: 'Criar portal', body: 'Coloca a página no canvas, no lugar e no tamanho que você marcou.' },
  'dialogo.portal.cancelar': { title: 'Cancelar', body: 'Fecha sem criar o portal.', keys: ['Esc'] }
} satisfies Record<string, HintText>

/** Hints dos diálogos que dependem de dados da tela (nome do agente, rótulo do botão). */
export const dialogosHintsDinamicos = {
  /** Cartão de agente no diálogo "Novo terminal". */
  cartaoPreset: (label: string, command: string, missing: boolean): HintText => ({
    title: label,
    body: missing
      ? `O comando "${command}" não está no PATH desta máquina: instale o programa ou ajuste o preset em Presets de agentes.`
      : `Roda o comando "${command}". Duplo clique cria o terminal na hora, com o nome e o papel escolhidos abaixo.`
  }),
  /** Botão principal do diálogo de confirmação. */
  confirmar: (label: string): HintText => ({ title: label, body: 'Faz o que está descrito acima.', keys: ['Enter'] })
}
