/** Textos de modelo, esforço e nome da sessão dos agentes. */
export const agentText = {
  model: 'Modelo',
  effort: 'Esforço',
  agentDefault: 'Padrão do agente',
  fromRole: (v: string) => `Da função: ${v}`,
  modelPlaceholder: 'padrão do agente',
  hint: 'Valem ao iniciar o terminal. A função define o padrão; aqui você troca só para este terminal.',
  efforts: {
    minimal: 'mínimo',
    low: 'baixo',
    medium: 'médio',
    high: 'alto',
    xhigh: 'muito alto',
    max: 'máximo',
    ultra: 'ultra'
  } as Record<string, string>,
  effortLabel: (e: string) => `${agentText.efforts[e] ?? e} (${e})`,
  family: { claude: 'Claude Code', codex: 'Codex' },
  roleDefaults: 'Modelo e esforço padrão de quem tem esta função',
  roleDefaultsHint: 'Ao criar um terminal com esta função, ele já vem com estes valores (dá para trocar por terminal). Vazio = padrão do próprio agente.',
  sessionName: (title: string) => `Sessão: ${title}`
} as const
