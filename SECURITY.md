# Segurança

O Maestrinho abre terminais e dá aos agentes um CLI que fala com uma API local. Uma falha aqui pode virar
execução de comando na máquina de quem usa, então relatos de segurança são muito bem-vindos.

## Como reportar

**Não abra uma issue pública.** Use o reporte privado do GitHub: aba **Security** do repositório →
**Report a vulnerability**. Conte:

- a versão do Maestrinho e o sistema (Windows/Linux);
- os passos para reproduzir (um repositório ou `workspace.json` de exemplo ajuda muito);
- o que um atacante consegue fazer e o que ele precisa ter antes (acesso à máquina, um repositório que
  você abre, um servidor SSH...).

Você recebe resposta assim que possível. A correção sai numa versão nova e o aviso público vem depois
dela, com crédito a quem reportou, se você quiser.

## Versões com correção

Só a versão mais recente recebe correções de segurança.

## O que está no escopo

- **API local e CLI `orq`**: um terminal agir como outro, contornar o grafo de conexões, ler ou escrever
  fora do workspace, conseguir o token de outro terminal.
- **Interface**: sair do sandbox do renderer, IPC aceitando o que não devia, conteúdo exibido (saída de
  terminal, Markdown, portais) executando código ou comandos.
- **Arquivos do workspace**: abrir uma pasta (`.maestrinho/workspace.json`, `routines.json`, partituras)
  e algo rodar sem você pedir.
- **SSH**: expor o token do terminal ou a API local para outros usuários do servidor remoto.

## Fora do escopo

- O que um agente de IA faz com as permissões que você deu a ele. O Maestrinho não é um sandbox para
  os agentes: eles rodam com o seu usuário, como se você os abrisse num terminal comum.
- Ataques que já exigem controle da sua conta na máquina.

## Em inglês / In English

To report a vulnerability, please use GitHub's private vulnerability reporting (**Security** tab →
**Report a vulnerability**). Do not open a public issue.
