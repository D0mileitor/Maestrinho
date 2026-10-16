import { describe, expect, it } from 'vitest'
import { newId, slugifyName, uniqueName } from './ids'
import { IdSchema, TerminalNameSchema } from './schemas'

describe('newId', () => {
  it('gera 10 caracteres base36 (minúsculos)', () => {
    for (let i = 0; i < 200; i++) expect(newId()).toMatch(/^[0-9a-z]{10}$/)
  })

  it('com prefixo usa o formato "<prefixo>-<10 caracteres>"', () => {
    expect(newId('t')).toMatch(/^t-[0-9a-z]{10}$/)
    expect(newId('ws')).toMatch(/^ws-[0-9a-z]{10}$/)
  })

  it('prefixo vazio equivale a sem prefixo', () => {
    expect(newId('')).toMatch(/^[0-9a-z]{10}$/)
  })

  it('é válido como id do schema', () => {
    for (const prefix of ['', 't', 'n', 'ws', 's', 'e']) expect(IdSchema.safeParse(newId(prefix)).success).toBe(true)
  })

  it('não repete em milhares de chamadas', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId('x')))
    expect(ids.size).toBe(5000)
  })

  it('usa todo o alfabeto base36', () => {
    const chars = new Set(Array.from({ length: 2000 }, () => newId()).join(''))
    expect(chars.size).toBe(36)
  })
})

describe('uniqueName', () => {
  it('devolve a base quando está livre', () => {
    expect(uniqueName('revisor', ['construtor'])).toBe('revisor')
  })

  it('colisão sem diferenciar maiúsculas gera sufixo -2, -3...', () => {
    expect(uniqueName('revisor', ['Revisor'])).toBe('revisor-2')
    expect(uniqueName('revisor', ['revisor', 'REVISOR-2', 'Revisor-3'])).toBe('revisor-4')
  })

  it('preserva a caixa da base no resultado', () => {
    expect(uniqueName('Revisor', ['outro'])).toBe('Revisor')
    expect(uniqueName('Revisor', ['revisor'])).toBe('Revisor-2')
  })

  it('reaproveita o primeiro sufixo livre', () => {
    expect(uniqueName('dev', ['dev', 'dev-3'])).toBe('dev-2')
  })

  it('normaliza a base (espaços viram "-", símbolos saem)', () => {
    expect(uniqueName('Meu Agente!', [])).toBe('Meu-Agente')
    expect(uniqueName('Meu Agente', ['meu-agente'])).toBe('Meu-Agente-2')
  })

  it('base vazia ou só com símbolos usa "terminal"', () => {
    expect(uniqueName('', [])).toBe('terminal')
    expect(uniqueName('@@@', ['terminal'])).toBe('terminal-2')
  })

  it('aceita qualquer iterável (Set, gerador)', () => {
    expect(uniqueName('a', new Set(['a', 'a-2']))).toBe('a-3')
    function* taken(): Generator<string> {
      yield 'B'
    }
    expect(uniqueName('b', taken())).toBe('b-2')
  })

  it('o resultado é sempre um nome de terminal válido para bases comuns', () => {
    const taken = ['revisor', 'Construtor', 'terminal']
    for (const base of ['revisor', 'Construtor', '', 'Líder do Time', 'x.y_z', '  -- ']) {
      expect(TerminalNameSchema.safeParse(uniqueName(base, taken)).success).toBe(true)
    }
  })

  // Regressão: o sufixo "-N" era anexado sem encurtar a base e o nome passava de 40 caracteres (ex.:
  // importar duas vezes uma partitura com nome longo gravava um nó inválido no workspace.json).
  it('com sufixo, o nome continua respeitando o limite de 40 caracteres', () => {
    const base = 'a'.repeat(40)
    const name = uniqueName(base, [base])
    expect(name).toBe(`${'a'.repeat(38)}-2`)
    expect(TerminalNameSchema.safeParse(name).success).toBe(true)
    // Nome com sufixo -n ocupando exatamente 40 caracteres.
    const suffixed = (n: number): string => `${'a'.repeat(40 - String(n).length - 1)}-${n}`
    const many = uniqueName(base, [base, ...Array.from({ length: 20 }, (_, i) => suffixed(i + 2))])
    expect(many).toBe(suffixed(22))
    expect(many).toHaveLength(40)
  })

  it('ao encurtar para o sufixo, não deixa ".", "_" ou "-" grudado antes dele', () => {
    expect(uniqueName('agente-', ['agente-'])).toBe('agente-2')
    expect(uniqueName(`${'b'.repeat(37)}._x`, [`${'b'.repeat(37)}._x`])).toBe(`${'b'.repeat(37)}-2`)
  })

  it('esgotados os sufixos numéricos, usa um sufixo aleatório curto (ainda válido)', () => {
    const taken = ['x', ...Array.from({ length: 9998 }, (_, i) => `x-${i + 2}`)]
    const name = uniqueName('x', taken)
    expect(name).toMatch(/^x-[0-9a-z]{8}$/)
    expect(TerminalNameSchema.safeParse(name).success).toBe(true)
  })
})

describe('slugifyName', () => {
  it('troca sequências de espaços por "-" e apara as pontas', () => {
    expect(slugifyName('Meu Agente')).toBe('Meu-Agente')
    expect(slugifyName('  revisor  ')).toBe('revisor')
    expect(slugifyName('a   b\tc')).toBe('a-b-c')
  })

  it('remove caracteres fora de letras, números, ".", "_" e "-"', () => {
    expect(slugifyName('revisor@#!$%')).toBe('revisor')
    expect(slugifyName('agente 🤖')).toBe('agente-')
    expect(slugifyName('v1.2_final-ok')).toBe('v1.2_final-ok')
  })

  it('remove ".", "_" e "-" do início (o nome precisa começar com letra ou número)', () => {
    expect(slugifyName('--.revisor')).toBe('revisor')
    expect(slugifyName('_x_')).toBe('x_')
    expect(slugifyName('...')).toBe('')
  })

  it('mantém letras acentuadas e de outros alfabetos, normalizando para NFC', () => {
    expect(slugifyName('José Ção')).toBe('José-Ção')
    expect(slugifyName('Jose\u0301')).toBe('Jos\u00e9')
    expect(slugifyName('日本語 テスト')).toBe('日本語-テスト')
  })

  it('limita a 40 caracteres', () => {
    expect(slugifyName('a'.repeat(50))).toHaveLength(40)
  })

  it('resultado não vazio sempre é um nome de terminal válido', () => {
    const inputs = [
      'Meu Agente',
      '--revisor--',
      ' . _ - x',
      'Ação!',
      'ü'.repeat(60),
      'a b c d e f g h i j k l m n o p q r s t u v w x y z',
      '1º lugar',
      'tab\there',
      'C:\\Users\\dev',
      'nome/com/barras'
    ]
    for (const input of inputs) {
      const slug = slugifyName(input)
      expect(slug).not.toBe('')
      expect(TerminalNameSchema.safeParse(slug).success, `entrada: ${JSON.stringify(input)} -> ${slug}`).toBe(true)
    }
  })
})
