import { z } from 'zod'

/**
 * Modelo de dados persistido (workspace.json, config.json, partituras, routines.json).
 * Todo JSON lido do disco passa por estes schemas antes de ser usado.
 */

export const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'id inválido')

/** Nome visível de terminal: usado pelos agentes em `orq send <nome>`, portanto sem espaços. */
export const TerminalNameSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u, 'use letras, números, ".", "_" ou "-" (sem espaços)')

export const PositionSchema = z.object({ x: z.number().finite(), y: z.number().finite() })
export const SizeSchema = z.object({ w: z.number().finite().min(80).max(8000), h: z.number().finite().min(60).max(8000) })
export type Position = z.infer<typeof PositionSchema>
export type Size = z.infer<typeof SizeSchema>

// ---------------------------------------------------------------- presets e papéis

export const InputModeSchema = z.enum(['bracketed', 'raw'])
export type InputMode = z.infer<typeof InputModeSchema>

/**
 * Como o agente recebe as instruções do papel e a referência do CLI:
 * - claude-system-prompt: texto passado via argumento (placeholder {instructions} nos args);
 * - claude-skill: skill em .claude/skills/<cli>/SKILL.md no diretório de trabalho;
 * - agents-md: seção delimitada anexada ao AGENTS.md do diretório de trabalho;
 * - first-message: instruções enviadas como primeira mensagem quando o agente fica pronto;
 * - none: nada.
 */
export const InstructionsTargetSchema = z.enum(['claude-system-prompt', 'claude-skill', 'agents-md', 'first-message', 'none'])
export type InstructionsTarget = z.infer<typeof InstructionsTargetSchema>

export const AgentPresetSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(80),
  /** Executável (resolvido no PATH) — ex.: "claude", "opencode", "powershell.exe". */
  command: z.string().min(1).max(1024),
  /** Argumentos; aceitam placeholders {instructions}, {name}, {role}, {cwd}, {cli}. */
  args: z.array(z.string().max(16384)).max(64).default([]),
  inputMode: InputModeSchema.default('bracketed'),
  /** Atraso entre colar o texto e enviar Enter. */
  submitDelayMs: z.number().int().min(0).max(10_000).default(200),
  /** Sem saída por este tempo (após atividade) = agente ocioso. */
  idleMs: z.number().int().min(250).max(600_000).default(4000),
  /** Regex (sobre a última linha não vazia da tela) que indicam ociosidade imediata. */
  idlePatterns: z.array(z.string().max(500)).max(20).default([]),
  instructionsTarget: InstructionsTargetSchema.default('none'),
  /**
   * Modelo da mensagem entregue ao destino. Placeholders: {from}, {text}, {cli}.
   * Vazio = modelo padrão com cabeçalho de contexto. Use "{text}" para shells.
   */
  messageTemplate: z.string().max(4000).default(''),
  /** Variáveis de ambiente extras. */
  env: z.record(z.string(), z.string().max(8192)).default({}),
  /** Preset é um shell interativo (mensagens recebidas são executadas como comandos). */
  isShell: z.boolean().default(false),
  /**
   * Retomada de sessão: argumentos para iniciar uma sessão nova com id conhecido e para retomá-la.
   * Placeholder {sessionId} (UUID guardado no nó do terminal). Vazio = agente sem retomada.
   */
  sessionArgs: z.array(z.string().max(200)).max(8).default([]),
  resumeArgs: z.array(z.string().max(200)).max(8).default([]),
  /** Como verificar se a sessão existe antes de retomar ('claude' = ~/.claude/projects). */
  sessionStore: z.enum(['none', 'claude', 'codex']).default('none'),
  /**
   * Terminal remoto (SSH): o app adiciona o túnel reverso (`-R`) para a API local e instala o `orq`
   * remoto (script com curl) quando a sessão chega ao prompt do shell. Use {host} nos argumentos.
   */
  remoteOrq: z.boolean().default(false),
  /**
   * Como o agente avisa o próprio estado (terminou / precisa de você): hooks do Claude Code,
   * notificações de terminal do Codex ou nada (deduzido pelo silêncio da tela). Ausente = nada.
   */
  agentEvents: z.enum(['none', 'claude', 'codex']).optional(),
  /** Argumentos para escolher o modelo e o esforço ({model}, {effort}); vazio = o preset não permite escolher. */
  modelArgs: z.array(z.string().max(200)).max(6).optional(),
  effortArgs: z.array(z.string().max(200)).max(6).optional(),
  /** Argumentos com o nome da sessão ({title} = "projeto/agente", {titleSlug} = "projeto-agente"). */
  titleArgs: z.array(z.string().max(200)).max(6).optional(),
  builtin: z.boolean().default(false)
})
export type AgentPreset = z.infer<typeof AgentPresetSchema>

