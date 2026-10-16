import { describe, expect, it } from 'vitest'
import { ApiErrorCodeSchema, type ApiErrorCode } from '@shared/api'
import { ApiCallError, CliError, EXIT, exitCodeFor, hintFor, oneLine, toCliError } from './errors'

describe('códigos de saída', () => {
  it('mapeia todos os códigos de erro da API', () => {
    const expected: Record<ApiErrorCode, number> = {
      bad_request: 2,
      unauthorized: 3,
      forbidden: 3,
      not_found: 4,
      timeout: 5,
      unavailable: 6,
      conflict: 7,
      precondition: 7,
      rate_limited: 7,
      too_large: 7,
      internal: 1
    }
    for (const code of ApiErrorCodeSchema.options) expect(exitCodeFor(code), code).toBe(expected[code])
  })

  it('mapeia os erros locais', () => {
    expect(exitCodeFor('usage')).toBe(EXIT.usage)
    expect(exitCodeFor('not_in_terminal')).toBe(2)
    expect(exitCodeFor('connection')).toBe(1)
    expect(exitCodeFor('bad_response')).toBe(1)
    expect(exitCodeFor('io')).toBe(1)
    expect(exitCodeFor('interrupted')).toBe(130)
  })

  it('CliError expõe o código de saída', () => {
    expect(new CliError('forbidden', 'x').exitCode).toBe(3)
    expect(new ApiCallError('unavailable', 'x').exitCode).toBe(6)
    expect(new ApiCallError('unavailable', 'x')).toBeInstanceOf(CliError)
  })

  it('erros inesperados viram código 1', () => {
    const e = toCliError(new TypeError('boom'))
    expect(e.code).toBe('internal')
    expect(e.exitCode).toBe(1)
    expect(e.message).toContain('boom')
    const same = new CliError('usage', 'x')
    expect(toCliError(same)).toBe(same)
  })
})

describe('dicas', () => {
  it('forbidden sugere orq peers (ou o modo gerente)', () => {
    expect(hintFor('forbidden', 'peer')).toContain('orq peers')
    expect(hintFor('forbidden', 'manager')).toContain('modo gerente')
  })

  it('not_found depende do comando', () => {
    expect(hintFor('not_found', 'note')).toContain('orq note list')
    expect(hintFor('not_found', 'role')).toContain('orq role list')
    expect(hintFor('not_found', 'peer')).toContain('orq peers')
  })

  it('unavailable explica que o processo não está rodando', () => {
    expect(hintFor('unavailable', 'peer')).toContain('não está rodando')
  })

  it('sem dica para timeout', () => {
    expect(hintFor('timeout', 'peer')).toBeUndefined()
  })
})

describe('oneLine', () => {
  it('remove escapes de terminal e quebras', () => {
    expect(oneLine('ok\x1b]52;c;ZXZpbA==\x07 \x1b[31mvermelho\x1b[0m\nlinha\r2')).toBe('ok vermelho linha 2')
  })
})
