import { CLI_NAME } from '@shared/constants'
import { AgentPresetSchema, RoleSchema, type AgentPreset, type Role } from '@shared/schemas'
import { defaultShell } from '../pty/shell'

/** Presets de fábrica. Podem ser editados pelo usuário e restaurados a qualquer momento. */
export function builtinPresets(): AgentPreset[] {
  const shell = defaultShell()
  const isWin = process.platform === 'win32'
  return [
    AgentPresetSchema.parse({
      id: 'shell',
      label: isWin ? 'Shell (PowerShell)' : 'Shell',
      command: shell.command,
      args: shell.args,
      inputMode: 'raw',
      submitDelayMs: 30,
      idleMs: 1500,
      // Prompt padrão do PowerShell ("PS C:\...>") e de shells POSIX ("$ " / "# ").
      idlePatterns: ['^PS [^>]*>\\s?$', '[$#]\\s?$'],
      instructionsTarget: 'none',
      messageTemplate: '{text}',
      isShell: true,
      builtin: true
    }),
    AgentPresetSchema.parse({
      id: 'claude',
      label: 'Claude Code',
      command: 'claude',
      // As instruções do papel + referência do CLI entram no system prompt; os comandos do CLI
      // ficam pré-autorizados para o agente não pedir permissão a cada mensagem.
      args: ['--append-system-prompt', '{instructions}', '--allowedTools', `Bash(${CLI_NAME} *)`],
      inputMode: 'bracketed',
      submitDelayMs: 300,
      idleMs: 4000,
      instructionsTarget: 'claude-system-prompt',
      // Cada terminal tem um id de sessão: ao reabrir o app a conversa continua.
      sessionArgs: ['--session-id', '{sessionId}'],
      resumeArgs: ['--resume', '{sessionId}'],
      sessionStore: 'claude',
      // Hooks avisam o app quando o agente termina ou para pedindo aprovação (estado exato).
      agentEvents: 'claude',
      // Modelo/esforço escolhidos no terminal (ou pela função) e nome da sessão "projeto/agente" (Remote Control, /resume).
      modelArgs: ['--model', '{model}'],
      effortArgs: ['--effort', '{effort}'],
      titleArgs: ['--name', '{title}', '--remote-control-session-name-prefix', '{titleSlug}'],
      builtin: true
    }),
    AgentPresetSchema.parse({
      id: 'opencode',
      label: 'OpenCode',
      command: 'opencode',
      args: [],
      inputMode: 'bracketed',
      submitDelayMs: 300,
      idleMs: 4000,
      instructionsTarget: 'agents-md',
      builtin: true
    }),
    AgentPresetSchema.parse({
      id: 'ssh',
      label: 'SSH (servidor remoto)',
      command: 'ssh',
      // {host} vem do campo "Servidor" do terminal. O app acrescenta o túnel reverso para o orq.
      args: ['-t', '{host}'],
      inputMode: 'raw',
      submitDelayMs: 50,
      idleMs: 1500,
      idlePatterns: ['[$#%>]\\s?$'],
      instructionsTarget: 'none',
      messageTemplate: '{text}',
      isShell: true,
      remoteOrq: true,
      builtin: true
    }),
    AgentPresetSchema.parse({
      id: 'codex',
      label: 'Codex',
      command: 'codex',
      // O sandbox padrão do Codex bloqueia rede, inclusive 127.0.0.1, onde fica a API local do CLI.
      args: ['-c', 'sandbox_workspace_write.network_access=true'],
      // O Codex cria o id da sessão sozinho (o Maestrinho descobre e guarda no nó); ao reabrir, retoma.
      resumeArgs: ['resume', '{sessionId}'],
      sessionStore: 'codex',
      // O TUI avisa o terminal (OSC 9) ao terminar a vez e ao pedir aprovação (estado exato).
      agentEvents: 'codex',
      modelArgs: ['-m', '{model}'],
      effortArgs: ['-c', 'model_reasoning_effort={effort}'],
      inputMode: 'bracketed',
      submitDelayMs: 300,
      idleMs: 4000,
      instructionsTarget: 'agents-md',
      builtin: true
    }),
    AgentPresetSchema.parse({
      id: 'gemini',
      label: 'Gemini CLI',
      command: 'gemini',
      args: [],
      // O Gemini CLI lê GEMINI.md (não AGENTS.md): as instruções vão na primeira mensagem.
      instructionsTarget: 'first-message',
      inputMode: 'bracketed',
      submitDelayMs: 300,
      idleMs: 4000,
      builtin: true
    }),
    AgentPresetSchema.parse({
      id: 'copilot',
      label: 'GitHub Copilot CLI',
      command: 'copilot',
      // O CLI do app fica pré-autorizado (sem pedir permissão a cada mensagem).
      args: [`--allow-tool=shell(${CLI_NAME}:*)`],
      // --session-id cria a conversa com esse id ou retoma a existente: ao reabrir, ela continua.
      sessionArgs: ['--session-id', '{sessionId}'],
      instructionsTarget: 'agents-md',
      inputMode: 'bracketed',
      submitDelayMs: 300,
      idleMs: 4000,
      builtin: true
    }),
    AgentPresetSchema.parse({
      id: 'aider',
      label: 'Aider',
      command: 'aider',
      // O Aider não lê AGENTS.md sozinho: --read o inclui como contexto somente leitura.
      args: ['--read', 'AGENTS.md'],
      instructionsTarget: 'agents-md',
      // Texto numa linha só (colar várias linhas no Aider pelo ConPTY não foi verificado).
      inputMode: 'raw',
      submitDelayMs: 200,
      idleMs: 3000,
      // Prompt do Aider: "> ", "ask> ", "architect multi> ".
      idlePatterns: ['^(\\w+)?( ?multi)?> ?$'],
      builtin: true
    })
  ]
}

