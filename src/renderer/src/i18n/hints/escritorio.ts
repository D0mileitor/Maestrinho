import type { HintText } from '../../hints/content'

/** Hints da visão Escritório: cenário, aparência dos personagens e interações entre eles. */
export const escritorioHints = {
  'escritorio.voltarCanvas': { title: 'Voltar ao canvas', body: 'Crie terminais no canvas: cada um ganha uma mesa aqui, e cada conexão vira um tapete.' },
  'escritorio.menu.chat': { title: 'Conversar', body: 'Abre o chat deste agente no painel lateral (o mesmo que clicar nele).' },
  'escritorio.menu.aparencia': { title: 'Aparência', body: 'Pele, cabelo, roupas e acessórios do personagem. Fica salva no próprio terminal.' },
  'escritorio.menu.editar': { title: 'Editar terminal', body: 'Nome, função, programa, pasta, modelo e esforço do agente.' },
  'escritorio.menu.canvas': { title: 'Ver no canvas', body: 'Volta ao canvas com este terminal enquadrado e selecionado.' },
  'escritorio.menu.nota': { title: 'Ler a nota', body: 'Abre a nota no painel lateral; ela se atualiza sozinha quando um agente escreve nela.' },
  'escritorio.menu.interagir': {
    title: 'Interagir com outro agente',
    body: 'Escolha quem este personagem vai visitar e o que fazer lá: uma bronca (jornal, galinha, luva, Mjölnir ou facadinha) ou comemorar junto. Vale entre quaisquer agentes, mesmo sem conexão.'
  },
  'escritorio.menu.voltar': { title: 'Voltar', body: 'Volta ao passo anterior do menu.' },
  'escritorio.acao.jornal': { title: 'Jornal enrolado', body: 'Duas pancadas na cabeça com "PAF!"; o colega fica vendo estrelas.' },
  'escritorio.acao.galinha': { title: 'Galinha de borracha', body: 'Duas galinhadas com "QUÉÉÉ!"; o colega fica vendo estrelas.' },
  'escritorio.acao.luva': { title: 'Luva de boxe na mola', body: 'Dois socos de mola com "POW!"; o colega fica vendo estrelas.' },
  'escritorio.acao.mjolnir': { title: 'Mjölnir', body: 'O céu escurece e cada marretada chama um raio do teto, com clarão na tela e "KABRUM!".' },
  'escritorio.acao.faca': { title: 'Facadinha', body: 'Duas estocadas com "TCHAC!": sangue espirrando, poça no chão e respingos na tela.' },
  'escritorio.acao.sorteio': { title: 'Bronca sorteada', body: 'Um dos objetos de desenho animado, sorteado na hora (a facadinha fica de fora).' },
  'escritorio.acao.comemorar': { title: 'Comemorar', body: 'Braços para cima e confete; o colega pula na cadeira.' },
  'escritorio.cenario': {
    title: 'Cenário deste workspace',
    body: 'Escritório, campo florido, refeitório, sala de descanso, inferno ou uma imagem sua. Sem escolha, vale o padrão das Configurações.'
  },
  'escritorio.cenario.enviar': {
    title: 'Enviar imagem',
    body: 'PNG, JPEG, WebP ou GIF até 12 MB, de preferência vista de cima. Fica salva em .maestrinho/cenarios do projeto.'
  },
  'escritorio.cenario.opcao': { title: 'Aplicar este cenário', body: 'Vale só para este workspace; os outros continuam com o deles.' },
  'escritorio.cenario.padrao': { title: 'Usar o padrão', body: 'Este workspace volta a seguir o cenário padrão das Configurações.' },
  'escritorio.cenario.apagar': { title: 'Apagar a imagem', body: 'Remove a imagem de .maestrinho/cenarios; se estava em uso, o escritório volta ao padrão.' },
  'escritorio.aparencia.vista': { title: 'Girar a prévia', body: 'Mostra o personagem de frente, de costas, de lado, sentado ou comemorando.' },
  'escritorio.aparencia.proprio': {
    title: 'Personagem próprio',
    body: 'Uma folha de sprites importada para este workspace substitui o personagem desenhado no escritório (e no avatar do chat).'
  },
  'escritorio.aparencia.importar': {
    title: 'Importar personagem',
    body: 'Escolha um PNG, WebP ou GIF com fundo transparente. Ele é copiado para .maestrinho/personagens do projeto e fica disponível para todos os terminais do workspace.'
  },
  'escritorio.aparencia.modelo': {
    title: 'Modelo da folha',
    body: 'Salva um PNG 64×160 no formato exato, com um personagem de exemplo em cada pose. Dê ao agente junto com as instruções para ele seguir a grade.'
  },
  'escritorio.aparencia.instrucoes': {
    title: 'Instruções para o agente',
    body: 'Copia um pedido pronto (com a descrição acima) para colar no Claude Code ou outro agente gerar o personagem no formato certo.'
  },
  'escritorio.aparencia.sortear': { title: 'Sortear visual', body: 'Pele, cabelo, roupas e acessórios aleatórios. Dá para sortear de novo até gostar.' },
  'escritorio.aparencia.penteado': { title: 'Penteado', body: 'Formato do cabelo; a cor fica na linha logo abaixo.' },
  'escritorio.aparencia.cor': { title: 'Escolher esta cor', body: 'A prévia muda na hora; a aparência é salva junto com o terminal.' },
  'escritorio.aparencia.outraCor': { title: 'Outra cor', body: 'Abre o seletor de cores para escolher qualquer tom.' },
  'escritorio.aparencia.andando': { title: 'Prévia andando', body: 'Mostra o personagem caminhando, como quando leva um recado pelo tapete.' },
  'escritorio.aparencia.camisetaPapel': {
    title: 'Camiseta na cor da função',
    body: 'A camiseta acompanha a cor do papel (dev, qa…): trocar a função do terminal troca a cor.'
  },
  'escritorio.aparencia.monitores': {
    title: 'Monitores na mesa',
    body: 'De 1 a 6. De 4 em diante, os que passam de 3 ficam numa fileira em cima. O principal mostra o que o agente está fazendo; os outros acompanham.'
  },
  'escritorio.aparencia.acessorio': { title: 'Acessório', body: 'Liga ou desliga. Combina com os outros (óculos e fone ao mesmo tempo, por exemplo).' }
} satisfies Record<string, HintText>
