import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cutAtCtrlZ,
  decodeText,
  readAppVersion,
  readFileLimited,
  readStream,
  resolveInputPath,
  sleep,
  type PathDeps
} from './io'

let dir = ''
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-io-'))
})
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('decodeText', () => {
  it('UTF-8 com e sem BOM', () => {
    expect(decodeText(Buffer.from('ação', 'utf8'))).toBe('ação')
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ação', 'utf8')]))).toBe('ação')
  })

  it('UTF-16 LE/BE com BOM', () => {
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('ação ✓', 'utf16le')]))).toBe('ação ✓')
    const be = Buffer.from('ação', 'utf16le').swap16()
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe('ação')
    // byte ímpar sobrando no fim é ignorado em vez de quebrar
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be, Buffer.from([0x41])]))).toBe('ação')
  })

  it('Windows-1252 quando não é UTF-8 válido', () => {
    expect(decodeText(Buffer.from([0x61, 0xe7, 0xe3, 0x6f]))).toBe('ação')
  })

  it('normaliza CRLF', () => {
    expect(decodeText(Buffer.from('a\r\nb\r\n', 'utf8'))).toBe('a\nb\n')
  })
})

describe('readStream', () => {
  it('lê até o fim', async () => {
    const s = new PassThrough()
    const p = readStream(s, { maxBytes: 100 })
    s.write('olá ')
    s.end(Buffer.from('mundo'))
    expect((await p).toString('utf8')).toBe('olá mundo')
  })

  it('rejeita acima do limite', async () => {
    const s = new PassThrough()
    const p = readStream(s, { maxBytes: 4 })
    s.write('12345')
    await expect(p).rejects.toMatchObject({ code: 'too_large', exitCode: 7 })
  })

  it('Ctrl+Z encerra a leitura do teclado no Windows', async () => {
    const s = new PassThrough()
    const p = readStream(s, { maxBytes: 100, ctrlZIsEof: true })
    s.write('ação\r\n\x1a\r\n')
    expect((await p).toString('utf8')).toBe('ação\r\n')
    expect(cutAtCtrlZ(Buffer.from('abc'))).toEqual({ data: Buffer.from('abc'), eof: false })
  })

  it('sem ctrlZIsEof, Ctrl+Z é só mais um byte', async () => {
    const s = new PassThrough()
    const p = readStream(s, { maxBytes: 100 })
    s.end('a\x1ab')
    expect((await p).toString('utf8')).toBe('a\x1ab')
  })

  it('é cancelável', async () => {
    const s = new PassThrough()
    const ac = new AbortController()
    const p = readStream(s, { maxBytes: 100, signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toMatchObject({ code: 'interrupted', exitCode: 130 })
  })
})

describe('resolveInputPath (caminhos do Git Bash no Windows)', () => {
  const deps = (over: Partial<PathDeps> = {}): PathDeps => ({
    platform: 'win32',
    exists: () => false,
    cygpath: () => null,
    ...over
  })

  it('converte /<letra>/... quando o caminho literal não existe', () => {
    expect(resolveInputPath('/c/Users/x/msg.md', deps())).toBe('C:\\Users\\x\\msg.md')
    expect(resolveInputPath('/d', deps())).toBe('D:\\')
  })

  it('pergunta ao cygpath para o resto (ex.: /tmp)', () => {
    expect(resolveInputPath('/tmp/a.md', deps({ cygpath: () => 'C:\\Temp\\a.md' }))).toBe('C:\\Temp\\a.md')
    expect(resolveInputPath('/tmp/a.md', deps())).toBe('/tmp/a.md')
  })

  it('não mexe em caminhos que existem, relativos ou fora do Windows', () => {
    expect(resolveInputPath('/c/x', deps({ exists: () => true }))).toBe('/c/x')
    expect(resolveInputPath('rel/a.md', deps())).toBe('rel/a.md')
    expect(resolveInputPath('C:\\a.md', deps())).toBe('C:\\a.md')
    expect(resolveInputPath('/c/x', deps({ platform: 'linux' }))).toBe('/c/x')
  })
})

describe('readFileLimited', () => {
  it('lê arquivo', async () => {
    const f = path.join(dir, 'msg.md')
    fs.writeFileSync(f, 'conteúdo')
    expect((await readFileLimited(f, 1000)).toString('utf8')).toBe('conteúdo')
  })

  it('usa o caminho convertido, mas cita o original nos erros', async () => {
    const f = path.join(dir, 'convertido.md')
    fs.writeFileSync(f, 'ok')
    const deps: PathDeps = { platform: 'win32', exists: () => false, cygpath: () => f }
    expect((await readFileLimited('/tmp/convertido.md', 1000, deps)).toString('utf8')).toBe('ok')
    const missing: PathDeps = { ...deps, cygpath: () => path.join(dir, 'nao-ha.md') }
    await expect(readFileLimited('/tmp/nao-ha.md', 1000, missing)).rejects.toThrow('"/tmp/nao-ha.md"')
  })

  it('inexistente → not_found; pasta → uso; grande → limite', async () => {
    await expect(readFileLimited(path.join(dir, 'nao-existe.md'), 1000)).rejects.toMatchObject({ code: 'not_found' })
    await expect(readFileLimited(dir, 1000)).rejects.toMatchObject({ code: 'usage' })
    const big = path.join(dir, 'grande.txt')
    fs.writeFileSync(big, Buffer.alloc(2000, 0x61))
    await expect(readFileLimited(big, 1000)).rejects.toMatchObject({ code: 'too_large' })
  })
})

describe('readAppVersion', () => {
  it('lê a versão do package.json duas pastas acima do script', () => {
    const scriptDir = path.join(dir, 'out', 'main')
    fs.mkdirSync(scriptDir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.2.3' }))
    expect(readAppVersion(scriptDir)).toBe('1.2.3')
    expect(readAppVersion(path.join(dir, 'nada', 'aqui', 'mesmo'))).toBe('desconhecida')
  })
})

describe('sleep', () => {
  it('é cancelável', async () => {
    const ac = new AbortController()
    const p = sleep(10_000, ac.signal)
    ac.abort()
    await expect(p).rejects.toMatchObject({ code: 'interrupted' })
  })
})
