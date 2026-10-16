import { describe, expect, it } from 'vitest'
import { AGENTS_MD_BEGIN, AGENTS_MD_END, APP_NAME, CLI_NAME, ENV } from '@shared/constants'
import {
  MAX_INLINE_ROLE_CHARS,
  buildAgentsMdSection,
  buildFirstMessage,
  buildInstructions,
  buildRolePrompt,
  buildSkillBody,
  oneLine,
  skillDescription,
  type InstructionsInput
} from './text'

const C = CLI_NAME

function input(over: Partial<InstructionsInput> = {}): InstructionsInput {
  return {
    name: 'construtor',
    manager: false,
    presets: [
      { id: 'claude', label: 'Claude Code' },
      { id: 'codex', label: 'Codex' }
    ],
    roles: [{ name: 'Líder' }, { name: 'Revisor' }],
    peers: { terminals: ['revisor', 'testador'], notes: ['spec.md'] },
    workspaceName: 'meu-projeto',
    ...over
  }
}

const ROLE = { name: 'Construtor', instructions: 'Você implementa as tarefas recebidas.\nEscreva testes.' }

/** Comandos básicos que todo texto de referência precisa ensinar. */
const BASIC = [
  `${C} whoami`,
  `${C} peers`,
  `${C} send <peer> "<mensagem>"`,
  '--wait',
  '--timeout',
  `${C} read <peer>`,
  `${C} note list`,
  `${C} note read <nota>`,
  `${C} note write <nota>`,
  `${C} note append <nota>`,
  `${C} status`,
  `${C} notify`
]

const MANAGER = [
  `${C} recruit --name <nome> --agent <preset> --role <papel>`,
  '--note <nota>',
  `${C} dismiss <nome>`,
  `${C} role list`,
  `${C} role set <nome> <papel>`,
  `${C} role edit <papel> --instructions`,
  `${C} connect <a> <b>`
]

describe('buildInstructions', () => {
  it('ensina todos os comandos básicos, o formato das mensagens e o envio por stdin', () => {
    const text = buildInstructions(input({ role: ROLE }))
    for (const cmd of BASIC) expect(text).toContain(cmd)
    expect(text).toContain(`[Mensagem de "X" via ${C}] <texto>`)
    expect(text).toContain(`${C} send X "<resposta>"`)
    expect(text).toContain(`${C} send <peer> - <<'EOF'`)
    expect(text).toMatch(/^EOF$/m)
  })

  it('diz quem é o agente, o workspace, o app e a regra de conexões', () => {
    const text = buildInstructions(input())
    expect(text).toContain('"construtor"')
    expect(text).toContain('"meu-projeto"')
    expect(text).toContain(APP_NAME)
    expect(text).toContain('CONECTADOS')
    expect(text).toContain(`rode \`${C} peers\` antes`)
    expect(text).toContain('terminais: revisor, testador; notas: spec.md')
  })

  it('inclui o papel e suas instruções', () => {
    const text = buildInstructions(input({ role: ROLE }))
    expect(text).toContain('## Seu papel: Construtor')
    expect(text).toContain('Você implementa as tarefas recebidas.\nEscreva testes.')
  })

  it('sem papel e sem peers usa textos neutros', () => {
    const text = buildInstructions(input({ peers: { terminals: [], notes: [] } }))
    expect(text).toContain('Nenhum papel definido')
    expect(text).toContain('terminais: nenhum; notas: nenhuma')
  })

  it('seção de gerente só para gerentes, com presets e papéis disponíveis', () => {
    const regular = buildInstructions(input())
    expect(regular).not.toContain(`${C} recruit`)
    expect(regular).not.toContain('Modo gerente')

    const manager = buildInstructions(input({ manager: true }))
    for (const cmd of MANAGER) expect(manager).toContain(cmd)
    expect(manager).toContain('claude = Claude Code')
    expect(manager).toContain('codex = Codex')
    expect(manager).toContain('Líder, Revisor')
    expect(manager).toContain('Fluxo recomendado')
    expect(manager).toContain(`${C} dismiss`)
  })

  it('usa o nome do CLI das constantes em todos os exemplos', () => {
    const text = buildInstructions(input({ manager: true }))
    const commands = text.match(/`[a-z]+ (whoami|peers|send|read|note|status|notify|recruit|dismiss|role|connect)\b/g) ?? []
    expect(commands.length).toBeGreaterThan(10)
    for (const c of commands) expect(c.startsWith('`' + C + ' ')).toBe(true)
  })

  it('fica compacto (< 4000 caracteres sem o texto do papel; gerente < 6500)', () => {
    expect(buildInstructions(input()).length).toBeLessThan(4000)
    expect(buildInstructions(input({ windows: true })).length).toBeLessThan(4000)
    expect(buildInstructions(input({ manager: true, windows: true })).length).toBeLessThan(6500)
  })

  it('variante PowerShell só no Windows', () => {
    expect(buildInstructions(input())).not.toContain('PowerShell')
    const win = buildInstructions(input({ windows: true }))
    expect(win).toContain('[System.Text.UTF8Encoding]::new()')
    expect(win).toContain(`'@ | ${C} send <peer> -`)
  })

  it('trunca papéis enormes e aponta para orq whoami', () => {
    const huge = 'x'.repeat(MAX_INLINE_ROLE_CHARS + 5000)
    const text = buildInstructions(input({ role: { name: 'Grande', instructions: huge } }))
    expect(text.length).toBeLessThan(MAX_INLINE_ROLE_CHARS + 6000)
    expect(text).toContain(`texto completo está em \`${C} whoami\``)
  })

  it('remove caracteres de controle e quebras de campos de uma linha', () => {
    const text = buildInstructions(
      input({ workspaceName: 'proj\nX\x1b[31m', role: { name: 'Pa\npel', instructions: 'ok\x00\x07 fim\r\nlinha 2' } })
    )
    expect(text).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/)
    expect(text).toContain('"proj X [31m"')
    expect(text).toContain('## Seu papel: Pa pel')
    expect(text).toContain('ok fim\nlinha 2')
  })

  it('nunca começa nem termina com aspas (quoting de argumentos do node-pty no Windows)', () => {
    for (const t of [buildInstructions(input()), buildInstructions(input({ manager: true })), buildRolePrompt(input())]) {
      expect(t.startsWith('"')).toBe(false)
      expect(t.endsWith('"')).toBe(false)
    }
  })

  it('resume listas longas de peers', () => {
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`)
    const text = buildInstructions(input({ peers: { terminals: many, notes: [] } }))
    expect(text).toContain('e mais 15')
  })

  it('menciona o floor quando o terminal roda num worktree', () => {
    const text = buildInstructions(input({ floor: { name: 'experimento', branch: 'floor/experimento' } }))
    expect(text).toContain('floor "experimento"')
    expect(text).toContain('`floor/experimento`')
  })
})

describe('buildRolePrompt (claude-skill)', () => {
  it('traz identidade, papel e conexões, mas deixa a referência para a skill', () => {
    const text = buildRolePrompt(input({ role: ROLE }))
    expect(text).toContain('"construtor"')
    expect(text).toContain('## Seu papel: Construtor')
    expect(text).toContain(`skill \`${C}\``)
    expect(text).toContain('terminais: revisor, testador')
    expect(text).not.toContain('Modo gerente')
    expect(text.length).toBeLessThan(buildInstructions(input({ role: ROLE })).length)
  })

  it('gerente recebe os comandos de gerente', () => {
    const text = buildRolePrompt(input({ manager: true }))
    for (const cmd of MANAGER) expect(text).toContain(cmd)
  })
})