/** Modelo (nome ou apelido) e esforço (low, medium, high...) de um agente. Vazio = padrão do agente. */
export const ModelEffortSchema = z.object({
  model: z
    .string()
    .max(100)
    .regex(/^([A-Za-z0-9][A-Za-z0-9._:/[\]-]*)?$/, 'modelo inválido')
    .optional(),
  effort: z
    .string()
    .max(16)
    .regex(/^([a-z]{2,16})?$/, 'esforço inválido')
    .optional()
})
export type ModelEffort = z.infer<typeof ModelEffortSchema>

export const RoleSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(60),
  instructions: z.string().max(32_000),
  /** Cor do selo do papel (#RRGGBB) ou vazio. */
  color: z
    .string()
    .regex(/^(#[0-9a-fA-F]{6})?$/, 'cor inválida (use #RRGGBB)')
    .default(''),
  /** Modelo e esforço padrão de quem tem esta função, por tipo de agente (o terminal pode trocar). */
  agentDefaults: z.object({ claude: ModelEffortSchema.optional(), codex: ModelEffortSchema.optional() }).optional(),
  builtin: z.boolean().default(false)
})
export type Role = z.infer<typeof RoleSchema>

// ---------------------------------------------------------------- nós do canvas

const NodeBase = {
  id: IdSchema,
  position: PositionSchema,
  size: SizeSchema,
  /** Floor (ambiente isolado) ao qual o nó pertence; ausente = andar principal. */
  floorId: IdSchema.optional(),
  /** Partituras/agrupamentos podem marcar nós; reservado. */
  groupId: IdSchema.optional()
}

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'cor inválida (use #RRGGBB)')
export const HairStyleSchema = z.enum(['curto', 'longo', 'cacheado', 'coque', 'raspado'])
export type HairStyle = z.infer<typeof HairStyleSchema>

/** Aparência do personagem do terminal no escritório. */
/** Personagem próprio do escritório (folha de sprites em .maestrinho/personagens). */
export const CHARACTER_FILE_RE = /^[\w .()-]{1,120}\.(png|webp|gif)$/i

export const LookSchema = z.object({
  skin: HexColorSchema,
  hair: HexColorSchema,
  hairStyle: HairStyleSchema,
  /** A camiseta segue a cor do papel do terminal (padrão). */
  shirtFromRole: z.boolean().default(true),
  shirt: HexColorSchema,
  pants: HexColorSchema,
  shoes: HexColorSchema,
  glasses: z.boolean().default(false),
  headphones: z.boolean().default(false),
  beard: z.boolean().default(false),
  badge: z.boolean().default(false),
  cap: z.boolean().default(false),
  /** Personagem próprio (arquivo em .maestrinho/personagens): substitui o desenho acima no escritório. */
  custom: z.string().regex(CHARACTER_FILE_RE).optional(),
  /** Monitores na mesa do escritório (1 a 6); ausente = 1. */
  monitors: z.number().int().min(1).max(6).optional()
})
export type Look = z.infer<typeof LookSchema>

export const TerminalNodeSchema = z.object({
  ...NodeBase,
  kind: z.literal('terminal'),
  /** Aparência no escritório; ausente = visual padrão derivado do id. */
  look: LookSchema.optional(),
  name: TerminalNameSchema,
  presetId: IdSchema,
  roleId: IdSchema.optional(),
  manager: z.boolean().optional(),
  /** Diretório de trabalho; relativo ao workspace ou absoluto. Vazio = raiz do workspace (ou do floor). */
  cwd: z.string().max(4096).default(''),
  /** Terminal recrutado por um gerente (id do gerente). */
  recruitedBy: IdSchema.optional(),
  /** Inicia o processo automaticamente ao abrir o workspace. */
  autoStart: z.boolean().default(true),
  /**
   * Hibernando: o processo foi encerrado para poupar memória, com a conversa preservada. Acorda (retomando
   * a sessão) quando você abre o terminal ou recebe uma mensagem.
   */
  hibernated: z.boolean().optional(),
  /** Modelo e esforço deste terminal (vazio = padrão da função ou do agente). Valem ao (re)iniciar. */
  model: ModelEffortSchema.shape.model,
  effort: ModelEffortSchema.shape.effort,
  /** Sessão do agente (UUID) para retomar a conversa ao reabrir o app. */
  sessionId: z.string().uuid().optional(),
  /** Destino SSH (ex.: usuario@servidor) para presets com {host} nos argumentos. */
  // Nunca pode começar com "-": o ssh leria como opção (ex.: -oProxyCommand=... executaria comandos).
  remoteHost: z
    .string()
    .max(255)
    .regex(/^(?:[A-Za-z0-9_[][A-Za-z0-9_.@:\-\]]*)?$/, 'destino SSH inválido (use usuario@servidor)')
    .optional()
})
export type TerminalNodeData = z.infer<typeof TerminalNodeSchema>

