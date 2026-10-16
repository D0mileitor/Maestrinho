import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DebouncedWriter, writeFileAtomic, writeFileAtomicSync } from './atomicWrite'

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-atomic-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Arquivos temporários deixados pela escrita atômica (".<nome>.<hex>.tmp"). */
const tempFiles = (d: string): string[] => fs.readdirSync(d).filter((f) => f.endsWith('.tmp'))

describe('writeFileAtomic', () => {
  it('cria o arquivo (e diretórios intermediários) com o conteúdo em UTF-8', async () => {
    const file = path.join(dir, 'a', 'b', 'dados.json')
    await writeFileAtomic(file, '{"nome":"ação"}')
    expect(fs.readFileSync(file, 'utf8')).toBe('{"nome":"ação"}')
  })

  it('substitui o conteúdo existente por inteiro (inclusive por um menor)', async () => {
    const file = path.join(dir, 'dados.json')
    fs.writeFileSync(file, 'x'.repeat(10_000))
    await writeFileAtomic(file, 'curto')
    expect(fs.readFileSync(file, 'utf8')).toBe('curto')
  })

  it('não deixa arquivos temporários para trás', async () => {
    const file = path.join(dir, 'dados.json')
    await writeFileAtomic(file, '1')
    await writeFileAtomic(file, '2')
    expect(fs.readdirSync(dir)).toEqual(['dados.json'])
  })

  it('escritas concorrentes no mesmo arquivo terminam com um dos conteúdos completos e sem temporários', async () => {
    const file = path.join(dir, 'dados.json')
    const contents = Array.from({ length: 12 }, (_, i) => JSON.stringify({ i, payload: String(i).repeat(5000) }))
    await Promise.all(contents.map((c) => writeFileAtomic(file, c)))
    expect(contents).toContain(fs.readFileSync(file, 'utf8'))
    expect(tempFiles(dir)).toEqual([])
  })

  it('falha (destino é um diretório): rejeita e remove o temporário', async () => {
    const target = path.join(dir, 'sou-um-diretorio')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'dentro.txt'), 'x')
    await expect(writeFileAtomic(target, 'conteúdo')).rejects.toThrow()
    expect(tempFiles(dir)).toEqual([])
    expect(fs.readFileSync(path.join(target, 'dentro.txt'), 'utf8')).toBe('x')
  })
})

describe('writeFileAtomicSync', () => {
  it('cria, substitui e não deixa temporários', () => {
    const file = path.join(dir, 'sub', 'cfg.json')
    writeFileAtomicSync(file, 'primeiro')
    writeFileAtomicSync(file, 'segundo')
    expect(fs.readFileSync(file, 'utf8')).toBe('segundo')
    expect(fs.readdirSync(path.dirname(file))).toEqual(['cfg.json'])
  })

  it('falha (destino é um diretório): lança e remove o temporário', () => {
    const target = path.join(dir, 'pasta')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'dentro.txt'), 'x')
    expect(() => writeFileAtomicSync(target, 'conteúdo')).toThrow()
    expect(tempFiles(dir)).toEqual([])
  })
})

describe('DebouncedWriter', () => {
  it('agrupa agendamentos próximos numa única escrita com o último conteúdo', async () => {
    const file = path.join(dir, 'ws.json')
    const writer = new DebouncedWriter(file, 40)
    const produced: number[] = []
    for (let i = 1; i <= 5; i++) {
      writer.schedule(() => {
        produced.push(i)
        return `versão ${i}`
      })
    }
    expect(writer.hasPending).toBe(true)
    expect(fs.existsSync(file)).toBe(false)
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(true), { timeout: 5000 })
    await writer.flush()
    expect(fs.readFileSync(file, 'utf8')).toBe('versão 5')
    // Só o último produtor é chamado: os anteriores foram substituídos antes de rodar.
    expect(produced).toEqual([5])
    expect(writer.hasPending).toBe(false)
  })

  it('o conteúdo é produzido na hora da escrita (estado mais recente), não no agendamento', async () => {
    const file = path.join(dir, 'ws.json')
    const writer = new DebouncedWriter(file, 10_000)
    const state = { n: 1 }
    writer.schedule(() => JSON.stringify(state))
    state.n = 2
    await writer.flush()
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ n: 2 })
  })

  it('flush escreve imediatamente e cancela o timer (sem segunda escrita depois)', async () => {
    const file = path.join(dir, 'ws.json')
    const writer = new DebouncedWriter(file, 30)
    let calls = 0
    writer.schedule(() => {
      calls++
      return 'agora'
    })
    await writer.flush()
    expect(fs.readFileSync(file, 'utf8')).toBe('agora')
    await new Promise((r) => setTimeout(r, 120))
    expect(calls).toBe(1)
  })

  it('flush sem nada pendente resolve sem escrever', async () => {
    const file = path.join(dir, 'ws.json')
    const writer = new DebouncedWriter(file, 30)
    await writer.flush()
    expect(fs.existsSync(file)).toBe(false)
  })

  it('escritas encadeadas: um flush durante outra escrita termina com o conteúdo mais novo', async () => {
    const file = path.join(dir, 'ws.json')
    const writer = new DebouncedWriter(file, 10_000)
    writer.schedule(() => 'A'.repeat(200_000))
    const first = writer.flush()
    writer.schedule(() => 'B')
    const second = writer.flush()
    await Promise.all([first, second])
    expect(fs.readFileSync(file, 'utf8')).toBe('B')
    expect(tempFiles(dir)).toEqual([])
  })

  it('flushSync grava de forma síncrona e cancela a escrita agendada', async () => {
    const file = path.join(dir, 'cfg.json')
    const writer = new DebouncedWriter(file, 30)
    let calls = 0
    writer.schedule(() => {
      calls++
      return 'síncrono'
    })
    writer.flushSync()
    expect(fs.readFileSync(file, 'utf8')).toBe('síncrono')
    expect(writer.hasPending).toBe(false)
    await new Promise((r) => setTimeout(r, 120))
    expect(calls).toBe(1)
  })

  it('flushSync sem pendências não faz nada', () => {
    const file = path.join(dir, 'cfg.json')
    new DebouncedWriter(file, 30).flushSync()
    expect(fs.existsSync(file)).toBe(false)
  })

  it('erros de escrita vão para onError (assíncrono e síncrono) sem rejeitar o flush', async () => {
    // O "diretório" pai é um arquivo: mkdir falha na hora (sem as novas tentativas do rename).
    const blocker = path.join(dir, 'arquivo')
    fs.writeFileSync(blocker, 'x')
    const errors: unknown[] = []
    const writer = new DebouncedWriter(path.join(blocker, 'ws.json'), 10_000, (err) => {
      errors.push(err)
    })
    writer.schedule(() => 'a')
    await expect(writer.flush()).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
    writer.schedule(() => 'b')
    expect(() => writer.flushSync()).not.toThrow()
    expect(errors).toHaveLength(2)
    // Depois de um erro, o mesmo escritor continua utilizável (a cadeia de escritas não fica rejeitada).
    fs.rmSync(blocker)
    fs.mkdirSync(blocker)
    writer.schedule(() => 'c')
    await writer.flush()
    expect(fs.readFileSync(path.join(blocker, 'ws.json'), 'utf8')).toBe('c')
    expect(errors).toHaveLength(2)
  })
})
