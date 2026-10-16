# Maestrinho — guia para agentes de código

Canvas infinito (Electron + React + TypeScript) para orquestrar agentes de IA de código em terminais
(PTY) que conversam entre si pelo CLI `orq`. 100% local, sem telemetria, sem serviços de nuvem do app.
O que foi entregue em cada fase (0–6) e as limitações conhecidas estão em `docs/STATUS.md`.

## Comandos

- `npm run dev` — app em modo desenvolvimento (HMR). `npm start` — build + execução.
- `npm run typecheck` · `npm run lint` · `npm test` (vitest) · `npm run check` (os três).
- `npm run instalador` — instalador do Windows em `release/`, com o SHA-256 no console para as notas da
  release do GitHub (build em pasta temporária, não toca no `out/`).
- Testes ponta a ponta: `node tests/e2e/<arquivo>.mjs` (Playwright + Electron; precisam de `npx electron-vite build` antes).
- Os scripts `dev`/`start` passam por `scripts/launch.mjs`, que remove `ELECTRON_RUN_AS_NODE` herdado
  (extensões do VS Code o definem e o Electron abriria como Node puro).

## Estrutura (por domínio)

- `src/shared/` — código puro compartilhado: `constants.ts` (nome do app/CLI — renomear só aqui),
  `schemas.ts` (zod: workspace, presets, papéis, config), `ipc.ts` (contrato IPC + listas brancas),
  `api.ts` (protocolo da API local do CLI), `idle.ts`, `ansi.ts`, `workspaceOps.ts`, `ids.ts`.
- `src/main/` — processo principal: `app.ts` (AppContext: liga serviços e registra IPC),
  `pty/` (PtyManager com espelho `@xterm/headless`, resolvedor de comandos, env, injeção),
  `store/` (ConfigStore, WorkspaceStore/Manager, escrita atômica), `terminals/TerminalService.ts`,
  `api/` (API local: LocalApi, handlers, mensagens; `POST /v1/cli` + `cliBridge.ts` executam o CLI no
  próprio app para o `orq` remoto), `remote/remoteOrq.ts` (script `orq` POSIX/curl e ativação em
  sessões SSH com túnel reverso), `notes/`, `instructions/`, `routines/`, `floors/`, `partituras/`,
  `cli/shims.ts`, `ipc/` (registro validado), `window.ts` (segurança), `util/log.ts`, `board/` (quadro de
  chamados), `changes/` (revisão das mudanças via git), `terminals/HibernationService.ts`,
  `terminals/agentHooks.ts` (hooks do Claude), `partituras/TeamService.ts` (exportar/importar time) e
  `chatWindow.ts` (chat destacado numa janela própria; o renderer roda com `?janela=chat`) e
  `hub/HubCatalog.ts` (partituras prontas embutidas: todo JSON de `exemplos/partituras` entra no build; o app
  não acessa rede por conta própria nem se atualiza sozinho),
  `usage/` (uso da assinatura e por agente lidos dos arquivos dos agentes; `UsageWatch` avisa e pausa),
  `checkpoints/` (commit em `refs/maestrinho/checkpoints` antes de cada turno; voltar com segurança),
  `portals/PortalRegistry.ts` (página de cada portal para o `orq portal`), `activity/` (linha do tempo),
  `routines/FileTriggerWatcher.ts` (gatilho "arquivos mudaram") e `office/characters.ts` (personagens próprios).
- `src/preload/` — ponte `window.maestrinho` (invoke/send/on com lista branca).
- `src/renderer/src/` — React: `canvas/` (React Flow), `nodes/`, `edges/`, `terminal/` (xterm fora do
  React, contra-escala de zoom), `store/` (zustand), `dialogs/`, `palette/`, `i18n/`, `styles/`,
  `office/` (inclui `customSprites.ts`: folhas de personagem), `board/` (visão Quadro), `changes/` (visão Mudanças,
  checkpoints e pedido de revisão), `chat/` (fichário + chat geral), `usage/` (painel de uso), `activity/` (linha do
  tempo e "enquanto você estava fora").
- `src/cli/` — CLI `orq` (roda no Electron com `ELECTRON_RUN_AS_NODE=1`; só módulos nativos do Node).

## Regras do projeto

- TypeScript strict; sem `any` sem justificativa em comentário. Imports de tipo com `import type`.
- Todo JSON lido do disco ou recebido por IPC/HTTP passa por schema zod.
- O processo principal é a fonte da verdade do documento do workspace; o renderer envia
  `WorkspaceOp`s (aplicadas de forma otimista) e recebe as originadas no main (`workspace:ops`).
- Interface em português do Brasil. Strings da UI em `src/renderer/src/i18n/` (nada de texto solto
  espalhado em lógica). Mensagens de erro da API/CLI também em pt-BR, claras para um agente entender.
- NUNCA registrar em log conteúdo de prompts, mensagens entre agentes ou saída de terminal — só metadados.
- Nunca apagar conteúdo do usuário: arquivos como AGENTS.md só recebem seções delimitadas por marcadores
  (`AGENTS_MD_BEGIN/END`) e só essas seções são removidas.
- Segurança: API só em 127.0.0.1, token por terminal, validação do header Host, sem CORS; renderer com
  `contextIsolation`, sandbox e sem Node; webviews na partição `persist:portals` sem preload.
- Lógica pura sempre com teste em vitest (`*.test.ts` ao lado do arquivo ou em `tests/`).
- Estilo: sem ponto e vírgula, aspas simples, 2 espaços, largura ~120 (ver arquivos existentes).
- Texto da interface segue a preferência de fonte/tamanho: no CSS, `font-family: var(--font-ui)` (ou
  `--font-condensed`) e `font-size`/`line-height` em px sempre como `calc(Npx * var(--font-scale, 1))`
  (ver `src/shared/uiFont.ts`). Terminais, blocos de código e diffs ficam com fonte monoespaçada própria.