/** Nome de arquivo de nota: relativo a .maestrinho/notes, sem subir diretórios. */
export const NoteFileSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^(?!.*\.\.)[\p{L}\p{N} ._-]+(\/[\p{L}\p{N} ._-]+)*\.md$/u, 'nome de nota inválido (use .md, sem "..")')

export const NoteNodeSchema = z.object({ ...NodeBase, kind: z.literal('note'), file: NoteFileSchema })
export type NoteNodeData = z.infer<typeof NoteNodeSchema>

export const PortalNodeSchema = z.object({
  ...NodeBase,
  kind: z.literal('portal'),
  url: z.string().max(4096),
  title: z.string().max(200).optional(),
  /** Terminais conectados podem ler, tirar print e navegar (orq portal). Desligado por padrão. */
  agentAccess: z.boolean().optional()
})
export type PortalNodeData = z.infer<typeof PortalNodeSchema>

export const ShapeKindSchema = z.enum(['rect', 'ellipse', 'text', 'arrow', 'drawing'])
export const ShapeNodeSchema = z.object({
  ...NodeBase,
  kind: z.literal('shape'),
  shape: ShapeKindSchema,
  text: z.string().max(10_000).default(''),
  color: z.string().max(32).default(''),
  /** Para desenho livre/setas: pontos relativos ao nó (0..w, 0..h). */
  points: z
    .array(z.tuple([z.number(), z.number()]))
    .max(5000)
    .optional(),
  strokeWidth: z.number().min(0.5).max(40).optional()
})
export type ShapeNodeData = z.infer<typeof ShapeNodeSchema>

export const CanvasNodeSchema = z.discriminatedUnion('kind', [TerminalNodeSchema, NoteNodeSchema, PortalNodeSchema, ShapeNodeSchema])
export type CanvasNode = z.infer<typeof CanvasNodeSchema>
export type CanvasNodeKind = CanvasNode['kind']

/** Conexão entre nós: bidirecional para fins de permissão. */
export const EdgeSchema = z.object({
  id: IdSchema,
  source: IdSchema,
  target: IdSchema,
  sourceHandle: z.string().max(32).nullish(),
  targetHandle: z.string().max(32).nullish()
})
export type CanvasEdge = z.infer<typeof EdgeSchema>

export const ViewportSchema = z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().min(0.05).max(8) })
export type Viewport = z.infer<typeof ViewportSchema>

export const FloorSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(60),
  branch: z.string().min(1).max(200),
  baseBranch: z.string().max(200).default(''),
  /** Caminho absoluto do worktree. */
  worktreePath: z.string().min(1).max(4096),
  createdAt: z.string().max(40)
})
export type Floor = z.infer<typeof FloorSchema>

/** Cenário da visão Escritório. */
export const OfficeSceneIdSchema = z.enum(['escritorio', 'jardim', 'refeitorio', 'descanso', 'inferno'])
export type OfficeSceneId = z.infer<typeof OfficeSceneIdSchema>

export const OfficeReactionsSchema = z.enum(['sorteio', 'jornal', 'galinha', 'luva', 'mjolnir', 'faca', 'desligado'])
export type OfficeReactions = z.infer<typeof OfficeReactionsSchema>

/** Imagem de fundo enviada pelo usuário (fica em .maestrinho/cenarios do projeto). */
export const BACKGROUND_FILE_RE = /^[\w .()-]{1,120}\.(png|jpe?g|webp|gif)$/i
export const BACKGROUND_PREFIX = 'arquivo:'

