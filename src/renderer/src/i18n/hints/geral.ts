import type { HintText } from '../../hints/content'

/** Hints da barra superior (visões, ferramentas, ações), barra lateral, floors, busca e boas-vindas. */
export const geralHints = {
  'topo.workspace': {
    title: 'Nome do workspace',
    body: 'Clique duas vezes para renomear. O workspace é a pasta do projeto: canvas, notas, quadro e cenário ficam em .maestrinho dentro dela.'
  },
  'topo.visao.canvas': {
    title: 'Canvas',
    body: 'O quadro infinito com os terminais, notas, portais e desenhos. Conecte dois terminais para que os agentes conversem pelo orq.'
  },
  'topo.visao.escritorio': {
    title: 'Escritório',
    body: 'O mesmo time desenhado em pixel art: cada terminal vira uma mesa, cada conexão um tapete. Mostra quem está digitando, lendo, esperando você ou terminou.'
  },
  'topo.visao.quadro': {
    title: 'Quadro de chamados',
    body: 'Colunas do fluxo do chamado com cartões. Arraste um cartão para um agente para passar o chamado para ele; os agentes usam orq board.'
  },
  'topo.visao.mudancas': {
    title: 'Mudanças',
    body: 'O que os agentes alteraram nos repositórios do workspace: diff, quem editou, pedir ajuste numa linha, descartar ou commitar só o que escolher.'
  },
  'topo.ferramenta.select': { title: 'Selecionar', body: 'Move, seleciona e redimensiona itens. Arraste no vazio para selecionar vários.', keys: ['V'] },
  'topo.ferramenta.terminal': {
    title: 'Terminal',
    body: 'Clique ou arraste no canvas para criar um terminal com um agente (Claude Code, Codex, shell, SSH…).',
    keys: ['T']
  },
  'topo.ferramenta.note': { title: 'Nota', body: 'Arquivo Markdown compartilhado: os agentes conectados leem e escrevem nela pelo orq.', keys: ['N'] },
  'topo.ferramenta.text': { title: 'Texto', body: 'Um rótulo solto no canvas, para organizar e explicar o fluxo.', keys: ['L'] },
  'topo.ferramenta.rect': { title: 'Retângulo', body: 'Moldura para agrupar visualmente terminais e notas.', keys: ['B'] },
  'topo.ferramenta.arrow': { title: 'Seta', body: 'Seta desenhada para indicar o fluxo (só visual; quem conecta agentes é a alça do terminal).', keys: ['A'] },
  'topo.ferramenta.draw': { title: 'Desenho livre', body: 'Rabisque à mão livre por cima do canvas.', keys: ['D'] },
  'topo.ferramenta.portal': { title: 'Portal', body: 'Uma página web dentro do canvas (o sistema rodando, a documentação, um painel).', keys: ['P'] },
  'topo.chat': {
    title: 'Chat dos agentes',
    body: 'Fichário com uma aba por agente e o Chat geral com todas as conversas. Fale com um agente ou com vários usando @.'
  },
  'topo.buscar': { title: 'Buscar', body: 'Encontre terminais, notas e comandos do app pelo nome.', keys: ['Ctrl+K'] },
  'topo.presets': {
    title: 'Presets de agentes',
    body: 'Os programas que um terminal pode rodar: comando, argumentos, como digitar a mensagem e como saber que terminou.'
  },
  'topo.papeis': {
    title: 'Papéis',
    body: 'Funções do time (dev, qa, arquiteto…): instruções que o agente recebe ao iniciar, cor da camiseta, modelo e esforço padrão.'
  },
  'topo.rotinas': { title: 'Rotinas', body: 'Mensagens agendadas para um agente (todo dia, a cada N minutos), como um cron do time.' },
  'topo.partituras': {
    title: 'Partituras',
    body: 'Times prontos: funções, notas, conexões e quadro salvos num arquivo. Importe uma partitura para montar o fluxo inteiro de uma vez.'
  },
  'topo.hub': {
    title: 'Partituras prontas',
    body: 'Fluxos de agentes que vêm com o app, como revisão em par, TDD e esteira de QA: arraste um para o canvas e ajuste à vontade.'
  },
  'topo.atividade': {
    title: 'Linha do tempo',
    body: 'O que aconteceu nos workspaces: agentes que terminaram ou pedem você, mensagens entre eles (com o tom), o quadro e as rotinas. O número são as novidades desde a última vez que você abriu.'
  },
  'topo.uso': {
    title: 'Uso da assinatura',
    body: 'Quanto da sessão de 5 horas e do limite semanal da sua assinatura (Claude, Codex) já foi usado. O número ao lado é o maior uso agora.'
  },
  'topo.tema': { title: 'Tema claro ou escuro', body: 'Alterna a aparência. Para acompanhar o Windows, use Configurações.' },
  'topo.configuracoes': { title: 'Configurações', body: 'Tema, avisos, retomada das conversas, hibernação, escritório, terminal e atalhos.', keys: ['Ctrl+,'] },

  // ------------------------------------------------------------------ barra lateral (workspaces)
  'lateral.expandir': { title: 'Mostrar barra lateral', body: 'Abre a lista de workspaces com nomes, pastas e ações.', keys: ['Ctrl+Shift+B'] },
  'lateral.recolher': {
    title: 'Recolher barra lateral',
    body: 'Deixa só as iniciais dos workspaces, para sobrar espaço para o canvas.',
    keys: ['Ctrl+Shift+B']
  },
  'lateral.adicionar': {
    title: 'Abrir pasta de projeto',
    body: 'Escolha uma pasta para virar workspace. Canvas, notas e rotinas ficam em .maestrinho dentro dela; nada sai da sua máquina.'
  },
  'lateral.workspace': {
    title: 'Workspace',
    body: 'Troca para este projeto. Os terminais dos outros workspaces abertos continuam rodando.',
    keys: ['Ctrl+↑', 'Ctrl+↓']
  },
  'lateral.ausente': {
    title: 'Pasta não encontrada',
    body: 'A pasta foi movida, renomeada ou apagada. Dá para tirá-la da lista pelo × na barra lateral.'
  },
  'lateral.aoVivo': {
    title: 'Terminais em execução',
    body: 'Este workspace está aberto e os agentes dele continuam trabalhando, mesmo enquanto você está em outro projeto.'
  },
  'lateral.abrirPasta': { title: 'Abrir no explorador', body: 'Abre a pasta do projeto no explorador de arquivos.' },
  'lateral.fechar': {
    title: 'Fechar workspace',
    body: 'Encerra os terminais deste projeto (pede confirmação). O layout fica salvo e volta quando você abrir a pasta de novo.'
  },
  'lateral.esquecer': {
    title: 'Remover da lista',
    body: 'Tira o workspace da lista. Nada é apagado: a pasta e o .maestrinho continuam no disco.'
  },

  // ------------------------------------------------------------------ floors
  'floors.terreo': {
    title: 'Térreo',
    body: 'A pasta principal do projeto, na branch em que ela está. Os floors são cópias isoladas para trabalhar em paralelo.'
  },
  'floors.floor': {
    title: 'Floor',
    body: 'Ambiente isolado numa branch própria (git worktree): os terminais dele trabalham numa cópia do projeto. Duplo clique ou botão direito mostra o status.'
  },
  'floors.descartar': {
    title: 'Descartar floor…',
    body: 'Mostra o status do floor (alterações, commits à frente) e pede confirmação. Descartar apaga o worktree e a branch; o app nunca faz merge sozinho.'
  },
  'floors.novo': {
    title: 'Novo floor',
    body: 'Cria um ambiente isolado numa branch nova (git worktree) para agentes trabalharem em paralelo sem mexer na pasta principal.'
  },

  // ------------------------------------------------------------------ canvas: zoom e menu de contexto
  'canvas.zoom.aproximar': { title: 'Aproximar', body: 'Aumenta o zoom do canvas. Ctrl com a rodinha do mouse também aproxima e afasta.', keys: ['Ctrl+='] },
  'canvas.zoom.afastar': {
    title: 'Afastar',
    body: 'Diminui o zoom para ver mais do canvas. Com zoom muito baixo, os terminais mostram só o nome.',
    keys: ['Ctrl+-']
  },
  'canvas.enquadrarTudo': { title: 'Enquadrar tudo', body: 'Ajusta o zoom e a posição para caber na tela todos os itens do floor atual.', keys: ['Ctrl+0'] },
  'canvas.menu.novoTerminal': {
    title: 'Novo terminal aqui',
    body: 'Cria um terminal neste ponto: você escolhe o agente, o nome e o papel. Duplo clique no canvas faz o mesmo.',
    keys: ['T']
  },
  'canvas.menu.novaNota': {
    title: 'Nova nota aqui',
    body: 'Cria uma nota Markdown neste ponto ou coloca aqui uma nota que já existe no projeto.',
    keys: ['N']
  },
  'canvas.menu.novoPortal': {
    title: 'Novo portal aqui',
    body: 'Abre uma página web neste ponto do canvas (o sistema rodando, a documentação, um painel).',
    keys: ['P']
  },
  'canvas.menu.colar': {
    title: 'Colar',
    body: 'Cola no centro da tela os itens copiados. Terminais colados ganham nome novo e começam uma conversa nova.',
    keys: ['Ctrl+V']
  },
  'canvas.menu.copiarSelecao': { title: 'Copiar seleção', body: 'Copia o texto selecionado na tela do terminal.', keys: ['Ctrl+Shift+C'] },
  'canvas.menu.colarTerminal': {
    title: 'Colar no terminal',
    body: 'Cola o texto copiado no terminal. Se houver um print copiado, cola o caminho da imagem para o agente ler.',
    keys: ['Ctrl+Shift+V']
  },
  'canvas.menu.renomear': {
    title: 'Renomear',
    body: 'Muda o nome do terminal. Os outros agentes passam a usar o nome novo em orq send.',
    keys: ['F2']
  },
  'canvas.menu.conectar': {
    title: 'Conectar a…',
    body: 'Em seguida, clique no terminal, nota ou portal de destino para ligar os dois. Esc cancela.',
    keys: ['Ctrl+L']
  },
  'canvas.menu.duplicar': {
    title: 'Duplicar',
    body: 'Cria ao lado uma cópia dos itens selecionados, com as conexões entre eles. Terminais copiados começam conversa nova.',
    keys: ['Ctrl+D']
  },
  'canvas.menu.copiar': { title: 'Copiar', body: 'Guarda os itens selecionados para colar neste ou em outro workspace.', keys: ['Ctrl+C'] },
  'canvas.menu.organizar': {
    title: 'Organizar em grade',
    body: 'Alinha os itens selecionados numa grade. Repita para alternar entre grade e linha.',
    keys: ['Ctrl+Shift+T']
  },
  'canvas.menu.enquadrar': { title: 'Enquadrar', body: 'Centraliza este item e ajusta o zoom para ele ocupar a tela.', keys: ['Ctrl+\\'] },
  'canvas.menu.remover': {
    title: 'Remover',
    body: 'Tira os itens selecionados do canvas (pede confirmação). Terminais têm o processo encerrado; arquivos de notas são mantidos.',
    keys: ['Ctrl+W']
  },

  // ------------------------------------------------------------------ busca rápida (Ctrl+K)
  'busca.voltar': { title: 'Voltar', body: 'Volta à etapa anterior da busca, sem fechar.', keys: ['Esc'] },
  'busca.perguntar': {
    title: 'Perguntar a um terminal',
    body: 'Escolha um terminal, veja a tela dele ao vivo e mande uma mensagem sem sair do que está fazendo.'
  },
  'busca.acompanhar': {
    title: 'Acompanhar um terminal',
    body: 'Mostra a tela de um terminal ao vivo, sem levar você até ele. Enter vai ao terminal.'
  },
  'busca.novoTerminal': {
    title: 'Novo terminal',
    body: 'Cria um terminal no centro da tela: escolha o agente, o nome e o papel.',
    keys: ['Ctrl+T']
  },
  'busca.novaNota': { title: 'Nova nota', body: 'Ativa a ferramenta Nota: clique ou arraste no canvas para criar.', keys: ['N'] },
  'busca.novoPortal': { title: 'Novo portal', body: 'Ativa a ferramenta Portal: clique ou arraste no canvas para abrir uma página web.', keys: ['P'] },
  'busca.barraLateral': { title: 'Barra lateral', body: 'Mostra ou esconde a lista de workspaces à esquerda.', keys: ['Ctrl+Shift+B'] },
  'busca.minimapa': {
    title: 'Minimapa',
    body: 'Mostra ou esconde a miniatura do canvas no canto; arraste nela para navegar em canvas grandes.',
    keys: ['Ctrl+Shift+M']
  },
  'busca.redefinirFoco': {
    title: 'Redefinir foco',
    body: 'Tira o teclado do terminal ou campo atual e volta à ferramenta Selecionar, para os atalhos do canvas funcionarem.'
  },

  // ------------------------------------------------------------------ boas-vindas
  'boasvindas.abrir': {
    title: 'Abrir pasta',
    body: 'Escolha a pasta de um projeto para virar workspace. O canvas, as notas e as rotinas ficam em .maestrinho dentro dela.'
  },
  'boasvindas.recente': {
    title: 'Abrir projeto recente',
    body: 'Reabre o canvas como você deixou. Com a retomada ligada, os agentes voltam na conversa anterior.'
  }
} satisfies Record<string, HintText>
