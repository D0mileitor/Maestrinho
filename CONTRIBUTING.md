# Contribuindo com o Maestrinho

Obrigado pelo interesse! Issues e pull requests são bem-vindos. Para mudanças grandes (recurso novo,
troca de dependência, mudança no protocolo do `orq`), abra uma issue antes para conversarmos.

A interface e as mensagens do app são em português do Brasil, e o código, os comentários e os commits
também. Issues em inglês são bem-vindas.

## Ambiente

- Node.js 22.12 ou mais novo e Git.
- Linux: `python3`, `make` e `g++` (o `node-pty` compila na instalação). No Windows não precisa de nada além
  disso.
- macOS ainda não é suportado.

```bash
npm install
npm run dev        # app com recarga automática
```

Mapa do código, por domínio: [CLAUDE.md](CLAUDE.md) (serve para pessoas e para agentes de código).

## Antes de abrir o PR

```bash
npm run check      # typecheck + lint + testes (o CI roda o mesmo no Windows e no Linux)
```

Os testes ponta a ponta abrem o app de verdade (Playwright + Electron) e não rodam no CI:

```bash
npm run build && node tests/e2e/phase1.mjs
```

| Variável | Para quê |
|---|---|
| `MAESTRINHO_E2E_JANELA="x,y,largura,altura"` | abre a janela de teste nessa posição (ex.: no segundo monitor, sem atrapalhar quem usa o computador) |
| `MAESTRINHO_USER_DATA` | pasta de dados do app (os e2e já usam uma temporária) |
| `SHOT_DIR` | onde salvar os screenshots dos e2e (padrão: `test-results/`) |
| `USE_GIT_SSH=1` | no `ssh-local.mjs`, usa o `ssh` do Git em vez do OpenSSH do Windows |

Roteiro de validação manual: [docs/VALIDACAO.md](docs/VALIDACAO.md).

## Regras do código

- TypeScript strict; nada de `any` sem um comentário explicando. Imports de tipo com `import type`.
- Todo JSON lido do disco ou recebido por IPC/HTTP passa por um schema zod.
- O processo principal é a fonte da verdade do workspace: o renderer envia `WorkspaceOp`s e recebe as que
  nascem no main.
- Textos da interface ficam em `src/renderer/src/i18n/`, nunca soltos na lógica. Mensagens de erro da API e
  do CLI também em pt-BR, claras o bastante para um agente entender o que fazer.
- **Nunca** registrar em log o conteúdo de prompts, mensagens entre agentes ou saída de terminal; só
  metadados.
- **Nunca** apagar conteúdo do usuário: arquivos como `AGENTS.md` só recebem seções entre marcadores, e só
  essas seções são removidas.
- Segurança: API só em `127.0.0.1`, token por terminal, header `Host` validado, sem CORS; renderer com
  `contextIsolation`, sandbox e sem Node.
- Lógica pura sempre com teste em vitest (`*.test.ts` ao lado do arquivo ou em `tests/`).
- Estilo: sem ponto e vírgula, aspas simples, 2 espaços, linhas de até ~120 colunas. O ESLint e os arquivos
  vizinhos são a referência.
- CSS de texto da interface: `font-family: var(--font-ui)` e tamanhos como `calc(Npx * var(--font-scale, 1))`
  (ver `src/shared/uiFont.ts`).

## Commits e pull requests

- Mensagens em português, com um assunto curto que diga o que mudou.
- No PR, conte o que muda e como você testou. Mudou a interface? Um screenshot ajuda muito.
- Falhas de segurança não vão em issue nem PR público: veja [SECURITY.md](SECURITY.md).

## Licença

Ao contribuir, você concorda em licenciar a sua contribuição sob a [licença MIT](LICENSE) do projeto.