/** Cenário escolhido para um workspace: um dos prontos ou "arquivo:<nome>" (imagem do usuário). */
export const OfficeSceneRefSchema = z.union([
  OfficeSceneIdSchema,
  z
    .string()
    .max(140)
    .refine((v) => v.startsWith(BACKGROUND_PREFIX) && BACKGROUND_FILE_RE.test(v.slice(BACKGROUND_PREFIX.length)), 'imagem de fundo inválida')
])
export type OfficeSceneRef = z.infer<typeof OfficeSceneRefSchema>

export const WorkspaceDocSchema = z.object({
  version: z.literal(1),
  id: IdSchema,
  name: z.string().min(1).max(120),
  nodes: z.array(CanvasNodeSchema).max(2000).default([]),
  edges: z.array(EdgeSchema).max(10_000).default([]),
  viewport: ViewportSchema.default({ x: 0, y: 0, zoom: 1 }),
  floors: z.array(FloorSchema).max(50).default([]),
  /** Floor exibido no canvas; ausente = andar principal. */
  activeFloorId: IdSchema.optional(),
  /** Cenário da visão Escritório deste workspace; ausente = o padrão das configurações. */
  officeScene: OfficeSceneRefSchema.optional()
})
export type WorkspaceDoc = z.infer<typeof WorkspaceDocSchema>

// ---------------------------------------------------------------- routines

/**
 * Quando a rotina dispara. Sem gatilho (rotinas antigas), vale o intervalo. Os gatilhos por evento
 * montam fluxos: "quando o revisor reprovar para o construtor, mande ao construtor...".
 */
export const RoutineTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval') }),
  /** Um agente terminou uma vez de trabalho (não vale "parou pedindo aprovação"). */
  z.object({ kind: z.literal('agentDone'), sourceId: IdSchema }),
  /** Um agente mandou mensagem a outro pelo orq (de/para opcionais), com o tom detectado. */
  z.object({
    kind: z.literal('message'),
    fromId: IdSchema.optional(),
    toId: IdSchema.optional(),
    mood: z.enum(['any', 'complaint', 'praise']).default('any')
  }),
  /** Um cartão do quadro entrou na coluna (id da coluna). */
  z.object({ kind: z.literal('boardColumn'), column: IdSchema }),
  /** Arquivos do workspace que batem com o padrão mudaram (glob, vários separados por vírgula). */
  z.object({ kind: z.literal('fileChange'), pattern: z.string().trim().min(1).max(300) })
])
export type RoutineTrigger = z.infer<typeof RoutineTriggerSchema>

export const RoutineSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  /** Terminal alvo (id do nó). */
  targetId: IdSchema,
  /** Texto com um ou mais prompts; linhas contendo apenas "&&" separam passos encadeados. */
  script: z.string().min(1).max(50_000),
  intervalMinutes: z
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 60),
  enabled: z.boolean().default(true),
  /** Não dispara se o agente estiver trabalhando no momento (registra "pulada"). */
  skipIfBusy: z.boolean().default(true),
  /** Notificação do sistema a cada disparo. */
  notifyOnRun: z.boolean().default(false),
  trigger: RoutineTriggerSchema.default({ kind: 'interval' }),
  /** Teto de disparos por evento numa hora (evita laços entre agentes consumindo a assinatura). */
  maxPerHour: z.number().int().min(1).max(120).default(12),
  lastRunAt: z.string().max(40).optional(),
  createdAt: z.string().max(40)
})
export type Routine = z.infer<typeof RoutineSchema>

export const RoutineOutcomeSchema = z.enum(['completed', 'terminalNotRunning', 'skippedBusy', 'skippedLimit', 'skippedCap', 'failed', 'cancelled'])
export type RoutineOutcome = z.infer<typeof RoutineOutcomeSchema>

export const RoutineRunSchema = z.object({
  routineId: IdSchema,
  name: z.string().max(80),
  at: z.string().max(40),
  outcome: RoutineOutcomeSchema,
  /** Passos enviados / total. */
  stepsSent: z.number().int().min(0),
  stepsTotal: z.number().int().min(0),
  detail: z.string().max(300).optional()
})
export type RoutineRun = z.infer<typeof RoutineRunSchema>

export const RoutinesFileSchema = z.object({
  version: z.literal(1),
  routines: z.array(RoutineSchema).max(500).default([]),
  history: z.array(RoutineRunSchema).max(200).default([])
})
export type RoutinesFile = z.infer<typeof RoutinesFileSchema>

// ---------------------------------------------------------------- partituras

