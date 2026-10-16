import { describe, expect, it } from 'vitest'
import { cleanTerminalText, isTerminalReport, lastLines, normalizeCarriageReturns, stripAnsi } from './ansi'

describe('stripAnsi', () => {
  it('remove sequências CSI (SGR, cursor, apagamento, modos privados)', () => {
    expect(stripAnsi('\x1b[31mvermelho\x1b[0m')).toBe('vermelho')
    expect(stripAnsi('\x1b[1;32;40mok\x1b[m')).toBe('ok')
    expect(stripAnsi('\x1b[38;2;255;100;0mrgb\x1b[39;49m')).toBe('rgb')
    expect(stripAnsi('\x1b[2J\x1b[H\x1b[3;45Htexto')).toBe('texto')
    expect(stripAnsi('\x1b[?25l\x1b[?2004hA\x1b[?25h\x1b[?1049l')).toBe('A')
    expect(stripAnsi('x\x1b[Ky\x1b[2K')).toBe('xy')
  })

  it('remove CSI com bytes intermediários e prefixos privados (DECSCUSR, DA2)', () => {
    expect(stripAnsi('\x1b[2 qB')).toBe('B')
    expect(stripAnsi('\x1b[>0cC')).toBe('C')
    expect(stripAnsi('\x1b[=1;2uD')).toBe('D')
  })

  it('remove CSI de 8 bits (C1 0x9b)', () => {
    expect(stripAnsi('\x9b31mA\x9b0m')).toBe('A')
    expect(stripAnsi('\x9b?25lB')).toBe('B')
  })

  it('remove OSC terminado por BEL, por ESC \\ e por ST de 8 bits', () => {
    expect(stripAnsi('\x1b]0;título da janela\x07depois')).toBe('depois')
    expect(stripAnsi('\x1b]8;;https://exemplo.com/a?b=c\x1b\\link\x1b]8;;\x1b\\')).toBe('link')
    expect(stripAnsi('\x1b]133;A\x9cprompt')).toBe('prompt')
    expect(stripAnsi('\x1b]52;c;SGVsbG8=\x07fim')).toBe('fim')
  })

  it('remove OSC de 8 bits (C1 0x9d)', () => {
    expect(stripAnsi('\x9d0;titulo\x07ok')).toBe('ok')
    expect(stripAnsi('\x9d2;titulo\x9cok')).toBe('ok')
  })

  it('o conteúdo do OSC não vaza mesmo contendo outras sequências', () => {
    expect(stripAnsi('\x1b]0;\x1b[31mtitulo\x07fim')).toBe('fim')
    expect(stripAnsi('antes\x1b]0;a\nb\x07depois')).toBe('antesdepois')
  })

  it('remove DCS, SOS, PM e APC (7 bits, terminados por ESC \\)', () => {
    expect(stripAnsi('\x1bPq#0;2;0;0;0#0~~@@\x1b\\fim')).toBe('fim')
    expect(stripAnsi('\x1bP+q544e\x1b\\A')).toBe('A')
    expect(stripAnsi('\x1bXsos\x1b\\B')).toBe('B')
    expect(stripAnsi('\x1b^pm\x1b\\C')).toBe('C')
    expect(stripAnsi('\x1b_apc\x1b\\D')).toBe('D')
  })

  it('remove DCS, SOS, PM e APC de 8 bits (terminados por ST 0x9c)', () => {
    expect(stripAnsi('\x90dcs\x9cE')).toBe('E')
    expect(stripAnsi('\x98sos\x9cF')).toBe('F')
    expect(stripAnsi('\x9epm\x9cG')).toBe('G')
    expect(stripAnsi('\x9fapc\x9cH')).toBe('H')
  })

  it('remove designação de charset (ESC ( B, ESC ) 0) mantendo o texto', () => {
    // Os caracteres do modo "line drawing" continuam como letras simples.
    expect(stripAnsi('\x1b(Babc\x1b(0qqq\x1b(B')).toBe('abcqqq')
    expect(stripAnsi('\x1b)0x')).toBe('x')
    expect(stripAnsi('\x1b%Gutf8')).toBe('utf8')
  })

  it('remove outras sequências ESC curtas (DECSC/DECRC, teclado, RIS, RI, DECALN)', () => {
    expect(stripAnsi('\x1b7salvo\x1b8')).toBe('salvo')
    expect(stripAnsi('\x1b=\x1b>k')).toBe('k')
    expect(stripAnsi('\x1bcreset')).toBe('reset')
    expect(stripAnsi('\x1bMsobe')).toBe('sobe')
    expect(stripAnsi('\x1b#8E')).toBe('E')
  })

  it('remove ESC solto e início de sequência cortada no fim do bloco', () => {
    expect(stripAnsi('abc\x1b')).toBe('abc')
    expect(stripAnsi('abc\x1b[')).toBe('abc')
  })

  it('remove controles C0 e DEL, preservando \\t, \\n e \\r', () => {
    expect(stripAnsi('a\x00b\x07c\x08d\x0be\x0cf\x7fg')).toBe('abcdefg')
    expect(stripAnsi('\x0ex\x0f\x1a\x1c\x1d\x1e\x1fy')).toBe('xy')
    expect(stripAnsi('col1\tcol2\nlinha2\rX')).toBe('col1\tcol2\nlinha2\rX')
  })

  it('remove controles C1 soltos (NEL, IND, ST...)', () => {
    expect(stripAnsi('a\x85b\x84c\x9cd\x80e\x9af')).toBe('abcdef')
  })

  it('preserva texto Unicode (acentos, emoji, CJK) e o NBSP logo após a faixa C1', () => {
    expect(stripAnsi('\x1b[1mação 🎉 日本語\x1b[0m')).toBe('ação 🎉 日本語')
    expect(stripAnsi('a\u00a0b')).toBe('a\u00a0b')
  })

  it('texto sem sequências fica igual', () => {
    const plain = 'PS C:\\Users\\dev> git status\nOn branch main'
    expect(stripAnsi(plain)).toBe(plain)
  })
})

