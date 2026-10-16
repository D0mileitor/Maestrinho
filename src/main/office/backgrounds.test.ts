import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backgroundPath, importBackground, listBackgrounds, readBackground, removeBackground, safeBackgroundName, sniffImage } from './backgrounds'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
let ws = ''
let src = ''

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-bg-'))
  src = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-bg-src-'))
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(ws, { recursive: true, force: true })
  fs.rmSync(src, { recursive: true, force: true })
})

describe('fundos do escritório', () => {
  it('reconhece o tipo pelos bytes, não pela extensão', () => {
    expect(sniffImage(PNG)).toBe('png')
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(sniffImage(Buffer.from('GIF89a'))).toBe('gif')
    expect(sniffImage(Buffer.from('RIFF....WEBPVP8 '))).toBe('webp')
    expect(sniffImage(Buffer.from('<svg></svg>'))).toBeNull()
  })

  it('nome seguro: sem acentos, barras ou caracteres especiais, com a extensão real', () => {
    expect(safeBackgroundName('C:/x/Praia ao pôr-do-sol!.JPG', 'png')).toBe('Praia ao por-do-sol-.png')
    expect(safeBackgroundName('../../etc/passwd', 'png')).toBe('passwd.png')
    expect(safeBackgroundName('$$$.png', 'gif')).toBe('-.gif')
  })

  it('importa para .maestrinho/cenarios, não sobrescreve, lista, lê e apaga', () => {
    const file = path.join(src, 'Meu fundo.png')
    fs.writeFileSync(file, PNG)
    expect(importBackground(ws, file)).toBe('Meu fundo.png')
    expect(importBackground(ws, file)).toBe('Meu fundo (2).png')
    expect(fs.existsSync(path.join(ws, '.maestrinho', 'cenarios', 'Meu fundo.png'))).toBe(true)
    expect(listBackgrounds(ws).map((b) => b.file)).toEqual(['Meu fundo (2).png', 'Meu fundo.png'])
    expect(readBackground(ws, 'Meu fundo.png')).toMatch(/^data:image\/png;base64,/)
    removeBackground(ws, 'Meu fundo.png')
    expect(listBackgrounds(ws).map((b) => b.file)).toEqual(['Meu fundo (2).png'])
  })

  it('recusa arquivo que não é imagem e nomes que saem da pasta', () => {
    const fake = path.join(src, 'fundo.png')
    fs.writeFileSync(fake, 'não sou png')
    expect(() => importBackground(ws, fake)).toThrow(/não é uma imagem/)
    expect(() => backgroundPath(ws, '../workspace.json')).toThrow()
    expect(() => backgroundPath(ws, '..\\x.png')).toThrow()
    expect(() => readBackground(ws, 'nada.exe')).toThrow()
  })
})