export const PartituraSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(120),
  createdAt: z.string().max(40),
  /** Nós com posições relativas ao canto superior esquerdo do grupo. */
  nodes: z.array(CanvasNodeSchema).max(500),
  edges: z.array(EdgeSchema).max(5000),
  /** Cópia dos papéis usados, para importar em outra máquina. */
  roles: z.array(RoleSchema).max(200).default([]),
  /** Conteúdo das notas incluídas (arquivo -> markdown). */
  notes: z.record(z.string(), z.string().max(2_000_000)).default({})
})
export type Partitura = z.infer<typeof PartituraSchema>

// ---------------------------------------------------------------- configuração global

export const ThemeSchema = z.enum(['dark', 'light', 'system'])
export type ThemePref = z.infer<typeof ThemeSchema>

export const SettingsSchema = z.object({
  theme: ThemeSchema.default('dark'),
  terminalFontFamily: z.string().max(300).default('"Cascadia Mono", "Cascadia Code", Consolas, "DejaVu Sans Mono", monospace'),
  terminalFontSize: z.number().min(8).max(32).default(13),
  /** Fonte do texto do app (menus, painéis, notas, chat…); vazio = a padrão (IBM Plex Sans). */
  uiFontFamily: z.string().max(300).default(''),
  /** Tamanho base (px) do texto do app; toda a interface escala na mesma proporção (13 = padrão). */
  uiFontSize: z.number().min(10).max(20).default(13),
  scrollback: z.number().int().min(500).max(100_000).default(10_000),
  notifyOnIdle: z.boolean().default(true),
  notifyOnlyWhenUnfocused: z.boolean().default(true),
  /** Como avisar: o próprio agente no canto da tela, a notificação do sistema ou os dois. */
  notifyStyle: z.enum(['personagem', 'sistema', 'ambos']).default('personagem'),
  /** Assistente de resumo opcional (endpoint compatível com OpenAI, ex.: Ollama/LM Studio). */
  summaryEnabled: z.boolean().default(false),
  summaryEndpoint: z.string().max(500).default('http://127.0.0.1:11434/v1'),
  summaryModel: z.string().max(200).default(''),
  summaryApiKey: z.string().max(500).default(''),
  recentWorkspaces: z.array(z.string().max(4096)).max(20).default([]),
  lastWorkspace: z.string().max(4096).optional(),
  /** Mostrar grade e minimapa. */
  showGrid: z.boolean().default(true),
  showMinimap: z.boolean().default(true),
  /** Retomar a conversa dos agentes (quando o preset suporta) ao reabrir o app ou reiniciar. */
  resumeSessions: z.boolean().default(true),
  /** Estado exato dos agentes (hooks do Claude Code, notificações do Codex) em vez do silêncio da tela. */
  exactAgentState: z.boolean().default(true),
  /** Hibernar agentes parados há este tempo (minutos); 0 = nunca. Só agentes com conversa retomável. */
  hibernateAfterMin: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(0),
  /** Checkpoint (git, numa referência própria) da pasta do agente antes de cada turno; dá para voltar. */
  checkpoints: z.boolean().default(true),
  /** Avisar quando uma janela da assinatura (5 h, semana) passar deste percentual; 0 = nunca. */
  usageAlertPercent: z.number().int().min(0).max(100).default(80),
  /** Pausar rotinas e gatilhos quando uma janela passar deste percentual, até ela reiniciar; 0 = nunca. */
  usagePausePercent: z.number().int().min(0).max(100).default(0),
  /** Cenário da visão Escritório (escritório, campo florido, refeitório, sala de descanso, inferno). */
  officeScene: OfficeSceneIdSchema.default('escritorio'),
  /**
   * Cena no escritório quando um agente reprova (bronca) ou aprova (comemoração) o trabalho de outro:
   * o objeto da bronca, sorteado a cada vez (só os de desenho animado), ou desligado. A facadinha, com sangue, só se escolhida.
   */
  officeReactions: OfficeReactionsSchema.default('sorteio')
  // hubUrl, hubToken, updateAutoCheck e updateSkipped (até a 0.2.x) sumiram: configs antigas ainda abrem,
  // porque o zod descarta os campos que não conhece.
})
export type Settings = z.infer<typeof SettingsSchema>

export const AppConfigSchema = z.object({
  version: z.literal(1),
  presets: z.array(AgentPresetSchema).max(100).default([]),
  roles: z.array(RoleSchema).max(500).default([]),
  settings: SettingsSchema.default(SettingsSchema.parse({}))
})
export type AppConfig = z.infer<typeof AppConfigSchema>
