import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ nativeImage: {} }))
const { checkPdf, pngDataUrl } = await import('./attachments')

describe('anexos em PDF (processo principal)', () => {
  it('aceita só caminho absoluto de um .pdf que existe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-pdf-'))
    const pdf = path.join(dir, 'ctc.pdf')
    fs.writeFileSync(pdf, '%PDF-1.4\n')
    expect(checkPdf(pdf)).toBe(pdf)
    expect(() => checkPdf('ctc.pdf')).toThrow(/anexo inválido/)
    expect(() => checkPdf(path.join(dir, 'nota.txt'))).toThrow(/anexo inválido/)
    expect(() => checkPdf(path.join(dir, 'outro.pdf'))).toThrow(/não encontrado/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('só aceita PNG em base64 como miniatura', () => {
    expect(pngDataUrl('iVBORw0KGgoAAAANSUhEUg==\r\n')).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')
    expect(pngDataUrl('Exception: arquivo protegido')).toBeNull()
    expect(pngDataUrl('')).toBeNull()
  })
})
