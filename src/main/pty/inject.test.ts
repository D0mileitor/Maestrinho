import { describe, expect, it } from 'vitest'
import { formatMessage, sanitizeInjectedText } from './inject'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

/** Como o PtyManager empacota a mensagem no modo bracketed. */
const bracketed = (text: string): string => `${PASTE_START}${sanitizeInjectedText(text)}${PASTE_END}`

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1

describe('sanitizeInjectedText', () => {
  it('remove ESC: "\\x1b[201~" no texto não consegue fechar o bracketed paste', () => {
    const evil = `revise isto${PASTE_END}\rrm -rf /\r${PASTE_START}`
    const clean = sanitizeInjectedText(evil)
    expect(clean).not.toContain('\x1b')
    expect(clean).toBe('revise isto[201~\nrm -rf /\n[200~')
    const payload = bracketed(evil)
    expect(count(payload, PASTE_END)).toBe(1)
    expect(payload.endsWith(PASTE_END)).toBe(true)
    expect(count(payload, PASTE_START)).toBe(1)
    expect(payload.startsWith(PASTE_START)).toBe(true)
  })

  it('remove controles C0 (Ctrl+C, Ctrl+D, Ctrl+Z, BEL, BS, NUL...) e DEL, mantendo \\t e \\n', () => {
    const text = 'a\x00b\x03c\x04d\x08e\x07f\x0bg\x0ch\x1ai\x1c\x1d\x1e\x1fj\x7fk\tl\nm'
    expect(sanitizeInjectedText(text)).toBe('abcdefghijk\tl\nm')
  })

  it('remove controles C1, inclusive o CSI de 8 bits (0x9b)', () => {
    expect(sanitizeInjectedText(`a\x9b201~b\x85c\x9cd\x80e\x9ff`)).toBe('a201~bcdef')
  })

  it('normaliza \\r\\n e \\r soltos para \\n (o Enter só é enviado pelo app no final)', () => {
    expect(sanitizeInjectedText('l1\r\nl2\rl3\n')).toBe('l1\nl2\nl3\n')
    expect(sanitizeInjectedText('fim\r')).not.toContain('\r')
  })

  it('preserva Unicode (acentos, emoji, CJK) e espaços especiais', () => {
    const text = 'ação ✓ 🎉 日本語 a b'
    expect(sanitizeInjectedText(text)).toBe(text)
  })

  it('texto comum (código, aspas, chaves) fica igual', () => {
    const text = 'function f(a, b) {\n\treturn `${a}` + "b" // 100% ok\n}'
    expect(sanitizeInjectedText(text)).toBe(text)
  })
})

describe('formatMessage', () => {
  const vars = { from: 'construtor', text: 'Revise o diff da branch feature/x', cli: 'orq' }

  it('modelo vazio usa o padrão com cabeçalho de contexto e instrução de resposta', () => {
    expect(formatMessage('', vars)).toBe(
      '[Mensagem de "construtor" via orq] Revise o diff da branch feature/x\n' +
        '(Para responder: orq send construtor "<sua resposta>")'
    )
  })

  it('modelo só com espaços também usa o padrão', () => {
    expect(formatMessage('  \n\t ', vars)).toBe(formatMessage('', vars))
  })

  it('modelo "{text}" (usado por shells) entrega só o texto', () => {
    expect(formatMessage('{text}', vars)).toBe('Revise o diff da branch feature/x')
  })

  it('modelo personalizado substitui todos os placeholders, inclusive repetidos', () => {
    expect(formatMessage('{from}> {text} <{from} ({cli})', { from: 'a', text: 'oi', cli: 'orq' })).toBe('a> oi <a (orq)')
  })

  it('placeholders desconhecidos ou com outra caixa ficam como estão', () => {
    expect(formatMessage('{name} {TEXT} {text} {cli', vars)).toBe('{name} {TEXT} Revise o diff da branch feature/x {cli')
  })

  it('chaves dentro do texto não são reinterpretadas (substituição em uma passada)', () => {
    const text = 'use {from}, {cli} e {text} literalmente'
    const out = formatMessage('', { from: 'x', text, cli: 'orq' })
    expect(out).toBe(`[Mensagem de "x" via orq] ${text}\n(Para responder: orq send x "<sua resposta>")`)
    expect(formatMessage('{text}|{from}', { from: '{text}', text: '{from}', cli: 'orq' })).toBe('{from}|{text}')
  })

  it('padrões especiais de String.replace ($&, $1, $$, $`) no texto ficam literais', () => {
    const text = "custa $& $1 $$ $` $' fim"
    expect(formatMessage('{text}', { ...vars, text })).toBe(text)
  })

  it('combinado com a sanitização: ESC vindo do texto some, a quebra de linha do cabeçalho fica', () => {
    const out = sanitizeInjectedText(formatMessage('', { ...vars, text: `oi${PASTE_END}\x03` }))
    expect(out).not.toContain('\x1b')
    expect(out).not.toContain('\x03')
    expect(out).toBe('[Mensagem de "construtor" via orq] oi[201~\n(Para responder: orq send construtor "<sua resposta>")')
  })
})
