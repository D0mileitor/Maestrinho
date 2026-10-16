/**
 * Strings da interface (pt-BR). Para traduzir, copie este arquivo e troque o import em i18n/index.ts.
 * Funções recebem os valores dinâmicos; nada de concatenação espalhada pelos componentes.
 */
export const ptBR = {
  app: {
    loading: 'Carregando…'
  },
  welcome: {
    title: 'Abra a pasta de um projeto',
    body: 'Cada workspace é uma pasta do seu computador. O layout do canvas, as notas e as rotinas ficam em .maestrinho/ dentro dela; nada sai da sua máquina.',
    open: 'Abrir pasta…',
    recent: 'Recentes',
    missing: 'pasta não encontrada'
  },
  sidebar: {
    title: 'Workspaces',
    add: 'Abrir pasta de projeto',
    live: 'aberto — terminais em execução',
    close: 'Fechar workspace (encerra os terminais)',
    forget: 'Remover da lista',
    collapse: 'Recolher barra lateral',
    expand: 'Mostrar barra lateral',
    openFolder: 'Abrir pasta no explorador'
  },
  chat: {
    open: 'Chat com um terminal',
    title: 'Chat',
    pickTitle: 'Escolha o terminal deste chat',
    pickLead: 'O chat é uma segunda janela para o terminal: o que você manda aqui é digitado nele, e a conversa aparece organizada.',
    pickEmpty: 'Nenhum terminal neste workspace. Crie um (duplo clique no canvas) e volte aqui.',
    floor: (name: string) => `floor ${name}`,
    change: 'Trocar terminal',
    showOnCanvas: 'Ver no canvas',
    close: 'Fechar o chat',
    loading: 'Abrindo a conversa…',
    empty: 'Nenhuma mensagem ainda. Escreva abaixo para começar.',
    omitted: 'Mostrando o final da conversa.',
    jumpNav: 'Suas mensagens (clique para ir até ela)',
    jumpImage: '(imagem)',
    screenNote: 'Este agente não grava um histórico que o Maestrinho saiba ler; o chat mostra a tela do terminal.',
    working: (name: string) => `${name} está trabalhando…`,
    multiHint: 'Marque uma ou mais opções e confirme.',
    multiSubmit: 'Confirmar escolhas',
    helperCalled: 'chamou um ajudante:',
    helperTag: (type?: string, parent?: string) => [parent ? `ajudante de ${parent}` : 'ajudante', type].filter(Boolean).join(' · '),
    helperStatus: { running: 'trabalhando…', done: 'concluído', error: 'parou' },
    helperUsage: (u: { tokens?: number; tools?: number; ms?: number }) => {
      const parts: string[] = []
      if (u.ms !== undefined) {
        const s = Math.round(u.ms / 1000)
        parts.push(s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`)
      }
      if (u.tokens !== undefined) {
        parts.push(
          u.tokens >= 1_000_000
            ? `${(u.tokens / 1_000_000).toFixed(1).replace('.', ',')} mi de tokens`
            : u.tokens >= 1000
              ? `${Math.round(u.tokens / 1000)} mil tokens`
              : `${u.tokens} tokens`
        )
      }
      if (u.tools !== undefined) parts.push(u.tools === 1 ? '1 ação' : `${u.tools} ações`)
      return parts.join(' · ')
    },
    helperShowAll: 'Mostrar a resposta inteira',
    helperShowLess: 'Mostrar menos',
    helperNoReport: 'O ajudante parou sem entregar uma resposta.',
    notRunning: (name: string) => `${name} não está em execução. Reinicie o terminal para conversar.`,
    from: (name: string) => `${name} (via orq)`,
    you: 'você',
    actions: (n: number) => `${n} ações`,
    result: 'Resultado',
    noResult: 'sem saída',
    failed: 'falhou',
    waitingTitle: 'O agente está esperando uma resposta',
    openTerminal: 'Abrir no terminal',
    freeAnswer: 'Outra resposta (escreva aqui)…',
    freeAnswerSend: 'Responder',
    noteTitle: (file: string) => `Nota ${file}`,
    noteKind: 'nota',
    backToChat: (name: string) => `Voltar ao chat (${name})`,
    noteEmpty: 'Nota vazia.',
    noteFileMissing: (file: string) =>
      file === 'historico/INDICE.md'
        ? 'O arquivo ainda está vazio: os chamados aparecem aqui quando a Entrega arquivar o primeiro (historico/INDICE.md).'
        : `A nota ${file} não existe.`,
    noteLinkMissing: (file: string) => `A nota ${file} não está no canvas deste workspace.`,
    noteLinkUnsupported: 'Esse tipo de link não abre aqui.',
    placeholder: (name: string) => `Mensagem para ${name}…`,
    hint: 'Enter envia · Shift+Enter quebra linha · Ctrl+V cola prints',
    send: 'Enviar',
    attach: 'Anexar print ou PDF',
    removeImage: (name: string) => `Remover ${name}`,
    interrupt: 'Parar (Esc)',
    cycleMode: 'Trocar modo (Shift+Tab)',
    effort: (e: string): string =>
      ({ low: 'esforço baixo', medium: 'esforço médio', high: 'esforço alto', xhigh: 'esforço extra alto', max: 'esforço máximo' } as Record<string, string>)[e] ??
      `esforço ${e}`,
    mode: (m: string): string =>
      ({
        auto: 'Modo: auto',
        default: 'Modo: pedir permissão',
        acceptEdits: 'Modo: aceitar edições',
        plan: 'Modo: planejar',
        bypassPermissions: 'Modo: sem confirmações',
        'codex:on-request': 'Aprovação: quando pedir',
        'codex:on-failure': 'Aprovação: se falhar',
        'codex:untrusted': 'Aprovação: comandos não confiáveis',
        'codex:never': 'Aprovação: nunca pede'
      } as Record<string, string>)[m] ?? 'Modo',
    imageNotSaved: 'Não foi possível usar a imagem colada.',
    pdfNoPath: (name: string) => `Não deu para pegar o caminho de ${name}: arraste o arquivo para o chat ou use Anexar.`,
    attachUnsupported: (name: string) => `${name}: dá para anexar prints (imagens) e PDFs.`,
    linkedBadge: 'ligado ao chat'
  },
  buddy: {
    open: 'Abrir',
    openTitle: (name: string) => `Abrir o Maestrinho no terminal ${name}`,
    dismiss: 'Dispensar',
    style: 'Como avisar',
    styles: {
      personagem: 'Personagem no canto da tela, com balão',
      sistema: 'Notificação do Windows',
      ambos: 'Os dois'
    },
    test: 'Ver como fica'
  },
  hub: {
    title: 'Partituras prontas',
    open: 'Partituras prontas: fluxos de agentes para arrastar ao canvas',
    close: 'Fechar as partituras prontas',
    search: 'Buscar fluxos (ex.: revisão, bug, playwright)…',
    loading: 'Carregando o catálogo…',
    noMatch: 'Nenhum fluxo encontrado com esse filtro.',
    emptyCatalog: 'Nenhuma partitura pronta neste build.',
    insert: 'Inserir no centro',
    meta: (agents: number, notes: number) => `${agents} ${agents === 1 ? 'agente' : 'agentes'} · ${notes} ${notes === 1 ? 'nota' : 'notas'}`,
    footer: (total: number) => `${total} ${total === 1 ? 'fluxo' : 'fluxos'} · arraste um cartão para o canvas`
  },
  office: {
    viewLabel: 'Visão',
    canvas: 'Canvas',
    office: 'Escritório',
    empty: 'Nenhum terminal neste floor. Crie terminais no canvas: cada um ganha uma mesa aqui, e cada conexão vira um tapete.',
    backToCanvas: 'Voltar ao canvas',
    hint: 'Clique num agente para conversar ou num quadro para ler a nota · clique direito num agente para interagir com outro',
    helperOf: (parent: string) => `Ajudante de ${parent}`,
    helperWorking: 'trabalhando (clique para ver no chat)',
    helperLeaving: 'terminou',
    helpersTag: (n: number) => (n === 1 ? '1 ajudante' : `${n} ajudantes`),
    boardTip: (file: string) => `${file} · clique para ler`,
    archive: 'Arquivo',
    archiveTip: 'Histórico de chamados · clique para ler o índice',
    archiveFile: 'historico/INDICE.md',
    scene: 'Cenário',
    sceneSetting: 'Cenário do escritório',
    reactionsSetting: 'Bronca e comemoração no escritório',
    reactions: {
      sorteio: 'Sortear o objeto da bronca',
      jornal: 'Jornal enrolado',
      galinha: 'Galinha de borracha',
      luva: 'Luva de boxe na mola',
      mjolnir: 'Mjölnir, o martelo do trovão',
      faca: 'Facadinha (com sangue)',
      desligado: 'Desligado'
    },
    /** Falas da cena: quem reprova, quem leva a bronca, quem aprova e quem é comemorado. */
    scold: ['reprovado!', 'de novo?!', 'testou isso?', 'olha esse bug!', 'isso tá quebrado!'],
    ouch: ['ai!', 'foi mal…', 'já arrumo!', 'ai, ai…'],
    ouchStab: ['aaai!', 'precisava?!', 'sangrou!', 'tá doido?!'],
    cheer: ['aprovado!', 'mandou bem!', 'toca aqui!', 'show!'],
    thanks: ['valeu!', 'eba!', 'uhul!'],
    bonkSound: { jornal: 'PAF!', galinha: 'QUÉÉÉ!', luva: 'POW!', mjolnir: 'KABRUM!', faca: 'TCHAC!' },
    sceneDefault: (name: string) => `Usar o padrão das configurações (${name})`,
    yourBackgrounds: 'Suas imagens (deste projeto)',
    uploadBackground: 'Enviar imagem…',
    uploadHint: 'Use uma imagem vista de cima, como o chão do escritório (pixel art combina melhor). Ela fica salva em .maestrinho/cenarios do projeto.',
    removeBackground: (file: string) => `Apagar a imagem ${file}`,
    backgroundAdded: (file: string) => `Imagem "${file}" salva no projeto e aplicada ao escritório.`,
    backgroundError: 'Não foi possível carregar a imagem de fundo; o escritório usa o cenário padrão.',
    scenes: {
      escritorio: 'Escritório',
      jardim: 'Campo florido',
      refeitorio: 'Refeitório',
      descanso: 'Sala de descanso',
      inferno: 'Inferno'
    },
    openNote: 'Ler a nota',
    interact: 'Interagir com…',
    interactWho: (name: string) => `Quem ${name} vai visitar?`,
    interactWhat: (from: string, to: string) => `${from} → ${to}`,
    interactNobody: 'Não há outro agente neste floor.',
    back: 'Voltar',
    actions: {
      jornal: 'Bronca com jornal enrolado',
      galinha: 'Bronca com galinha de borracha',
      luva: 'Soco com luva de boxe na mola',
      mjolnir: 'Marretadas com o Mjölnir',
      faca: 'Facadinha (com sangue)',
      sorteio: 'Bronca sorteada',
      comemorar: 'Comemorar junto'
    },
    openChat: 'Abrir chat',
    look: 'Aparência…',
    showOnCanvas: 'Ver no canvas',
    edit: 'Editar terminal…',
    activity: {
      typing: 'editando',
      reading: 'lendo',
      terminal: 'rodando comandos',
      browser: 'no navegador',
      writing: 'escrevendo',
      thinking: 'pensando',
      waiting: 'esperando sua resposta',
      attention: 'terminou e aguarda você',
      idle: 'ocioso',
      off: 'parado'
    } as Record<string, string>
  },
  look: {
    tabAgent: 'Agente',
    tabTerminal: 'Terminal',
    tabLook: 'Aparência',
    preview: 'Prévia do personagem',
    views: { front: 'Frente', side: 'Lado', back: 'Costas', cheer: 'Comemorando' } as Record<string, string>,
    walking: 'andando',
    randomize: 'Sortear visual',
    skin: 'Pele',
    hair: 'Cabelo',
    shirt: 'Camiseta',
    shirtFromRole: 'usar a cor do papel',
    monitors: 'Monitores na mesa',
    pants: 'Calça',
    shoes: 'Sapatos',
    accessories: 'Acessórios',
    other: 'outra',
    option: (group: string, n: number) => `${group}, opção ${n}`,
    otherColor: (group: string) => `${group}: outra cor`,
    styles: { curto: 'Curto', longo: 'Longo', cacheado: 'Cacheado', coque: 'Coque', raspado: 'Raspado' } as Record<string, string>,
    acc: { glasses: 'Óculos', headphones: 'Fone', beard: 'Barba', badge: 'Crachá', cap: 'Boné' } as Record<string, string>,
    note: 'Como o agente aparece no escritório. Por padrão a camiseta segue a cor do papel.'
  },
  toolbar: {
    select: 'Selecionar',
    terminal: 'Terminal',
    note: 'Nota',
    text: 'Texto',
    rect: 'Retângulo',
    arrow: 'Seta',
    draw: 'Desenho livre',
    portal: 'Portal',
    search: 'Buscar',
    presets: 'Presets de agentes',
    roles: 'Papéis',
    routines: 'Rotinas',
    partituras: 'Partituras',
    settings: 'Configurações',
    theme: 'Alternar tema claro/escuro',
    fitView: 'Enquadrar tudo',
    hintDraw: 'Arraste no canvas para definir o tamanho, ou clique para usar o tamanho padrão. Esc cancela.'
  },
  canvas: {
    emptyTitle: 'Canvas vazio',
    emptyBody: 'Dê um duplo clique no canvas ou pressione T para criar um terminal.',
    newTerminalHere: 'Novo terminal aqui',
    newNoteHere: 'Nova nota aqui'
  },
  terminal: {
    restart: 'Reiniciar processo',
    close: 'Fechar terminal (encerra o processo)',
    menu: 'Mais ações',
    status: {
      starting: 'iniciando',
      running: 'em execução',
      busy: 'trabalhando',
      idle: 'aguardando',
      attention: 'terminou — aguardando você',
      exited: 'encerrado',
      error: 'erro'
    },
    exitedWith: (code: number) => `processo encerrado (código ${code})`,
    restartAction: 'Reiniciar',
    confirmCloseTitle: 'Fechar terminal?',
    confirmCloseBody: (name: string) => `O processo de "${name}" será encerrado e o nó removido do canvas.`,
    confirmClose: 'Fechar terminal',
    lowZoomHint: 'Aproxime para ver o terminal',
    manager: 'gerente',
    recruitedBy: (name: string) => `recrutado por ${name}`,
    focusHint: 'Clique para focar'
  },
  presetPicker: {
    title: 'Novo terminal',
    lead: 'Escolha o agente que vai rodar neste terminal.',
    name: 'Nome',
    nameHint: 'Usado pelos agentes em "orq send <nome>". Sem espaços.',
    role: 'Papel',
    noRole: 'Sem papel',
    manager: 'Modo gerente (pode recrutar e dispensar agentes)',
    cwd: 'Diretório de trabalho',
    cwdHint: 'Relativo à pasta do workspace. Vazio = raiz do workspace.',
    create: 'Criar terminal',
    notFound: 'não encontrado no PATH',
    nameTaken: 'já existe um terminal com esse nome',
    invalidName: 'nome inválido'
  },
  /** Terminais SSH (presets com {host}). */
  ssh: {
    host: 'Servidor SSH',
    hostPlaceholder: 'usuario@servidor',
    hostHint:
      'Usa o OpenSSH desta máquina e as suas chaves (~/.ssh, incluindo apelidos do ~/.ssh/config). O app abre um túnel para o orq e o ativa na sessão quando o prompt do servidor aparece (requer shell POSIX e curl lá).',
    hostRequired: 'informe o servidor SSH (usuario@servidor)',
    hostInvalid: 'servidor inválido (use usuario@servidor, sem espaços)',
    activate: 'Ativar orq no servidor remoto',
    activated: 'orq ativado nesta sessão SSH.'
  },
  presets: {
    title: 'Presets de agentes',
    lead: 'Como cada agente é iniciado e como recebe mensagens de outros agentes.',
    new: 'Novo preset',
    reset: 'Restaurar presets de fábrica',
    delete: 'Excluir preset',
    save: 'Salvar preset',
    fields: {
      label: 'Nome exibido',
      id: 'Identificador',
      command: 'Comando',
      args: 'Argumentos (um por linha)',
      argsHint: 'Placeholders: {instructions} {name} {role} {cwd} {cli}',
      inputMode: 'Entrega de mensagens',
      inputBracketed: 'Colagem (bracketed paste) — TUIs como Claude Code',
      inputRaw: 'Digitação direta — shells',
      submitDelay: 'Atraso antes do Enter (ms)',
      idleMs: 'Ocioso após silêncio de (ms)',
      idlePatterns: 'Padrões de ociosidade (regex, um por linha)',
      instructions: 'Instruções do papel',
      template: 'Modelo da mensagem recebida',
      templateHint: 'Vazio = cabeçalho padrão. Placeholders: {from} {text} {cli}',
      isShell: 'É um shell (mensagens recebidas são executadas como comandos)'
    },
    targets: {
      'claude-system-prompt': 'System prompt (argumento {instructions})',
      'claude-skill': 'Skill do Claude Code (.claude/skills)',
      'agents-md': 'Seção no AGENTS.md',
      'first-message': 'Primeira mensagem ao iniciar',
      none: 'Nenhuma'
    },
    confirmReset: 'Os presets de fábrica voltarão à configuração original. Presets criados por você são mantidos.'
  },
  /** Estado exato dos agentes (hooks do Claude Code, notificações do Codex). */
  agentState: {
    setting: 'Estado exato dos agentes (hooks e notificações)',
    presetField: 'Como o agente avisa o próprio estado',
    presetOptions: {
      none: 'Pelo silêncio da tela (qualquer programa)',
      claude: 'Hooks do Claude Code (orq hook)',
      codex: 'Notificações do Codex (OSC 9)'
    },
    presetHint: 'Com aviso do agente, o "terminou" é exato e o pedido de aprovação aparece na hora.',
    waiting: 'parado pedindo aprovação ou resposta'
  },
  /** Hibernação de agentes parados. */
  hibernate: {
    setting: 'Hibernar agentes parados há',
    never: 'Nunca',
    minutes: (n: number) => (n >= 60 && n % 60 === 0 ? `${n / 60} h` : `${n} min`),
    title: 'Hibernando',
    body: 'O processo foi encerrado para poupar memória. A conversa está guardada e continua de onde parou.',
    wake: 'Acordar',
    waking: 'Acordando…',
    menuSleep: 'Hibernar agora',
    menuWake: 'Acordar',
    cannot: 'Este agente não pode hibernar: a conversa dele não é retomável (shell ou preset sem retomada de sessão).',
    status: 'hibernando'
  },
  corrupted: {
    title: 'O arquivo do workspace está corrompido',
    body: (error: string) => `Não foi possível ler .maestrinho/workspace.json (${error}). O arquivo original será preservado com outro nome.`,
    restore: (name: string) => `Restaurar backup ${name}`,
    noBackups: 'Nenhum backup válido foi encontrado.',
    startEmpty: 'Começar com um canvas vazio',
    cancel: 'Cancelar'
  },
  common: {
    cancel: 'Cancelar',
    close: 'Fechar',
    save: 'Salvar',
    delete: 'Excluir',
    confirm: 'Confirmar',
    yes: 'Sim',
    no: 'Não'
  },
  errors: {
    generic: (msg: string) => `Erro: ${msg}`,
    ipc: (msg: string) => msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  }
} as const

export type Strings = typeof ptBR
