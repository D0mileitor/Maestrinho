/** Textos do diálogo de configurações (títulos dos grupos e campos da fonte da interface). */
export const settingsText = {
  groups: { appearance: 'Aparência', agents: 'Agentes', notices: 'Avisos' },
  uiFont: 'Fonte da interface',
  uiFontDefault: 'IBM Plex Sans (padrão)',
  uiFontSize: 'Tamanho do texto',
  uiFontOther: 'Outra fonte…',
  uiFontOtherPlaceholder: 'Nome da fonte instalada (ex.: Fira Sans)',
  /** Fontes oferecidas na lista (só aparecem as instaladas; "Outra fonte…" aceita qualquer nome). */
  uiFontSuggestions: [
    'Segoe UI',
    'Segoe UI Variable Text',
    'Arial',
    'Calibri',
    'Verdana',
    'Tahoma',
    'Trebuchet MS',
    'Georgia',
    'Inter',
    'Roboto',
    'Noto Sans',
    'Ubuntu',
    'DejaVu Sans',
    'Cascadia Code',
    'Consolas'
  ],
  checkpoints: 'Checkpoint (git) antes de cada turno',
  notifyOnIdle: 'Avisar quando um agente terminar',
  notifyUnfocused: 'Notificação do Windows só fora do app',
  resumeSessions: 'Retomar a conversa ao reabrir ou reiniciar',
  terminalFont: 'Fonte do terminal',
  terminalFontSize: 'Tamanho da fonte do terminal',
  // Sobre
  versions: 'Versões',
  current: (v: string) => `Você está na versão ${v}. O app não procura versões novas sozinho: elas saem no GitHub.`,
  openReleases: 'Ver versões no GitHub',
  privacy:
    'Sem conta e sem telemetria. O app só usa a rede para o que você configurar (portais e o assistente de resumo); os agentes acessam o que você permitir a eles.'
} as const
