# Status por fase

Resumo do que foi entregue em cada fase do projeto, decisões de arquitetura e limitações
conhecidas. O passo a passo para validar está em [VALIDACAO.md](VALIDACAO.md).

## Decisões de arquitetura

- **node-pty 1.1.0 (Microsoft)**: traz binários pré-compilados para Windows x64/arm64 com N-API, que
  funcionam no Electron sem recompilar — sem Visual Studio Build Tools e sem admin. Alternativas
  avaliadas: `@homebridge/node-pty-prebuilt-multiarch` (baixa binários do GitHub na instalação) e
  `@lydell/node-pty` (fork). Ficamos com o pacote oficial por ser o mais auditável.
- **Espelho headless por terminal** (`@xterm/headless` + serialize no processo principal): o texto
  limpo de TUIs (Claude Code, OpenCode) para `orq read`/`--wait` vem da tela renderizada, não do fluxo
  bruto com ANSI; e o renderer reconstrói qualquer terminal a partir de um snapshot (recarga, troca de
  workspace) sem perder bytes.
- **Contra-escala de zoom**: o xterm é renderizado no tamanho real e compensado em relação ao zoom do
  canvas, o que deixa o texto nítido e a seleção do mouse correta em qualquer zoom; mudanças só de zoom
  não redimensionam o PTY.
- **Main como fonte da verdade** do documento do workspace; o renderer aplica operações de forma
  otimista. Vários workspaces ficam vivos ao mesmo tempo (trocar não encerra terminais).
- **Token por terminal** na API local (em vez de um token por sessão do app): um agente não consegue
  se passar por outro.
- **CLI no próprio Electron** (`ELECTRON_RUN_AS_NODE=1`): não exige Node instalado; shims gerados em
  tempo de execução (`orq` POSIX para o Git Bash do Claude Code, `orq.cmd` para cmd/PowerShell; sem
  `.ps1`, que políticas de execução corporativas bloqueiam).
- **Linha de comando montada pelo app no Windows** (regras do CommandLineToArgvW): o node-pty deixaria
  sem aspas argumentos que já começam e terminam com aspas, permitindo injetar argumentos via texto de
  papel. Shims `.cmd` do npm são lidos e o alvo é iniciado direto (sem `cmd.exe`).

## Fase 0 — Fundação ✅
Scaffold Electron 44 + React 19 + TypeScript strict + electron-vite 5; PowerShell num ConPTY exibido no
xterm.js 6 com redimensionamento correto. `npm install && npm start` funciona sem admin e sem Build Tools.

## Fase 1 — Canvas e terminais ✅
Canvas infinito (React Flow) com pan, zoom, minimapa e fundo de pautas; criação por duplo clique,
ferramenta+arrastar ou `Ctrl+T`; presets editáveis (Shell, Claude Code, OpenCode, Codex, SSH); renomear,
reiniciar, fechar; layout persistido com escrita atômica, backups e recuperação de arquivo corrompido;
terminais recriados ao reabrir — e, no Claude Code, a conversa é retomada (`--session-id`/`--resume`).

## Fase 2 — Conexões e comunicação ✅
Conexões por alças ou `Ctrl+L`; API local endurecida; CLI `orq` (whoami, peers, send [--wait], read,
note, notify, status) com saída em pt-BR e `--json`; entrega por bracketed paste com atraso
configurável, adiada enquanto o usuário digita; detector de ociosidade; pulso animado na conexão;
limite de mensagens por conexão. Validado com dois Claude Code reais (construtor pede revisão com
`--wait`, revisor responde, construtor relata o veredito).

## Fase 3 — Papéis e notas ✅
CRUD de papéis com cor (5 de exemplo); instruções geradas por preset (system prompt no Claude Code,
seção marcada no AGENTS.md + primeira mensagem no OpenCode/Codex, skill opcional), removidas ao fechar
o terminal sem tocar no conteúdo do usuário; notas Markdown com visualização/edição e recarga ao vivo
(chokidar), `orq note …` com revisão (`--if-revision`).

## Fase 4 — Modo gerente ✅
Flag de gerente; `orq recruit/dismiss/role/connect`; recrutas posicionados abaixo do gerente, já
conectados a ele e às notas indicadas, com o papel certo; trocar o papel reinicia o agente numa
conversa nova.

## Fase 5 — Floors, rotinas e notificações ✅
Floors via `git worktree` (branch `floor/<nome>`, abas no topo, terminais no worktree, status
ahead/dirty com orientação de merge, descarte que remove worktree e branch sem tocar a principal);
rotinas com passos `&&`, pular se ocupado, pausar/retomar, executar agora, histórico; notificações do
Windows quando um agente termina (clicar foca o terminal).

