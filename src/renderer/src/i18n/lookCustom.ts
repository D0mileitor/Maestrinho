/** Textos do personagem próprio (aba Aparência do terminal). */
export const lookCustomText = {
  title: 'Personagem próprio',
  none: 'Nenhum (usar o personagem desenhado abaixo)',
  import: 'Importar…',
  imported: (file: string) => `Personagem "${file}" importado para este workspace.`,
  overrides: 'Com um personagem próprio escolhido, as cores e acessórios abaixo não valem no escritório.',
  howTo: 'Como criar um (por exemplo, pedindo ao Claude Code)',
  format:
    'PNG com fundo transparente, 4 colunas × 5 linhas de quadros 16×32 (64×160 no total; maior também vale, na mesma proporção). Linhas: frente, costas, lado (olhando para a direita), sentado digitando e comemorando. Uma imagem só também serve: ela vale para todas as poses.',
  describe: 'Descreva o personagem (ex.: um robô azul com antena e cachecol amarelo)',
  saveTemplate: 'Salvar modelo da folha…',
  templateSaved: (path: string) => `Modelo salvo em ${path}. Mande junto com as instruções para o agente.`,
  copyPrompt: 'Copiar instruções para o agente',
  copied: 'Instruções copiadas: cole no Claude Code (ou outro agente) e depois importe o PNG que ele gerar.',
  copyFailed: 'Não foi possível copiar as instruções.'
}
