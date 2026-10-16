import { describe, expect, it, vi } from 'vitest'
import { CliError } from './errors'
import {
  STDIN_NOTICE_MS,
  cleanMessage,
  emptySourceError,
  loadText,
  planText,
  refArg,
  withTrailingNewline
} from './input'
import { memoryIo } from './testkit'

describe('planText (montagem da mensagem)', () => {
  it('junta os argumentos com um espaço', () => {
    const plan = planText(['Revise', 'o', 'diff  agora'], undefined, true)
    expect(plan).toEqual({ kind: 'args', text: 'Revise o diff  agora' })
  })

  it('"-" lê do stdin', () => {
    expect(planText(['-'], undefined, true)).toEqual({ kind: 'stdin', explicit: true })
    expect(planText(['-'], undefined, false)).toEqual({ kind: 'stdin', explicit: true })
  })

  it('"-" no meio do texto é literal', () => {
    expect(planText(['-', 'item'], undefined, false)).toEqual({ kind: 'args', text: '- item' })
  })

  it('sem texto: stdin se não for terminal; nada se for', () => {
    expect(planText([], undefined, false)).toEqual({ kind: 'stdin', explicit: false })
    expect(planText([], undefined, true)).toBeNull()
  })

  it('--file', () => {
    expect(planText([], 'msg.md', true)).toEqual({ kind: 'file', path: 'msg.md' })
  })

  it('argumentos e --file juntos é erro de uso', () => {
    expect(() => planText(['oi'], 'msg.md', true)).toThrow(CliError)
    try {
      planText(['oi'], 'msg.md', true)
    } catch (err) {
      expect((err as CliError).exitCode).toBe(2)
    }
    expect(() => planText([], '  ', true)).toThrow(/precisa do caminho/)
  })

  it('argumento vazio explícito vira texto vazio (ex.: esvaziar nota)', () => {
    expect(planText([''], undefined, false)).toEqual({ kind: 'args', text: '' })
  })
})

describe('loadText', () => {
  it('lê stdin UTF-8 e normaliza CRLF', async () => {
    const io = memoryIo({ stdin: 'linha 1 ação\r\nlinha 2\r\n' })
    expect(await loadText({ kind: 'stdin', explicit: true }, io)).toBe('linha 1 ação\nlinha 2\n')
    expect(io.stderr).toBe('')
  })

  it('avisa no stderr quando vai ler do teclado', async () => {
    const io = memoryIo({ stdin: 'x', stdinIsTTY: true })
    await loadText({ kind: 'stdin', explicit: true }, io)
    expect(io.stderr).toContain('Ctrl+D')
  })

  it('leitura implícita do stdin avisa no stderr se o pipe não terminar logo', async () => {
    vi.useFakeTimers()
    try {
      let finish: (b: Buffer) => void = () => undefined
      const io = memoryIo()
      io.readStdin = () => new Promise<Buffer>((resolve) => (finish = resolve))
      const pending = loadText({ kind: 'stdin', explicit: false }, io)
      vi.advanceTimersByTime(STDIN_NOTICE_MS - 1)
      expect(io.stderr).toBe('')
      vi.advanceTimersByTime(1)
      expect(io.stderr).toContain('orq: aguardando o texto pelo stdin')
      finish(Buffer.from('tarde'))
      expect(await pending).toBe('tarde')
      // "-" explícito não avisa
      const io2 = memoryIo()
      io2.readStdin = () => new Promise<Buffer>((resolve) => (finish = resolve))
      const explicit = loadText({ kind: 'stdin', explicit: true }, io2)
      vi.advanceTimersByTime(STDIN_NOTICE_MS * 2)
      finish(Buffer.from('x'))
      await explicit
      expect(io2.stderr).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('lê arquivo UTF-16 com BOM (Out-File do Windows PowerShell)', async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('olá\r\nmundo', 'utf16le')])
    const io = memoryIo({ files: { 'a.txt': utf16 } })
    expect(await loadText({ kind: 'file', path: 'a.txt' }, io)).toBe('olá\nmundo')
  })

  it('arquivo inexistente → não encontrado (código 4)', async () => {
    const io = memoryIo()
    const p = loadText({ kind: 'file', path: 'nao.md' }, io)
    await expect(p).rejects.toMatchObject({ code: 'not_found', exitCode: 4 })
  })

  it('stdin grande demais → limite (código 7)', async () => {
    const io = memoryIo({ stdin: Buffer.alloc(4 * 1024 * 1024 + 1, 0x61) })
    const p = loadText({ kind: 'stdin', explicit: true }, io)
    await expect(p).rejects.toMatchObject({ code: 'too_large', exitCode: 7 })
  })
})

describe('limpeza de texto', () => {
  it('cleanMessage tira linhas vazias do início e espaços do fim, preservando a indentação', () => {
    expect(cleanMessage('\n\n   código indentado\n  linha 2\n\n  ')).toBe('   código indentado\n  linha 2')
    expect(cleanMessage('a\r\nb\r\n')).toBe('a\nb')
    expect(cleanMessage(' \n \t\n')).toBe('')
  })

  it('withTrailingNewline', () => {
    expect(withTrailingNewline('x')).toBe('x\n')
    expect(withTrailingNewline('x\n')).toBe('x\n')
    expect(withTrailingNewline('')).toBe('')
  })

  it('refArg aceita estilo menção', () => {
    expect(refArg('@revisor')).toBe('revisor')
    expect(refArg('  revisor ')).toBe('revisor')
    expect(refArg('revisor @ Outro')).toBe('revisor @ Outro')
  })

  it('emptySourceError explica a origem', () => {
    const stdin = emptySourceError({ kind: 'stdin', explicit: false }, 'a mensagem está vazia', 'orq send x "t"')
    expect(stdin.message).toBe('a mensagem está vazia: nada chegou pelo stdin.')
    expect(stdin.exitCode).toBe(2)
    const file = emptySourceError({ kind: 'file', path: 'a.md' }, 'a mensagem está vazia', '')
    expect(file.message).toBe('o arquivo "a.md" está vazio.')
    expect(emptySourceError({ kind: 'args', text: '' }, 'o texto está vazio', 'x').message).toBe('o texto está vazio.')
  })
})
