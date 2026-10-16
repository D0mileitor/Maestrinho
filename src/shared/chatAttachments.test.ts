import { describe, expect, it } from 'vitest'
import { isPdf, withAttachedFiles } from './chatAttachments'

describe('anexos em PDF', () => {
  it('reconhece PDF pelo tipo ou pela extensão', () => {
    expect(isPdf('Contrato.PDF')).toBe(true)
    expect(isPdf('sem-extensao', 'application/pdf')).toBe(true)
    expect(isPdf('print.png', 'image/png')).toBe(false)
  })

  it('sem PDF, a mensagem segue como está', () => {
    expect(withAttachedFiles('  rode os testes ', [])).toBe('rode os testes')
  })

  it('lista os caminhos depois do texto, entre aspas', () => {
    expect(withAttachedFiles('confira a CTC', ['C:\\docs\\ctc 2024.pdf'])).toBe(
      'confira a CTC\n\nPDF anexado (abra o arquivo para ler):\n- "C:\\docs\\ctc 2024.pdf"'
    )
  })

  it('só os PDFs, sem texto', () => {
    expect(withAttachedFiles('', ['/a.pdf', '/b.pdf'])).toBe('PDFs anexados (abra os arquivos para ler):\n- "/a.pdf"\n- "/b.pdf"')
  })
})
