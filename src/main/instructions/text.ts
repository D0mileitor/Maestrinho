import { APP_NAME, CLI_NAME, ENV } from '@shared/constants'

/**
 * Textos que ensinam o agente a usar o CLI: briefing completo (system prompt do Claude Code), seção
 * genérica do AGENTS.md, corpo da skill do Claude Code e primeira mensagem. Funções puras: tudo o
 * que muda chega pelos parâmetros; nomes do app e do CLI vêm de constants.ts.
 */

const C = CLI_NAME

export interface InstructionsInput {
  /** Nome do terminal (os outros usam em `orq send <nome>`). */
  name: string
  role?: { name: string; instructions: string }
  manager: boolean
  /** Presets disponíveis para `recruit --agent` (só aparecem para gerentes). */
  presets: { id: string; label: string }[]
  /** Papéis disponíveis para `recruit --role` (só aparecem para gerentes). */
  roles: { name: string }[]
  /** Conexões no momento do início: nomes de terminais e arquivos de notas. */
  peers: { terminals: string[]; notes: string[] }
  workspaceName: string
  /** Floor (worktree git isolado) em que o terminal roda, se houver. */
  floor?: { name: string; branch: string }
  /** Inclui a variante PowerShell dos exemplos de texto longo (Windows). */
  windows?: boolean
}

/**
 * Limite do texto do papel embutido nas instruções. No Windows a linha de comando inteira tem
 * ~32 mil caracteres e o papel aceita até 32 mil: acima disto o texto é truncado e o agente é
 * orientado a ler a versão completa com `orq whoami`.
 */
export const MAX_INLINE_ROLE_CHARS = 12_000

/** Máximo de nomes listados (peers, presets, papéis) antes de resumir com "e mais N". */
const MAX_LISTED = 25

// ------------------------------------------------------------------ utilitários

