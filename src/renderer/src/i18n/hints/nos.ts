import type { HintText } from '../../hints/content'

/** Hints dos nós do canvas: terminal, nota, portal, conexões e menus deles. */
export const nosHints = {
  // ------------------------------------------------------------------ terminal: cabeçalho
  'no.terminal.cabecalho': {
    title: 'Mover ou abrir em foco',
    body: 'Arraste para mover o terminal. Clique duas vezes num espaço livre para abrir em foco, num painel grande (Ctrl+B e depois Z faz o mesmo).'
  },
  'no.terminal.nome': {
    title: 'Nome do terminal',
    body: 'Clique duas vezes para renomear. É o nome que os outros agentes usam em orq send para falar com este.',
    keys: ['F2']
  },
  'no.terminal.estado.starting': { title: 'Iniciando', body: 'O processo do agente está abrindo.' },
  'no.terminal.estado.busy': { title: 'Trabalhando', body: 'A tela do agente está mudando: ele está pensando, escrevendo ou rodando comandos.' },
  'no.terminal.estado.idle': { title: 'Aguardando', body: 'O agente está parado, esperando uma mensagem sua ou de outro agente.' },
  'no.terminal.estado.attention': {
    title: 'Terminou, aguardando você',
    body: 'O agente terminou ou fez uma pergunta e você ainda não viu. Clique no terminal para ler e limpar o aviso.',
    keys: ['Ctrl+Shift+A']
  },
  'no.terminal.estado.off': {
    title: 'Encerrado',
    body: 'O processo saiu. Use Reiniciar para abrir de novo; com a retomada ligada, a conversa continua de onde parou.'
  },
  'no.terminal.estado.error': {
    title: 'Erro',
    body: 'O processo não conseguiu iniciar ou parou com erro. A mensagem aparece no rodapé do terminal.'
  },
  'no.terminal.estado.sleeping': {
    title: 'Hibernando',
    body: 'O processo foi encerrado para poupar memória, com a conversa guardada. Ele acorda ao receber mensagem ou quando você abre o terminal.'
  },
  'no.terminal.gerente': {
    title: 'Modo gerente',
    body: 'Este agente pode recrutar novos agentes, dispensá-los e criar conexões pelo orq (recruit, dismiss, connect).'
  },
  'no.terminal.papel': {
    title: 'Papel',
    body: 'Função deste agente no time. As instruções do papel são entregues quando ele inicia; troque em Editar ou na tela Papéis.'
  },
  'no.terminal.agente': {
    title: 'Agente do terminal',
    body: 'Programa que roda aqui, com o modelo e o esforço escolhidos. Para trocar, use Editar no menu de mais ações.'
  },
  'no.terminal.chat': {
    title: 'Aberto no chat',
    body: 'Este terminal está na aba aberta do chat dos agentes. O que você escreve no chat é digitado aqui.'
  },
  'no.terminal.selo': {
    title: 'Selo de status',
    body: 'Recado curto que o próprio agente pôs com orq status (ex.: "rodando testes"). Some quando ele limpa.'
  },
  'no.terminal.recrutado': {
    title: 'Recrutado',
    body: 'Este agente foi criado por um terminal em modo gerente, que pode dispensá-lo quando o trabalho acabar.'
  },

  // ------------------------------------------------------------------ terminal: botões
  'no.terminal.menu': {
    title: 'Mais ações',
    body: 'Editar, reiniciar, começar uma conversa nova, hibernar, copiar o nome ou o comando orq send e fechar.'
  },
  'no.terminal.reiniciar': {
    title: 'Reiniciar processo',
    body: 'Encerra e abre de novo o agente. Com a retomada ligada (padrão), Claude Code e Codex voltam na mesma conversa.'
  },
  'no.terminal.fechar': {
    title: 'Fechar terminal',
    body: 'Encerra o processo do agente e tira o terminal do canvas. Pede confirmação antes.'
  },
  'no.terminal.acordar': {
    title: 'Acordar',
    body: 'Inicia o processo de novo e retoma a conversa de onde parou.'
  },
  'no.terminal.foco.voltar': {
    title: 'Voltar ao canvas',
    body: 'Fecha o painel em foco; o terminal continua rodando no nó dele. Clicar fora do painel faz o mesmo.'
  },

  // ------------------------------------------------------------------ terminal: menu ⋯
  'no.terminal.menu.editar': {
    title: 'Editar terminal',
    body: 'Nome, agente, papel, modelo, pasta de trabalho, modo gerente e aparência no escritório. Algumas mudanças só valem depois de reiniciar.'
  },
  'no.terminal.menu.novaConversa': {
    title: 'Nova conversa',
    body: 'Reinicia o agente numa conversa em branco, sem retomar a anterior. Útil quando o contexto ficou grande ou confuso.'
  },
  'no.terminal.menu.hibernar': {
    title: 'Hibernar agora',
    body: 'Encerra o processo para poupar memória e guarda a conversa; ele acorda ao receber mensagem ou ao ser aberto. Programas que ele deixou rodando também param.'
  },
  'no.terminal.menu.orqRemoto': {
    title: 'Ativar orq no servidor remoto',
    body: 'Instala o orq nesta sessão SSH para os agentes do servidor falarem com o time. Use se a ativação automática não aconteceu (prompt diferente, sudo -i).'
  },
  'no.terminal.menu.copiarNome': {
    title: 'Copiar nome',
    body: 'Copia o nome deste terminal, para citar em mensagens e instruções de outros agentes.'
  },
  'no.terminal.menu.copiarComando': {
    title: 'Copiar comando orq send',
    body: 'Copia o comando que outro agente usa para mandar mensagem a este terminal. Só funciona entre terminais conectados.'
  },

  // ------------------------------------------------------------------ nota
  'no.nota.arquivo': {
    title: 'Arquivo da nota',
    body: 'Markdown guardado nesta pasta do projeto. Agentes conectados leem e escrevem nela com orq note; a tela atualiza sozinha.'
  },
  'no.nota.naoSalvo': {
    title: 'Alterações não salvas',
    body: 'O texto é gravado sozinho logo depois que você para de digitar.',
    keys: ['Ctrl+S']
  },
  'no.nota.visualizar': {
    title: 'Visualizar',
    body: 'Mostra a nota formatada. Links abrem outras notas do canvas ou o navegador; caixas de tarefa podem ser marcadas.',
    keys: ['Esc']
  },
  'no.nota.editar': {
    title: 'Editar',
    body: 'Abre o editor de Markdown. Clicar duas vezes no texto também edita, já com o cursor no ponto clicado.'
  },
  'no.nota.abrirPasta': { title: 'Abrir pasta das notas', body: 'Abre no explorador de arquivos a pasta onde este arquivo .md está guardado.' },
  'no.nota.remover': {
    title: 'Remover do canvas',
    body: 'Tira a nota do canvas. O arquivo .md continua na pasta e pode voltar pela ferramenta Nota.'
  },
  'no.nota.recarregar': { title: 'Recarregar', body: 'Descarta o que você digitou e mostra a versão que está no arquivo agora.' },
  'no.nota.manterMeu': { title: 'Manter o meu', body: 'Grava a sua versão por cima da alteração feita pelo agente ou por outro programa.' },
  'no.nota.descartar': { title: 'Descartar', body: 'Joga fora o seu texto ainda não gravado; a nota fica marcada como arquivo ausente.' },
  'no.nota.recriarComMeu': { title: 'Recriar com o meu texto', body: 'Cria o arquivo de novo com o que você estava editando.' },
  'no.nota.tentarDeNovo': { title: 'Tentar de novo', body: 'Lê o arquivo outra vez (útil se ele estava bloqueado por outro programa).' },
  'no.nota.recriar': { title: 'Recriar arquivo', body: 'Cria o arquivo .md de novo neste caminho, com o último conteúdo visto, se houver.' },
  'no.nota.tarefa': { title: 'Marcar tarefa', body: 'Marca ou desmarca o item e grava na hora no arquivo da nota.' },
  'no.nota.imagemExterna': {
    title: 'Imagem externa',
    body: 'O app não acessa a rede, então a imagem não é carregada aqui. Clique para abrir o endereço no navegador.'
  },
  'no.nota.imagemEmbutida': { title: 'Imagem não exibida', body: 'Só imagens embutidas no próprio texto (data:) aparecem na nota.' },

  // ------------------------------------------------------------------ portal
  'no.portal.voltar': { title: 'Voltar', body: 'Volta para a página anterior deste portal.' },
  'no.portal.avancar': { title: 'Avançar', body: 'Vai para a página seguinte, depois de ter voltado.' },
  'no.portal.recarregar': {
    title: 'Recarregar',
    body: 'Carrega a página de novo, por exemplo depois que um agente mudou o sistema que está rodando.'
  },
  'no.portal.agentes': {
    title: 'Liberar para os agentes',
    body: 'Deixa os terminais conectados a este portal ler a página, tirar print e abrir endereços (orq portal). Cuidado: a página pode conter texto feito para enganar o agente, e ele usa os logins deste portal.'
  },
  'no.portal.agentesLigado': {
    title: 'Agentes podem usar este portal',
    body: 'Terminais conectados leem a página, tiram print e abrem endereços pelo orq portal. Clique para bloquear de novo.'
  },
  'no.portal.fechar': {
    title: 'Fechar portal',
    body: 'Tira o portal do canvas. Logins e cookies dos portais ficam guardados no app, separados do seu navegador.'
  },

  // ------------------------------------------------------------------ conexões
  'conexao.alca': {
    title: 'Conectar',
    body: 'Arraste até outro terminal, nota ou portal. Ligados, os agentes trocam mensagens e usam a nota pelo orq; sem conexão, não se falam.',
    keys: ['Ctrl+L']
  },
  'conexao.remover': {
    title: 'Remover conexão',
    body: 'Desfaz a ligação: os dois deixam de trocar mensagens e de se ver pelo orq.'
  }
} satisfies Record<string, HintText>