describe('buildAgentsMdSection', () => {
  it('é genérica: sem nome, papel, peers ou workspace', () => {
    const text = buildAgentsMdSection()
    expect(text).not.toContain('construtor')
    expect(text).not.toContain('meu-projeto')
    expect(text).not.toContain('revisor, testador')
  })

  it('orienta a checar a variável de ambiente e a rodar whoami e peers', () => {
    const text = buildAgentsMdSection()
    expect(text).toContain(ENV.terminalId)
    expect(text).toContain(`\`${C} whoami\``)
    expect(text).toContain(`\`${C} peers\``)
    expect(text).toContain('ignore esta seção')
    for (const cmd of BASIC) expect(text).toContain(cmd)
    expect(text).toContain(`[Mensagem de "X" via ${C}]`)
    expect(text).not.toContain(`${C} recruit`)
  })

  it('não contém os marcadores (só o gerenciador os escreve) e cabe num arquivo pequeno', () => {
    const text = buildAgentsMdSection({ windows: true })
    expect(text).not.toContain(AGENTS_MD_BEGIN)
    expect(text).not.toContain(AGENTS_MD_END)
    expect(text.length).toBeLessThan(5000)
  })
})

describe('skill do Claude Code', () => {
  it('descrição diz quando usar; corpo traz a referência genérica', () => {
    expect(skillDescription()).toContain(C)
    expect(skillDescription()).not.toMatch(/[\r\n]/)
    const body = buildSkillBody()
    for (const cmd of BASIC) expect(body).toContain(cmd)
    expect(body).toContain(ENV.terminalId)
    expect(body).not.toContain('construtor')
  })
})

describe('buildFirstMessage', () => {
  it('referência no AGENTS.md: curta, com papel, peers e resumo dos comandos', () => {
    const text = buildFirstMessage(input({ role: ROLE }), { reference: 'agents-md' })
    expect(text).toContain('"construtor"')
    expect(text).toContain('Seu papel: Construtor.')
    expect(text).toContain('Você implementa as tarefas recebidas.')
    expect(text).toContain('terminais: revisor, testador; notas: spec.md')
    expect(text).toContain('AGENTS.md')
    expect(text).toContain(`${C} send <peer> "<mensagem>" [--wait]`)
    expect(text).toContain('responda apenas "ok"')
    expect(text).not.toContain(`${C} recruit`)
    expect(text.length).toBeLessThan(buildInstructions(input({ role: ROLE })).length)
    expect(text.length - ROLE.instructions.length).toBeLessThan(1500)
  })

  it('referência completa quando não há outro lugar (first-message)', () => {
    const text = buildFirstMessage(input(), { reference: 'full' })
    for (const cmd of BASIC) expect(text).toContain(cmd)
    expect(text).toContain(`<<'EOF'`)
  })

  it('aponta para a skill quando a referência está nela', () => {
    expect(buildFirstMessage(input(), { reference: 'skill' })).toContain(`skill \`${C}\``)
  })

  it('gerente recebe a seção de gerente', () => {
    const text = buildFirstMessage(input({ manager: true }), { reference: 'agents-md' })
    for (const cmd of MANAGER) expect(text).toContain(cmd)
    expect(text).toContain('claude = Claude Code')
  })
})

describe('oneLine', () => {
  it('colapsa espaços, remove controles e limita o tamanho', () => {
    expect(oneLine('  a\n\tb\x1b  c ')).toBe('a b c')
    expect(oneLine('x'.repeat(200), 10)).toBe('xxxxxxxxx…')
  })
})
