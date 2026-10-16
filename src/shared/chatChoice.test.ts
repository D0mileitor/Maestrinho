import { describe, expect, it } from 'vitest'
import { choiceSteps, detectPendingChoice } from './chat'

// Telas no formato das capturas reais (Claude Code 2.1.296 e Codex 0.162, lidas linha a linha como no app).

describe('perguntas do terminal: casos que quebravam', () => {
  it('confiança na pasta: a pergunta continua na mesma linha depois do "?"', () => {
    const c = detectPendingChoice(
      [
        ' Accessing workspace:',
        '',
        ' C:\\projeto',
        '',
        ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open',
        ' source project, or work from your team). If not, take a moment to review what’s in this folder first.',
        '',
        ' Security guide',
        '',
        ' ❯ No, exit',
        '   Yes, I trust this folder',
        '',
        ' Enter to confirm · Esc to cancel'
      ].join('\n')
    )!
    expect(c.question).toBe('Quick safety check: Is this a project you created or one you trust?')
    expect(c.options.map((o) => o.label)).toEqual(['No, exit', 'Yes, I trust this folder'])
    expect(c.cursor).toBe(0)
  })

  it('confiança na pasta em tela estreita: a pergunta quebrada em duas linhas', () => {
    const c = detectPendingChoice(
      [
        ' Quick safety check: Is this a project you created or',
        ' one you trust? (Like your own code, a well-known open',
        ' source project, or work from your team).',
        '',
        ' ❯ No, exit',
        '   Yes, I trust this folder',
        '',
        ' Enter to confirm · Esc to cancel'
      ].join('\n')
    )!
    expect(c.question).toBe('Quick safety check: Is this a project you created or one you trust?')
  })

  it('saída do modo de plano com a pergunta quebrada e a opção de escrever o que mudar', () => {
    const c = detectPendingChoice(
      [
        ' Claude has written up a plan and is ready to execute. Would you like to',
        ' proceed?',
        '',
        ' ❯ 1. Yes, and use auto mode',
        '   2. Yes, manually approve edits',
        '   3. Tell Claude what to change',
        '      shift+tab to approve with this feedback',
        '',
        ' ctrl-g to edit in Notepad'
      ].join('\n')
    )!
    expect(c.question).toBe('Claude has written up a plan and is ready to execute. Would you like to proceed?')
    expect(c.options[2]).toMatchObject({ label: 'Tell Claude what to change', input: true })
  })

  it('AskUserQuestion com prévia lado a lado: o painel não entra no rótulo das opções', () => {
    const c = detectPendingChoice(
      [
        '──────────────────────────────────────────────────────────────────────────',
        ' ☐ Layout',
        '',
        'Qual layout usar na tela de busca?',
        '',
        '❯ 1. Lista simples                ┌──────────────────────────────────────┐',
        '  2. Grade de cartões             │ ┌──────┐                             │',
        '  3. Tabela com filtros           ├─── ✂ ─── 3 lines hidden ─────────────┤',
        '                                  └──────────────────────────────────────┘',
        '',
        '                                  Notes: press n to add notes',
        '',
        '──────────────────────────────────────────────────────────────────────────',
        '  Chat about this',
        '',
        'Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel'
      ].join('\n')
    )!
    expect(c.question).toBe('Qual layout usar na tela de busca?')
    expect(c.options.map((o) => o.label)).toEqual(['Lista simples', 'Grade de cartões', 'Tabela com filtros'])
    expect(c.options.every((o) => !o.detail)).toBe(true)
  })

  it('múltipla escolha: marcações, o botão Submit e o "Chat about this" depois do separador', () => {
    const screen = [
      '←  ☒ Formato  ☐ Validação  ✔ Submit  →',
      '',
      'Quais campos devem ser validados antes de salvar?',
      '',
      '❯ 1. [ ] CPF',
      '         Validar',
      '  2. [✔] Nome completo',
      '         Validar',
      '  3. [ ] Data de nascimento',
      '  4. [ ] Type something',
      '     Submit',
      '──────────────────────────────────────────────────────────────',
      '  5. Chat about this',
      '',
      'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'
    ].join('\n')
    const c = detectPendingChoice(screen)!
    expect(c.multi).toBe(true)
    expect(c.question).toBe('Quais campos devem ser validados antes de salvar?')
    expect(c.options.map((o) => [o.label, o.checked, o.submit])).toEqual([
      ['CPF', false, undefined],
      ['Nome completo', true, undefined],
      ['Data de nascimento', false, undefined],
      ['Type something', false, undefined],
      ['Submit', undefined, true],
      ['Chat about this', undefined, undefined]
    ])
    expect(c.options[3]!.input).toBe(true)
    // confirmar = descer do cursor (CPF) até o Submit e Enter
    expect(choiceSteps(c, 4)).toEqual(['\x1b[B', '\x1b[B', '\x1b[B', '\x1b[B', '\r'])
  })

  it('permissão de criar arquivo: as linhas numeradas da prévia do arquivo não viram opções', () => {
    const c = detectPendingChoice(
      [
        ' Create file',
        ' ╭────────────────────────────────────╮',
        ' │ nota.txt                           │',
        ' │                                    │',
        ' │  1 oi                              │',
        ' │  2 tchau                           │',
        ' ╰────────────────────────────────────╯',
        ' Do you want to create nota.txt?',
        ' ❯ 1. Yes',
        '   2. Yes, allow all edits during this session (shift+tab)',
        '   3. No, and tell Claude what to do differently (esc)'
      ].join('\n')
    )!
    expect(c.question).toBe('Do you want to create nota.txt?')
    expect(c.options.map((o) => o.label)).toEqual([
      'Yes',
      'Yes, allow all edits during this session (shift+tab)',
      'No, and tell Claude what to do differently (esc)'
    ])
  })

  it('aprovação do Codex: a pergunta é a do Codex (o "Reason" do modelo fica no contexto)', () => {
    const c = detectPendingChoice(
      [
        '  Would you like to run the following command?',
        '',
        '  Environment: local',
        '',
        '  Reason: Você permite executar `git init` fora do sandbox para criar o',
        '  repositório nesta pasta?',
        '',
        '  $ git init',
        '',
        '',
        '› 1. Yes, proceed (y)',
        "  2. Yes, and don't ask again for commands that start with `git init` (p)",
        '  3. No, and tell Codex what to do differently (esc)',
        '',
        '  Press enter to confirm or esc to cancel'
      ].join('\n')
    )!
    expect(c.question).toBe('Would you like to run the following command?')
    expect(c.options.map((o) => o.label)).toEqual([
      'Yes, proceed (y)',
      "Yes, and don't ask again for commands that start with `git init` (p)",
      'No, and tell Codex what to do differently (esc)'
    ])
  })

  it('aprovação do Codex em tela estreita: o rótulo quebrado volta a ser um só', () => {
    const c = detectPendingChoice(
      [
        '  Would you like to run the following command?',
        '',
        '› 1. Yes, proceed (y)',
        "  2. Yes, and don't ask again for commands that start",
        '     with `git init` (p)',
        '  3. No, and tell Codex what to do differently (esc)',
        '',
        '  Press enter to confirm or esc to cancel'
      ].join('\n')
    )!
    expect(c.options[1]).toEqual({ number: '2', label: "Yes, and don't ask again for commands that start with `git init` (p)" })
  })

  it('menu do Codex em colunas e rolado (o "1." saiu da tela): rótulo, explicação e título', () => {
    const c = detectPendingChoice(
      [
        '  Update Model Permissions',
        '',
        '↑',
        '  2. Approve for me       Only ask for actions detected',
        '                          as potentially unsafe',
        '  3. Full Access          Use with caution: Codex can',
        '                          edit files outside this',
        '› 4. Read Only (current)  Read workspace files, with',
        '                          approval required for edits',
        '',
        '  enter select · esc back'
      ].join('\n')
    )!
    expect(c.question).toBe('Update Model Permissions')
    expect(c.options.map((o) => o.label)).toEqual(['Approve for me', 'Full Access', 'Read Only (current)'])
    expect(c.options[0]!.detail).toBe('Only ask for actions detected as potentially unsafe')
    expect(c.cursor).toBe(2)
  })
})
