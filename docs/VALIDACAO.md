# Roteiro de validação manual

Passo a passo para conferir cada fase do projeto. Use uma pasta de projeto de teste (de
preferência um repositório git com ao menos um commit, para testar floors). Tempo total: ~30 min.

Antes de começar: `npm install` (só na primeira vez) e `npm start` — ou duplo clique em
`Maestrinho.cmd`.

---

## Fase 0 — Fundação

1. Abra o app e escolha uma pasta de projeto.
2. Dê duplo clique no canvas e escolha **Shell (PowerShell)**.
3. Digite `Get-Location` e Enter.

**Esperado:** o PowerShell responde dentro do nó; redimensionar o nó (cantos, com ele selecionado)
ajusta as colunas — `$Host.UI.RawUI.WindowSize.Width` muda conforme a largura.

## Fase 1 — Canvas e terminais

1. Crie 4 terminais (duplo clique, tecla `T` + arrastar um retângulo, ou `Ctrl+T`): Shell, Claude Code,
   OpenCode e Codex. Agentes não instalados mostram "Comando … não encontrado no PATH".
2. Arraste os nós pelo cabeçalho, redimensione, dê zoom (`Ctrl`+roda ou `Ctrl+=`/`Ctrl+-`) e pan
   (roda do mouse, botão do meio ou Espaço+arrastar). O texto dos terminais deve ficar nítido em
   qualquer zoom e a seleção com o mouse deve acertar as letras.
3. Renomeie um terminal (duplo clique no nome ou `F2`), reinicie (ícone ⟳) e feche outro (×).
4. Feche o app e abra de novo.

**Esperado:** o layout volta igual (posições, tamanhos, nomes); os processos são recriados.

## Fase 2 — Conexões e comunicação entre agentes

1. Crie dois terminais **Claude Code** chamados `construtor` (papel Construtor) e `revisor` (papel
   Revisor). Se aparecer "Do you trust the files in this folder?", escolha *Yes*.
2. Conecte os dois arrastando da bolinha da borda de um até o outro (ou selecione um, `Ctrl+L` e
   clique no outro).
3. No `construtor`, peça: *"Peça revisão ao revisor com `orq send revisor "Revise: function soma(a,b){return a-b}" --wait`
   e me diga o veredito."*
4. Crie um terceiro terminal Shell **sem conexão** e rode `orq send construtor "oi"`.

**Esperado:** a conexão pisca (pulso dourado) quando a mensagem passa; o `revisor` recebe
`[Mensagem de "construtor" via orq] …`; o `construtor` recebe a resposta e informa o veredito. No
shell sem conexão, o comando falha com "Não há conexão entre …" (código de saída 3).

## Fase 3 — Papéis e notas

1. Abra **Papéis** (ícone de pessoas na barra) e crie/edite um papel (nome, cor, instruções).
2. Crie uma nota (tecla `N` + clique) chamada `progresso.md` e conecte-a a um terminal.
3. No terminal (shell ou agente), rode `orq note append progresso.md "Passo 1 concluído"`.

**Esperado:** a nota atualiza na tela na hora, sem recarregar. Editar a nota (duplo clique no corpo)
salva automaticamente no arquivo `.maestrinho/notes/progresso.md`.

## Fase 4 — Modo gerente

1. Crie um terminal Claude Code com **Modo gerente** marcado e uma nota `spec.md` conectada a ele
   (escreva algo nela).
2. Peça ao gerente: *"Monte um time com construtor, revisor e testador, todos ligados à nota spec.md."*
3. Depois: *"Dispense o testador."*

**Esperado:** três terminais surgem abaixo do gerente, já conectados a ele e à `spec.md`, com os
papéis corretos (selo colorido no cabeçalho); `orq dismiss testador` remove o testador.

## Fase 5 — Floors, rotinas e notificações

1. Com a pasta sendo um repositório git, clique no **+** ao lado de "Térreo" (topo) e crie o floor
   `experimento`. Crie um terminal nele e rode `git branch --show-current`.
2. Dê duplo clique na aba do floor → **Descartar floor** (marque "forçar" se houver alterações).
3. Abra **Rotinas** (ícone de relógio) → Nova rotina: alvo = um terminal, intervalo 10 min, texto:
   ```
   echo passo 1
   &&
   echo passo 2
   &&
   echo passo 3
   ```
   Clique **Executar agora**.
4. Deixe um agente trabalhando e mude para outra janela.

**Esperado:** o terminal do floor está na branch `floor/experimento`; descartar remove o worktree e a
branch, e a branch principal fica intacta. A rotina envia os 3 passos em ordem (cada um quando o
anterior termina) e aparece em "Últimas execuções". Quando o agente termina, aparece o ponto vermelho
no cabeçalho e uma notificação do Windows (clicar foca o terminal).

## Fase 6 — Extras

- **Partituras** (ícone de pauta): selecione alguns nós (arraste uma área), salve como partitura e
  insira de novo — nós, papéis, notas e conexões voltam com nomes únicos.
- **Portais** (tecla `P` + clique): abra `http://localhost:5173` ou qualquer site.
- **Desenho e formas**: teclas `B` (retângulo), `L` (texto), `A` (seta), `D` (desenho livre).
- **Busca** `Ctrl+K`: procure um terminal, uma palavra dentro de uma nota ou um workspace. Use
  *Perguntar a um terminal…* para mandar uma mensagem e ver a resposta ao vivo.
- **Atalhos estilo tmux**: `Ctrl+B` e depois `n`/`p`/setas/número para trocar de terminal;
  `Ctrl+1…9` vai direto (segure `Ctrl` para ver os números).
- **Desfazer** `Ctrl+Z`, copiar/colar/duplicar nós `Ctrl+C`/`Ctrl+V`/`Ctrl+D`, organizar `Ctrl+Shift+T`.
- **Resumo (opcional)**: em Configurações → Assistente de resumo, aponte para o Ollama
  (`http://127.0.0.1:11434/v1`) ou LM Studio (`http://127.0.0.1:1234/v1`) e informe o modelo.
- **Retomada de sessão**: converse com um Claude Code, feche e reabra o app — a conversa continua.
- **SSH** (precisa de um servidor Linux/macOS com `curl` e acesso por chave ou senha): crie um
  terminal com o preset **SSH** e informe `usuario@servidor`. Faça o login (senha/confirmação do host,
  se pedir). **Esperado:** assim que o prompt do servidor aparece, a tela é limpa e surge
  "orq ativo nesta sessão remota"; `orq whoami` no servidor mostra o nome do nó; conecte uma nota ao
  nó e rode `orq note append <nota> "do servidor"` — a nota atualiza no canvas. Sem servidor à mão:
  `npm install --no-save ssh2 && npm run build && node tests/e2e/ssh-local.mjs` sobe um servidor SSH
  local descartável e faz o mesmo roteiro automaticamente.

---

## Testes automatizados (opcional)

```bash
npm run check                                  # tipos + lint + testes unitários/integração
npm run build && node tests/e2e/phase1.mjs     # Fase 1 ponta a ponta
npm run build && node tests/e2e/phase3to5.mjs  # Fases 2–5 com o CLI real (sem IA)
npm run build && node tests/e2e/phase2-claude.mjs  # Fase 2 com dois Claude Code reais
npm install --no-save ssh2 && npm run build && node tests/e2e/ssh-local.mjs  # SSH (servidor local descartável)
```
