/** Item da aba Atalhos: rótulo curto na lista; o detalhe e as teclas completas aparecem no hint. */
export interface ShortcutHelp {
  /** Como aparece na lista (compacto). */
  keys: string
  label: string
  detail?: string
  /** Combinações completas para o hint (padrão: `keys`). */
  hintKeys?: string[]
}

export const SHORTCUT_HELP: ShortcutHelp[] = [
  { keys: 'Ctrl+K / Ctrl+P', label: 'Busca rápida e comandos', detail: 'Terminais, notas, ações e a saída dos terminais.', hintKeys: ['Ctrl+K', 'Ctrl+P'] },
  { keys: 'Duplo clique', label: 'Novo terminal no ponto', detail: 'Cria o terminal onde você clicou no canvas.' },
  {
    keys: 'T N L B A D P',
    label: 'Ferramentas do canvas',
    detail: 'T terminal · N nota · L texto · B retângulo · A seta · D desenho · P portal.',
    hintKeys: ['T', 'N', 'L', 'B', 'A', 'D', 'P']
  },
  { keys: 'Ctrl+T', label: 'Novo terminal no centro', detail: 'No centro da parte do canvas que está na tela.' },
  { keys: 'Ctrl+1…9', label: 'Ir para o terminal N', detail: 'Na ordem de leitura do canvas: da esquerda para a direita, de cima para baixo.' },
  { keys: 'Ctrl+Shift+A', label: 'Próximo pedindo atenção', detail: 'Vai ao próximo terminal que terminou ou precisa de você.' },
  { keys: 'Ctrl+Alt+→ / ←', label: 'Próximo nó conectado', detail: 'Percorre os nós ligados ao selecionado; ← volta ao anterior.', hintKeys: ['Ctrl+Alt+→', 'Ctrl+Alt+←'] },
  { keys: 'Ctrl+↑ / ↓', label: 'Workspace anterior/próximo', hintKeys: ['Ctrl+↑', 'Ctrl+↓'] },
  {
    keys: 'Ctrl+B, n p 1-9',
    label: 'Navegar estilo tmux',
    detail: 'Ctrl+B e depois: n (próximo terminal), p (anterior), 1 a 9 (terminal N) ou as setas (o vizinho naquela direção).',
    hintKeys: ['Ctrl+B']
  },
  {
    keys: 'Ctrl+B, z c x ,',
    label: 'Ações estilo tmux',
    detail: 'Ctrl+B e depois: z liga/desliga o modo foco do terminal, c cria um terminal ao lado, x fecha, "," renomeia.',
    hintKeys: ['Ctrl+B']
  },
  { keys: 'Ctrl+W / Delete', label: 'Remover seleção', detail: 'Com o canvas focado (fora de um terminal).', hintKeys: ['Ctrl+W', 'Delete'] },
  {
    keys: 'Ctrl+Z / Ctrl+Shift+Z',
    label: 'Desfazer / refazer',
    detail: 'No canvas. Terminais criados não são removidos pelo desfazer.',
    hintKeys: ['Ctrl+Z', 'Ctrl+Shift+Z']
  },
  { keys: 'Ctrl+C / V / D', label: 'Copiar, colar, duplicar nós', detail: 'Com o canvas focado (fora de um terminal).', hintKeys: ['Ctrl+C', 'Ctrl+V', 'Ctrl+D'] },
  { keys: 'Ctrl+Shift+T', label: 'Organizar seleção em grade', detail: 'Repita para alternar entre grade e linha.' },
  { keys: 'F2', label: 'Renomear selecionado' },
  { keys: 'Ctrl+L', label: 'Conectar selecionado a…', detail: 'Depois clique no nó que vai receber a conexão.' },
  { keys: 'Ctrl+= / - / 0', label: 'Zoom / enquadrar tudo', detail: 'Ctrl+= aproxima, Ctrl+- afasta, Ctrl+0 enquadra tudo.', hintKeys: ['Ctrl+=', 'Ctrl+-', 'Ctrl+0'] },
  { keys: 'Ctrl+Shift+B', label: 'Mostrar/ocultar a lateral', detail: 'A barra lateral com os workspaces.' },
  { keys: 'Ctrl+Shift+M', label: 'Mostrar/ocultar minimapa' },
  {
    keys: 'Ctrl+C / V (terminal)',
    label: 'Copiar / colar no terminal',
    detail: 'Ctrl+C copia se houver texto selecionado; sem seleção, interrompe o programa (como num terminal comum). Ctrl+V cola.',
    hintKeys: ['Ctrl+C', 'Ctrl+V']
  },
  {
    keys: 'Ctrl+Shift+C / V',
    label: 'Copiar / colar sem interromper',
    detail: 'No terminal: sempre copia ou cola, nunca interrompe o programa.',
    hintKeys: ['Ctrl+Shift+C', 'Ctrl+Shift+V']
  }
]