## Fase 6 — Extras ✅
Partituras (salvar/inserir/exportar/importar; nunca executam comandos do arquivo), portais (webview
isolado), formas e desenho livre, busca `Ctrl+K`/`Ctrl+P` em todos os workspaces (inclusive conteúdo
de notas) com *Perguntar…*/*Acompanhar…*, atalhos estilo tmux (prefixo `Ctrl+B`), modo foco (terminal
elevado), desfazer/refazer, copiar/colar/duplicar, organizar em grade, assistente de resumo opcional
(endpoint local compatível com OpenAI).

**Ambientes SSH** (opcional no planejamento): preset de fábrica *SSH* (`ssh -t {host}`, usa o OpenSSH
desta máquina e as chaves/apelidos do `~/.ssh`). O terminal abre com um túnel reverso
(`-R 127.0.0.1:<porta aleatória>:127.0.0.1:<porta da API>`) e, quando o prompt do servidor aparece
(nunca num pedido de senha/confirmação), o app digita no shell remoto a instalação de um `orq` POSIX
em `~/.maestrinho/bin` (só precisa de `curl`) e exporta porta e token na sessão. Esse `orq` remoto
envia os argumentos para `POST /v1/cli` pelo túnel e o próprio app executa o CLI em nome do terminal
— mesmas permissões do grafo, mesma saída e códigos de saída. Validado de ponta a ponta contra um
servidor SSH local descartável (`tests/e2e/ssh-local.mjs`) com o OpenSSH do Windows e o do Git.

## Depois das fases

- **Estado exato dos agentes**: o Claude Code avisa por hooks (`--settings` com `orq hook`, só metadados) e
  o Codex por notificações de terminal (OSC 9, lidas no espelho do PTY). "Terminou" e "precisa de você"
  passam a ser exatos e um comando longo sem saída não vira falso "terminou". Outros programas seguem
  pelo silêncio da tela. Configurações → "Estado exato dos agentes".
- **Hibernação**: agentes parados há N minutos (Configurações; desligado por padrão) ou pelo menu do nó
  têm o processo encerrado com a conversa guardada; acordam retomando a sessão ao abrir, pelo chat, por
  mensagem de outro agente (`orq send`) ou rotina. Shells, SSH e conversas não retomáveis nunca hibernam.
- **Quadro de chamados** (visão Quadro, `.maestrinho/quadro.json`): colunas do fluxo do chamado, cartões
  arrastáveis, soltar num agente passa o chamado para ele; os agentes usam `orq board list|show|add|move|update|comment`.
- **Mudanças** (visão Mudanças): arquivos alterados por repositório do workspace (raiz, floors, pastas dos
  terminais), diff, quem editou (pelos históricos das conversas), pedir ajuste a um agente numa linha,
  descartar (o conteúdo anterior vai para a lixeira) e commit só dos arquivos escolhidos. Arquivos do
  próprio app (`.maestrinho/`, skill do `orq`) ficam de fora.
- **Time pronto**: exportar o canvas inteiro (funções com modelo/esforço, notas, conexões, presets usados,
  colunas do quadro) e importar com prévia; presets do arquivo só entram com o seu aceite (mostrando a
  linha de comando). Sessões e caminhos locais não viajam.
- **Modelo, esforço e nome da sessão**: escolhidos ao criar/editar o terminal, com padrão por função
  (papel) e tipo de agente; a sessão do Claude Code se chama "{projeto}/{agente}" (Remote Control, /resume).
- **Chat em fichário**: uma aba por agente e o "Chat geral" com as conversas de todos (inclusive os recados
  entre eles), `@menção` para falar com um ou vários, contador de novas e alerta "precisa de você".
- **Bronca e comemoração no escritório**: `orq send` classifica o tom da mensagem (`src/shared/mood.ts`:
  reprovação ou aprovação, só no começo do texto) e manda só o tom no `edge:activity`. Reprovação: o remetente vai à
  mesa do colega e acerta a cabeça dele duas vezes (jornal, galinha de borracha, luva na mola ou Mjölnir com raios e
  clarão; o colega vê estrelas). A facadinha (só se escolhida) espirra sangue, deixa uma poça e mancha a tela.
  Aprovação: braços para cima, confete e o colega pula na cadeira. Configurações → Geral (sortear, objeto fixo, desligar).
  Pelo menu do personagem (clique direito → Interagir com…) qualquer agente faz a cena com qualquer outro, mesmo sem
  conexão: `walkRoute` (`src/shared/office.ts`) usa o tapete ou anda pelo chão desviando de mesas e quadros.
- **Hints do Maestrinho**: um balão único (`src/renderer/src/hints/HintLayer.tsx`) no lugar do title nativo, com título,
  explicação e atalhos; textos por área em `src/renderer/src/i18n/hints/` (chaves tipadas, `hint()`/`hintOf()`). Os
  `title` antigos viram o mesmo balão automaticamente; em menus ele abre ao lado do item.
- **Ajudantes (sub-agentes do Claude Code)**: o leitor do histórico (`src/shared/chat.ts`) junta o pedido (`Agent`/`Task`),
  o relatório (`<agent-message>` de *hand-back*, que vem como mensagem interna) e o aviso `<task-notification>` em itens
  `helper` (pedido e resposta, com rosto pela semente = id da chamada); avisos de comando em segundo plano viram nota. O
  escritório recebe a lista em `OfficeActivity.helpers` (atividade pelo histórico de cada ajudante em
  `<sessão>/subagents/agent-<id>.jsonl`) e desenha estagiários em banquinhos em volta de quem chamou.
- **Monitores na mesa**: `Look.monitors` (1 a 6), `monitorLayout`/`mainMonitor` em `src/shared/office.ts`; escolha na aba Aparência.
- **Perguntas do terminal no chat**: a detecção (`detectPendingChoice`) lê as linhas **físicas** da tela até a largura atual
  (`PtyManager.readScreen` / `lastRows`): no Windows o ConPTY não quebra a linha depois de uma linha cheia e as linhas
  lógicas grudavam separadores, abas e opções; depois de diminuir o terminal, as colunas além da largura guardavam a tela
  antiga. Trata a prévia lado a lado do AskUserQuestion, a múltipla escolha (marcadas + "Submit"), perguntas no meio da
  linha ou quebradas, rótulos quebrados ("… (p)"), menus do Codex em colunas e rolados, e o "Reason" das aprovações do
  Codex. Casos em `src/shared/chatChoice.test.ts`, a partir de telas reais do Claude Code 2.1.296 e do Codex 0.162.

## Limitações conhecidas

- **SSH**: o `orq` remoto exige shell POSIX (bash, zsh, sh) e `curl` no servidor, e que o servidor
  permita encaminhamento de porta (`AllowTcpForwarding`, padrão do OpenSSH). Servidores Windows
  (cmd/PowerShell) não são suportados do lado remoto. O token do terminal fica no ambiente da sessão
  remota (visível para o seu usuário e para o root daquele servidor) e vale só enquanto o terminal
  roda. Depois de `sudo -i`, `su` ou outro `ssh` dentro da sessão, use *Ativar orq no servidor
  remoto* no menu ⋯ do nó. Ainda não testado contra servidores reais de produção (só o servidor local
  de teste).
- Codex 0.160 testado (chat, retomada de sessão, estado exato por OSC 9). O preset libera a rede do
  sandbox para o `orq` e o CLI tem fallback para quando o Codex filtra variáveis com "TOKEN". Os hooks
  do Codex não são usados de propósito: exigiriam aprovar a "confiança" dos hooks.
- Sem estado exato (outros programas, ou a opção desligada), "terminou" é deduzido pelo silêncio da tela
  e não distingue de "esperando aprovação". Um agente esperando `orq send --wait` não gera aviso.
- Hibernar encerra também o que o agente deixou rodando em segundo plano (ex.: um servidor iniciado por ele).
- **Checkpoints** só existem em pastas com git; arquivos ignorados pelo `.gitignore` (ex.: `node_modules`, saída
  de build) não são guardados nem restaurados. Em agentes sem estado exato, o "turno" também é marcado ao
  enviar uma mensagem/Enter, e pode haver um ponto extra no meio de um comando demorado (inofensivo).
- **Gemini CLI, Copilot CLI e Aider** rodam sem estado exato (o "terminou" vem do silêncio da tela) e não
  foram testados contra os CLIs reais. O Gemini não retoma a conversa ao reabrir; o Aider não consegue rodar o
  `orq` sem alguém aprovar cada comando (ele não tem lista de comandos liberados).
- **Personagem próprio** vale no escritório, na prévia e no avatar do chat; o aviso no canto da tela continua
  com o personagem desenhado.
- **Portais para agentes**: só a página aberta (não as abas/janelas que ela abrir); o portal precisa estar no
  andar visível do workspace aberto.
- **Uso da assinatura**: só Claude e Codex, lidos de formatos internos dos próprios agentes (o cache
  `cachedUsageUtilization` do `~/.claude.json` e os eventos `token_count` dos históricos do Codex). Os números
  são os da última conversa do agente com o provedor; se o formato mudar, o provedor só some do painel.
  Outros provedores (Gemini, Copilot…) não guardam isso no disco: exigiriam consultar a API deles com o
  token do usuário, o que o app evita. Uma janela que reiniciou depois da última leitura aparece zerada.
  O Codex do WSL (histórico dentro da distro) não é lido.
- `AGENTS.md` e `.claude/skills/orq/` ficam no repositório enquanto o terminal roda (removidos ao
  fechar); evite commitá-los nesse intervalo.
- O build portátil (`npm run pack`) não é assinado digitalmente.
- Mensagens muito longas por linha de comando no `cmd.exe` são limitadas a ~8 mil caracteres; use
  stdin (`orq send <peer> -`).