/** Papéis de exemplo. */
export function builtinRoles(): Role[] {
  const cli = CLI_NAME
  const roles: Omit<Role, 'builtin'>[] = [
    {
      id: 'lider',
      color: '#d4a849',
      name: 'Líder',
      instructions: [
        'Você coordena o time. Quebre o objetivo em tarefas pequenas e verificáveis, delegue cada uma',
        `ao colega mais adequado com \`${cli} send <nome> "<tarefa>" --wait\` e acompanhe o resultado.`,
        'Mantenha o plano e o andamento registrados nas notas conectadas. Não implemente você mesmo o',
        'que pode ser delegado; revise as entregas e decida os próximos passos.'
      ].join(' ')
    },
    {
      id: 'construtor',
      color: '#5fb98e',
      name: 'Construtor',
      instructions: [
        'Você implementa as tarefas recebidas. Escreva código limpo, pequeno e testado. Ao terminar uma',
        'entrega relevante, peça revisão ao revisor conectado (se houver) enviando um resumo do que mudou',
        'e onde, e incorpore o feedback. Registre decisões importantes nas notas conectadas.'
      ].join(' ')
    },
    {
      id: 'revisor',
      color: '#6f8fbf',
      name: 'Revisor',
      instructions: [
        'Você revisa mudanças de código. Procure bugs, riscos de segurança, casos de borda e falta de',
        'testes. Responda de forma objetiva: lista numerada de problemas com arquivo/linha e sugestão de',
        'correção, e um veredito final (aprovado / aprovado com ressalvas / reprovado).'
      ].join(' ')
    },
    {
      id: 'testador',
      color: '#c58ad6',
      name: 'Testador',
      instructions: [
        'Você garante a qualidade. Escreva e rode testes automatizados para o que foi implementado,',
        'reproduza bugs relatados e informe resultados com os comandos usados e a saída relevante.',
        'Nunca declare sucesso sem ter rodado os testes.'
      ].join(' ')
    },
    {
      id: 'documentador',
      color: '#5fc0cc',
      name: 'Documentador',
      instructions: [
        'Você mantém a documentação: README, guias de uso e comentários onde forem necessários.',
        'Escreva em português claro e direto, com exemplos executáveis. Atualize as notas conectadas com',
        'um resumo das mudanças documentadas.'
      ].join(' ')
    }
  ]
  return roles.map((r) => RoleSchema.parse({ ...r, builtin: true }))
}
