import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { characterPath, importCharacter, listCharacters, readCharacter, removeCharacter } from './characters'

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
const JPG = Buffer.from('ffd8ffe000104a464946', 'hex')

describe('personagens do escritório', () => {
  const dirs: string[] = []
  const tmp = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-personagem-'))
    dirs.push(d)
    return d
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  it('importa PNG com nome seguro, lista, lê como data URL e apaga', () => {
    const ws = tmp()
    const src = path.join(tmp(), 'Robô azul!.png')
    fs.writeFileSync(src, PNG)
    expect(importCharacter(ws, src)).toBe('Robo azul-.png')
    expect(importCharacter(ws, src)).toBe('Robo azul- (2).png')
    expect(listCharacters(ws).map((c) => c.file)).toEqual(['Robo azul- (2).png', 'Robo azul-.png'])
    expect(readCharacter(ws, 'Robo azul-.png')).toMatch(/^data:image\/png;base64,/)
    removeCharacter(ws, 'Robo azul-.png')
    expect(listCharacters(ws)).toHaveLength(1)
  })

  it('recusa JPEG (sem transparência), arquivo que não é imagem e nomes fora da pasta', () => {
    const ws = tmp()
    const jpg = path.join(tmp(), 'foto.png')
    fs.writeFileSync(jpg, JPG)
    expect(() => importCharacter(ws, jpg)).toThrow(/PNG, WebP ou GIF/)
    const txt = path.join(tmp(), 'nada.png')
    fs.writeFileSync(txt, 'oi')
    expect(() => importCharacter(ws, txt)).toThrow()
    expect(() => characterPath(ws, '../x.png')).toThrow()
    expect(() => characterPath(ws, 'x.jpg')).toThrow()
  })
})
