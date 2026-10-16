import { describe, expect, it } from 'vitest'
import { checkFlags, flagUsage, parseArgv } from './args'
import { CliError, EXIT } from './errors'

function usageOf(fn: () => void): CliError {
  try {
    fn()
  } catch (err) {
    if (err instanceof CliError) return err
    throw err
  }
  throw new Error('esperava um erro de uso')
}

describe('parseArgv', () => {
  it('aceita opções em qualquer posição', () => {
    const a = parseArgv(['--json', 'send', 'revisor', '--wait', 'olá', 'mundo', '--timeout', '30'])
    expect(a.positionals).toEqual(['send', 'revisor', 'olá', 'mundo'])
    expect(a.bool('json')).toBe(true)
    expect(a.bool('wait')).toBe(true)
    expect(a.str('timeout')).toBe('30')
    expect(a.unknown).toEqual([])
    expect(a.errors).toEqual([])
  })

  it('aceita --opcao=valor e --opcao valor', () => {
    const a = parseArgv(['read', 'x', '--lines=15', '--file', 'a b.md'])
    expect(a.str('lines')).toBe('15')
    expect(a.str('file')).toBe('a b.md')
    // "=" no valor é preservado
    expect(parseArgv(['--title=a=b']).str('title')).toBe('a=b')
    // valor vazio explícito
    expect(parseArgv(['--instructions=']).str('instructions')).toBe('')
  })

  it('acumula opções repetíveis (--note)', () => {
    const a = parseArgv(['recruit', '--note', 'spec.md', '--name', 'x', '--note=plano.md'])
    expect(a.list('note')).toEqual(['spec.md', 'plano.md'])
    expect(a.count('note')).toBe(2)
    expect(a.list('floor')).toEqual([])
  })

  it('"--" encerra as opções', () => {
    const a = parseArgv(['send', 'x', '--wait', '--', '--force', 'é', '-h', '--'])
    expect(a.positionals).toEqual(['send', 'x', '--force', 'é', '-h', '--'])
    expect(a.bool('wait')).toBe(true)
    expect(a.bool('help')).toBe(false)
  })

  it('"-" e números negativos são argumentos comuns', () => {
    expect(parseArgv(['send', 'x', '-']).positionals).toEqual(['send', 'x', '-'])
    expect(parseArgv(['send', 'x', '-5', '-1.5']).positionals).toEqual(['send', 'x', '-5', '-1.5'])
    // "-" como valor de opção (instruções pelo stdin)
    expect(parseArgv(['role', 'edit', 'r', '--instructions', '-']).str('instructions')).toBe('-')
  })

  it('-h é atalho de --help; outras opções curtas são desconhecidas', () => {
    expect(parseArgv(['send', '-h']).bool('help')).toBe(true)
    const a = parseArgv(['read', 'x', '-n', '10'])
    expect(a.unknown).toEqual(['-n'])
    expect(a.positionals).toEqual(['read', 'x', '10'])
  })

  it('reporta opção sem valor e valor que parece outra opção', () => {
    expect(parseArgv(['read', 'x', '--lines']).errors[0]).toContain('--lines precisa de um valor')
    const a = parseArgv(['send', 'x', 'oi', '--timeout', '--wait'])
    expect(a.errors[0]).toContain('--timeout precisa de um valor')
    expect(a.errors[0]).toContain('--timeout=<valor>')
    // a opção seguinte continua sendo interpretada
    expect(a.bool('wait')).toBe(true)
    // valor começando com "-" é possível com "="
    expect(parseArgv(['--title=--x']).str('title')).toBe('--x')
  })

  it('opções booleanas com =valor', () => {
    expect(parseArgv(['--wait=false']).bool('wait')).toBe(false)
    expect(parseArgv(['--wait=sim']).bool('wait')).toBe(true)
    expect(parseArgv(['--wait=1']).bool('wait')).toBe(true)
    expect(parseArgv(['--wait=talvez']).errors[0]).toContain('não aceita o valor "talvez"')
  })

  it('a última ocorrência vale para booleanas', () => {
    expect(parseArgv(['--wait', '--wait=false']).bool('wait')).toBe(false)
  })

  it('coleta opções desconhecidas sem engolir argumentos', () => {
    const a = parseArgv(['send', 'x', '--forca=1', 'texto', '--naoexiste'])
    expect(a.unknown).toEqual(['--forca', '--naoexiste'])
    expect(a.positionals).toEqual(['send', 'x', 'texto'])
  })
})

describe('checkFlags', () => {
  it('aceita opções permitidas e as globais', () => {
    const args = parseArgv(['send', 'x', 'y', '--wait', '--json'])
    expect(() => checkFlags(args, ['wait', 'timeout'], 'send')).not.toThrow()
  })

  it('opção desconhecida → uso incorreto, listando as válidas e sugerindo "--"', () => {
    const e = usageOf(() => checkFlags(parseArgv(['send', 'x', '--forca']), ['wait', 'timeout'], 'send'))
    expect(e.exitCode).toBe(EXIT.usage)
    expect(e.message).toBe('opção desconhecida "--forca" em "orq send".')
    expect(e.hint).toContain('--wait, --timeout <segundos>, --json')
    expect(e.hint).toContain('"--"')
  })

  it('opção que não vale para o comando', () => {
    const e = usageOf(() => checkFlags(parseArgv(['peers', '--wait']), [], 'peers'))
    expect(e.message).toBe('a opção --wait não vale para "orq peers".')
  })

  it('opção de texto repetida', () => {
    const e = usageOf(() => checkFlags(parseArgv(['recruit', '--name', 'a', '--name', 'b']), ['name'], 'recruit'))
    expect(e.message).toContain('--name foi informada mais de uma vez')
  })

  it('erro de sintaxe vem primeiro', () => {
    const e = usageOf(() => checkFlags(parseArgv(['read', 'x', '--lines']), ['lines'], 'read'))
    expect(e.message).toContain('--lines precisa de um valor')
  })

  it('flagUsage mostra o marcador do valor', () => {
    expect(flagUsage('timeout')).toBe('--timeout <segundos>')
    expect(flagUsage('wait')).toBe('--wait')
  })
})