describe('normalizeCarriageReturns', () => {
  it('converte \\r\\n em \\n', () => {
    expect(normalizeCarriageReturns('a\r\nb\r\n')).toBe('a\nb\n')
  })

  it('\\r volta ao início da linha e o texto seguinte sobrescreve o anterior', () => {
    expect(normalizeCarriageReturns('abcdef\rXY')).toBe('XYcdef')
  })

  it('várias sobrescritas seguidas (barra de progresso) mostram só o estado final', () => {
    expect(normalizeCarriageReturns('progresso 10%\rprogresso 55%\rprogresso 100%')).toBe('progresso 100%')
  })

  it('texto mais longo substitui completamente o anterior', () => {
    expect(normalizeCarriageReturns('ab\rxyz')).toBe('xyz')
  })

  it('\\r no fim da linha não apaga o conteúdo', () => {
    expect(normalizeCarriageReturns('pronto\r')).toBe('pronto')
    expect(normalizeCarriageReturns('abc\r\r\n')).toBe('abc\n')
  })

  it('cada linha é tratada separadamente', () => {
    expect(normalizeCarriageReturns('a1\rb\nc2\rd')).toBe('b1\nd2')
  })

  it('texto sem \\r fica igual', () => {
    expect(normalizeCarriageReturns('linha 1\nlinha 2')).toBe('linha 1\nlinha 2')
  })
})

describe('cleanTerminalText', () => {
  it('remove ANSI, aplica \\r e tira espaços à direita de cada linha', () => {
    const raw = '\x1b[32mok\x1b[0m   \r\n\x1b[1mpróxima\x1b[0m\t \r\n'
    expect(cleanTerminalText(raw)).toBe('ok\npróxima\n')
  })

  it('spinner sobrescrito com \\r deixa apenas a mensagem final', () => {
    const raw = 'Carregando |\rCarregando /\rConcluído!   \r\n\x1b[1;34m$\x1b[0m '
    expect(cleanTerminalText(raw)).toBe('Concluído!\n$')
  })

  it('o \\r de uma sequência OSC/CSI não interfere (sequências saem antes)', () => {
    expect(cleanTerminalText('\x1b]0;titulo\rx\x07linha')).toBe('linha')
  })

  it('mantém indentação à esquerda', () => {
    expect(cleanTerminalText('  função()\r\n\tcorpo  ')).toBe('  função()\n\tcorpo')
  })
})

describe('lastLines', () => {
  it('devolve as últimas N linhas', () => {
    expect(lastLines('a\nb\nc\nd', 2)).toBe('c\nd')
  })

  it('ignora linhas vazias (ou só com espaços) no final', () => {
    expect(lastLines('a\nb\n\n   \n\t\n', 1)).toBe('b')
  })

  it('mantém linhas vazias no meio', () => {
    expect(lastLines('a\n\nb\n', 3)).toBe('a\n\nb')
  })

  it('N maior que o total devolve tudo', () => {
    expect(lastLines('a\nb', 10)).toBe('a\nb')
  })

  it('N = 0 e texto vazio devolvem string vazia', () => {
    expect(lastLines('a\nb', 0)).toBe('')
    expect(lastLines('', 5)).toBe('')
    expect(lastLines('\n\n  \n', 5)).toBe('')
  })

  it('combinado com cleanTerminalText dá as últimas linhas "como vistas"', () => {
    const raw = 'compilando...\r\n\x1b[32m✓ 12 testes\x1b[0m\r\nbaixando 10%\rbaixando 100%\r\n\r\n'
    expect(lastLines(cleanTerminalText(raw), 2)).toBe('✓ 12 testes\nbaixando 100%')
  })
})

describe('isTerminalReport', () => {
  it('reconhece respostas automáticas do terminal', () => {
    expect(isTerminalReport('\x1b[?1;2c')).toBe(true)
    expect(isTerminalReport('\x1b[>0;276;0c')).toBe(true)
    expect(isTerminalReport('\x1b[12;40R')).toBe(true)
    expect(isTerminalReport('\x1b[I')).toBe(true)
    expect(isTerminalReport('\x1b[?2004;1$y')).toBe(true)
    expect(isTerminalReport('\x1b]11;rgb:0000/0000/0000\x1b\\')).toBe(true)
    expect(isTerminalReport('\x1bP1$r0m\x1b\\')).toBe(true)
    expect(isTerminalReport('\x1b[?1;2c\x1b[12;40R')).toBe(true)
  })

  it('não confunde digitação com resposta', () => {
    expect(isTerminalReport('')).toBe(false)
    expect(isTerminalReport('a')).toBe(false)
    expect(isTerminalReport('ls\r')).toBe(false)
    expect(isTerminalReport('\x1b[A')).toBe(false)
    expect(isTerminalReport('\x1b[15~')).toBe(false)
    expect(isTerminalReport('\x1b[200~colado\x1b[201~')).toBe(false)
    expect(isTerminalReport('\x1b[?1;2cx')).toBe(false)
  })
})