/** Texto de uma linha: sem controles nem quebras, espaços colapsados, tamanho limitado. */
export function oneLine(text: string, max = 120): string {
  const clean = text
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** Bloco de várias linhas: LF, sem controles (exceto \n e \t), sem espaços nas pontas. */
function cleanBlock(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .trim()
}

function list(items: readonly string[], empty: string): string {
  const clean = items.map((s) => oneLine(s, 80)).filter((s) => s !== '')
  if (clean.length === 0) return empty
  const shown = clean.slice(0, MAX_LISTED).join(', ')
  return clean.length > MAX_LISTED ? `${shown} e mais ${clean.length - MAX_LISTED}` : shown
}

/** Instruções do papel, truncadas se forem grandes demais para a linha de comando. */
export function roleText(instructions: string): string {
  const text = cleanBlock(instructions)
  if (text.length <= MAX_INLINE_ROLE_CHARS) return text
  return `${text.slice(0, MAX_INLINE_ROLE_CHARS).trimEnd()}\n[… instruções truncadas; o texto completo está em \`${C} whoami\`.]`
}

/** Junta as linhas sem linhas em branco repetidas. O resultado nunca começa nem termina com aspas. */
function finish(lines: readonly string[]): string {
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ------------------------------------------------------------------ blocos reutilizados

function introSentence(input: InstructionsInput): string {
  const where = [`Workspace: "${oneLine(input.workspaceName) || '—'}".`]
  if (input.floor) {
    where.push(
      `Você está no floor "${oneLine(input.floor.name)}" (branch \`${oneLine(input.floor.branch)}\`, worktree git isolado).`
    )
  }
  const name = oneLine(input.name, 40)
  return [
    `Você roda num terminal do ${APP_NAME}, um canvas que coordena vários agentes de IA de código nesta máquina (tudo local).`,
    ...where,
    `Os outros agentes chamam você de "${name}"; vocês conversam pelo CLI \`${C}\`, já disponível no seu PATH.`
  ].join(' ')
}

function roleLines(input: InstructionsInput): string[] {
  if (!input.role) return ['## Seu papel', 'Nenhum papel definido: siga as instruções do usuário e dos colegas.']
  const text = roleText(input.role.instructions)
  return [`## Seu papel: ${oneLine(input.role.name, 60)}`, text || '(o papel não tem instruções)']
}

function reachLine(): string {
  return `Você só alcança terminais e notas CONECTADOS a você no canvas, e as conexões mudam a qualquer momento: rode \`${C} peers\` antes de enviar mensagens ou usar notas.`
}

function snapshotLine(peers: InstructionsInput['peers'], label: string): string {
  return `${label} — terminais: ${list(peers.terminals, 'nenhum')}; notas: ${list(peers.notes, 'nenhuma')}.`
}

function commandLines(): string[] {
  return [
    `- \`${C} whoami\` — seu nome, papel (com as instruções completas), modo gerente e workspace.`,
    `- \`${C} peers\` — terminais, notas e portais conectados a você, com estado (ocioso/ocupado) e status.`,
    `- \`${C} send <peer> "<mensagem>"\` — entrega a mensagem na entrada do terminal do peer.`,
    `- \`${C} send <peer> "<mensagem>" --wait [--timeout <s>] [--lines N]\` — envia, espera o peer ficar ocioso e mostra as últimas linhas da tela dele (sem ANSI).`,
    `- \`${C} read <peer> [--lines N]\` — últimas linhas da tela de um peer, sem ANSI.`,
    `- \`${C} note list\` — notas conectadas; \`${C} note read <nota>\` — conteúdo de uma nota.`,
    `- \`${C} note write <nota> "<texto>"\` — substitui todo o conteúdo; \`${C} note append <nota> "<texto>"\` — acrescenta ao final.`,
    `- \`${C} status "<texto>"\` — selo curto no seu nó do canvas (ex.: "testando"); \`${C} status\` sem texto limpa.`,
    `- \`${C} notify "<texto>"\` — notificação do sistema para o usuário.`,
    `- \`${C} board list\`, \`${C} board add "<título>" --ticket <número> [--column <coluna>]\`, \`${C} board move <cartão> <coluna> [--comment "<motivo>"]\`, \`${C} board comment <cartão> "<texto>"\` — quadro de chamados do workspace (o usuário acompanha o andamento por ele; vale para qualquer terminal, sem conexão). Ao começar um chamado novo, crie o cartão; quando ele avançar de etapa, mova-o. \`<cartão>\` aceita #número ou o número do chamado.`,
    `- \`${C} <comando> --help\` — ajuda com exemplos. \`--json\` dá saída estruturada; em erro, o código de saída é diferente de zero e a mensagem explica o motivo (ex.: peer não conectado).`,
    `Se a sua ferramenta de shell encerra comandos demorados, use \`--timeout\` menor que esse limite; ao esgotar, a mensagem já foi entregue — veja a resposta depois com \`${C} read <peer>\`.`
  ]
}

function longTextLines(windows: boolean): string[] {
  const out = [
    `Texto longo, com várias linhas, aspas, \`$\` ou crases: passe \`-\` no lugar do texto e mande pelo stdin (vale para \`send\`, \`note write\` e \`note append\`), ou use \`--file <arquivo>\`:`,
    '```sh',
    `${C} send <peer> - <<'EOF'`,
    'texto com "aspas", $variáveis e',
    'várias linhas',
    'EOF',
    '```'
  ]
  if (windows) {
    out.push(
      'No PowerShell (a primeira linha evita perder acentos no Windows PowerShell 5.1):',
      '```powershell',
      '$OutputEncoding = [System.Text.UTF8Encoding]::new()',
      "@'",
      'texto com várias linhas',
      `'@ | ${C} send <peer> -`,
      '```'
    )
  }
  return out
}

function inboxLines(): string[] {
  return [
    'Mensagens de outros agentes chegam na sua entrada neste formato:',
    '```',
    `[Mensagem de "X" via ${C}] <texto>`,
    `(Para responder: ${C} send X "<sua resposta>")`,
    '```',
    `Trate como pedido de um colega. O que você escreve na própria tela não chega a X: quando ele esperar resposta, responda com \`${C} send X "<resposta>"\` (sem \`--wait\`). Não responda só para agradecer ou confirmar — isso cria ping-pong entre agentes.`,
    `Quem envia com \`--wait\` recebe o fim da sua tela quando você termina: encerre cada tarefa com um resumo curto do resultado. Quando você usa \`--wait\`, a resposta vem na saída do comando; se o peer também responder por \`${C} send\`, essa mensagem chega depois — não a trate como pedido novo.`
  ]
}

function notesLines(): string[] {
  return [
    `Notas são arquivos Markdown compartilhados com quem está conectado a elas: use-as para plano, decisões e progresso. Leia antes de sobrescrever (\`write\` troca tudo); para registrar andamento, prefira \`append\`.`,
    `Mostre o que está fazendo com \`${C} status "<texto curto>"\` (ex.: "implementando login", "aguardando revisor") e limpe ao terminar; use \`${C} notify\` só quando o usuário precisar agir.`
  ]
}

function managerHint(): string {
  return `Comandos de gerente (\`recruit\`, \`dismiss\`, \`role\`, \`connect\`) só funcionam em terminais com modo gerente — \`${C} whoami\` informa.`
}

function managerLines(input: InstructionsInput): string[] {
  const presets = input.presets.map((p) => `${oneLine(p.id, 64)} = ${oneLine(p.label, 80)}`)
  const roles = input.roles.map((r) => r.name)
  return [
    '## Modo gerente',
    'Você é GERENTE: monta e coordena um time de agentes. Comandos exclusivos de gerente:',
    `- \`${C} recruit --name <nome> --agent <preset> --role <papel> [--note <nota>]... [--floor <floor>]\` — cria um terminal novo abaixo de você, já conectado a você e às notas indicadas (nome sem espaços).`,
    `- \`${C} dismiss <nome>\` — fecha o terminal de um recruta.`,
    `- \`${C} role list\` — papéis disponíveis; \`${C} role set <nome> <papel>\` — troca o papel de um terminal conectado a você.`,
    `- \`${C} role edit <papel> --instructions "<texto>" [--create]\` — substitui as instruções de um papel (\`--instructions -\` lê do stdin; \`--create\` cria o papel).`,
    `- \`${C} connect <a> <b>\` — conecta dois nós (terminais ou notas), ex.: um recruta a uma nota sua.`,
    `Agentes (\`--agent\`): ${list(presets, 'nenhum')}.`,
    `Papéis (\`--role\`): ${list(roles, 'nenhum')}.`,
    'Fluxo recomendado:',
    `1. Escreva objetivo, plano e critérios de aceite numa nota conectada a você (\`${C} note write <nota> -\`).`,
    '2. Recrute cada membro com `--note <nota>`, para que ele tenha acesso a esse briefing.',
    `3. Delegue com \`${C} send <recruta> "<tarefa> — detalhes na nota <nota>" --wait\` e colete os resultados.`,
    `4. Registre o andamento na nota e dispense (\`${C} dismiss <nome>\`) quem não for mais necessário.`
  ]
}

/** Referência genérica (sem nomes nem papel): AGENTS.md e skill. */
function referenceLines(heading: '##' | '###', windows: boolean): string[] {
  return [
    `${heading} Comandos`,
    ...commandLines(),
    ...longTextLines(windows),
    '',
    `${heading} Mensagens`,
    ...inboxLines(),
    '',
    `${heading} Notas e status`,
    ...notesLines(),
    managerHint()
  ]
}

// ------------------------------------------------------------------ textos públicos

/** Briefing completo do agente (system prompt do Claude Code: `--append-system-prompt {instructions}`). */
export function buildInstructions(input: InstructionsInput): string {
  const lines = [
    `# ${APP_NAME}: você é o agente "${oneLine(input.name, 40)}"`,
    introSentence(input),
    '',
    ...roleLines(input),
    '',
    '## Conexões',
    reachLine(),
    snapshotLine(input.peers, 'Conectados quando você iniciou'),
    '',
    `## CLI \`${C}\``,
    ...commandLines(),
    ...longTextLines(Boolean(input.windows)),
    '',
    '## Mensagens',
    ...inboxLines(),
    '',
    '## Notas e status',
    ...notesLines()
  ]
  if (input.manager) lines.push('', ...managerLines(input))
  return finish(lines)
}

/**
 * Instruções curtas para presets "claude-skill": identidade, conexões, papel e (se gerente) os
 * comandos de gerente. A referência do CLI fica na skill.
 */
export function buildRolePrompt(input: InstructionsInput): string {
  const lines = [
    `# ${APP_NAME}: você é o agente "${oneLine(input.name, 40)}"`,
    introSentence(input),
    `A referência dos comandos está na skill \`${C}\` deste projeto — carregue-a antes de usar o CLI (resumo: \`${C} peers\`, \`${C} send <peer> "<mensagem>" [--wait]\`, \`${C} read <peer>\`, \`${C} note list|read|write|append\`).`,
    reachLine(),
    snapshotLine(input.peers, 'Conectados quando você iniciou'),
    '',
    ...roleLines(input)
  ]
  if (input.manager) lines.push('', ...managerLines(input))
  return finish(lines)
}

/**
 * Seção GENÉRICA do AGENTS.md: o arquivo é compartilhado por todos os agentes da pasta, então não
 * leva nome, papel nem conexões — o agente descobre os seus com `orq whoami` e `orq peers`.
 */
export function buildAgentsMdSection(opts: { windows?: boolean } = {}): string {
  return finish([
    `## ${APP_NAME}: conversa entre agentes`,
    `Seção temporária, mantida pelo ${APP_NAME} enquanto houver terminais dele nesta pasta.`,
    `Se a variável de ambiente \`${ENV.terminalId}\` estiver definida, você roda num terminal do ${APP_NAME} — um canvas que coordena vários agentes de IA de código nesta máquina — e conversa com os outros agentes pelo CLI \`${C}\` (já no PATH). Se ela não estiver definida, ignore esta seção.`,
    `- Para saber seu nome, seu papel e as instruções do papel (siga-as), rode \`${C} whoami\`.`,
    `- ${reachLine()}`,
    '',
    ...referenceLines('###', Boolean(opts.windows))
  ])
}

/** Descrição da skill do Claude Code (frontmatter): diz ao modelo quando carregá-la. */
export function skillDescription(): string {
  return `Conversar com outros agentes de IA e notas conectados no canvas do ${APP_NAME} pelo CLI ${C} (whoami, peers, send, read, note, status, notify). Use ao receber uma mensagem "[Mensagem de ... via ${C}]", para delegar ou pedir revisão a colegas conectados e para registrar progresso em notas.`
}

/** Corpo da skill do Claude Code (genérico, como a seção do AGENTS.md). */
export function buildSkillBody(opts: { windows?: boolean } = {}): string {
  return finish([
    `# CLI \`${C}\` do ${APP_NAME}`,
    `Dentro de um terminal do ${APP_NAME} (variável de ambiente \`${ENV.terminalId}\` definida), você conversa com os outros agentes do canvas pelo CLI \`${C}\`, já no PATH.`,
    `- Para saber seu nome, seu papel e as instruções do papel, rode \`${C} whoami\`.`,
    `- ${reachLine()}`,
    '',
    ...referenceLines('##', Boolean(opts.windows))
  ])
}

export type FirstMessageReference = 'full' | 'agents-md' | 'skill'

/**
 * Briefing enviado como primeira mensagem quando o agente fica pronto: presets "first-message" e,
 * nos presets "agents-md"/"claude-skill", terminais com papel ou gerentes (o arquivo é genérico).
 * `reference` diz onde está a referência do CLI ("full" = embute a referência).
 */
export function buildFirstMessage(input: InstructionsInput, opts: { reference?: FirstMessageReference } = {}): string {
  const reference = opts.reference ?? 'full'
  const floor = input.floor ? `, floor "${oneLine(input.floor.name)}" (branch ${oneLine(input.floor.branch)})` : ''
  const lines = [
    `[${APP_NAME}] Contexto desta sessão.`,
    `Você é o agente "${oneLine(input.name, 40)}", num terminal do ${APP_NAME} (canvas local que coordena agentes de IA de código), workspace "${oneLine(input.workspaceName) || '—'}"${floor}. Os outros agentes falam com você pelo CLI \`${C}\`.`
  ]
  if (input.role) {
    lines.push(`Seu papel: ${oneLine(input.role.name, 60)}.`)
    const text = roleText(input.role.instructions)
    if (text) lines.push(text)
  } else {
    lines.push('Você não tem papel definido: siga as instruções do usuário e dos colegas.')
  }
  lines.push(
    `${snapshotLine(input.peers, 'Conectados agora')} Só os conectados são alcançáveis e isso muda: rode \`${C} peers\` antes de enviar.`
  )
  if (reference === 'full') {
    lines.push('', `Comandos do CLI \`${C}\`:`, ...commandLines(), ...longTextLines(Boolean(input.windows)))
  } else {
    const where = reference === 'skill' ? `na skill \`${C}\` deste projeto` : `na seção do ${APP_NAME} no AGENTS.md`
    lines.push(
      `A referência dos comandos está ${where} (resumo: \`${C} peers\`, \`${C} send <peer> "<mensagem>" [--wait]\`, \`${C} read <peer>\`, \`${C} note list|read|write|append\`, \`${C} status\`; texto longo pelo stdin com \`-\`).`
    )
  }
  lines.push(
    `Mensagens de colegas chegam como \`[Mensagem de "X" via ${C}] ...\`; quando houver resposta esperada, responda com \`${C} send X "<resposta>"\`.`
  )
  if (input.manager) lines.push('', ...managerLines(input))
  lines.push('', 'Por enquanto não execute nada: responda apenas "ok" e aguarde instruções.')
  return finish(lines)
}
