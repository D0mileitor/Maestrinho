/**
 * Remoção de sequências de escape ANSI/VT de texto de terminal.
 * Cobre CSI, OSC, DCS/SOS/PM/APC, sequências ESC de 2 bytes e caracteres de controle C0/C1
 * (exceto \n e \t). Também normaliza \r\n e aplica \r "simples" (retorno ao início da linha).
 */

// CSI: ESC [ ... final  |  C1 CSI (0x9b)
const CSI = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g
// OSC: ESC ] ... (BEL | ESC \)  |  C1 OSC (0x9d)
const OSC = /(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c)/g
// DCS / SOS / PM / APC: ESC P|X|^|_ ... ST
const STRINGS = /(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c)/g
// Outras sequências ESC: ESC seguido de intermediários e um final (ex.: ESC ( B, ESC 7, ESC =)
const ESC_OTHER = /\x1b[ -/]*[0-~]/g
// Controles C0 exceto \t (09), \n (0a), \r (0d); e C1 restantes
const CONTROLS = /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f\x80-\x9f]/g

export function stripAnsi(input: string): string {
  return input
    .replace(OSC, '')
    .replace(STRINGS, '')
    .replace(CSI, '')
    .replace(ESC_OTHER, '')
    .replace(/\x1b/g, '')
    .replace(CONTROLS, '')
}

/**
 * Converte saída bruta (com \r) em linhas "como vistas": um \r sem \n volta ao início da linha
 * e o texto seguinte sobrescreve o anterior.
 */
export function normalizeCarriageReturns(input: string): string {
  const lines = input.replace(/\r\n/g, '\n').split('\n')
  return lines
    .map((line) => {
      if (!line.includes('\r')) return line
      let current = ''
      for (const segment of line.split('\r')) {
        current = segment + current.slice(segment.length)
      }
      return current
    })
    .join('\n')
}

/** Limpa ANSI, aplica \r e remove espaços à direita de cada linha. */
export function cleanTerminalText(input: string): string {
  return normalizeCarriageReturns(stripAnsi(input))
    .split('\n')
    .map((l) => l.replace(/\s+$/u, ''))
    .join('\n')
}

/** Últimas N linhas, ignorando linhas vazias no final. */
export function lastLines(text: string, n: number): string {
  const lines = text.split('\n')
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
  return lines.slice(Math.max(0, lines.length - n)).join('\n')
}

/**
 * Respostas automáticas do terminal (DA1/DA2, posição do cursor, foco, DECRPM, relatórios de janela,
 * OSC/DCS), que o xterm do renderer envia sozinho em resposta a consultas do processo. Não são
 * digitação: não podem abrir a janela de eco do detector de ociosidade.
 */
const TERMINAL_REPORT =
  /^(?:\x1b\[[?>][\d;]*c|\x1b\[\??\d+(?:;\d+)*R|\x1b\[[IO]|\x1b\[\??[\d;]*\$y|\x1b\[[\d;]*t|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\)+$/

export function isTerminalReport(data: string): boolean {
  return data.length > 0 && data.length <= 4096 && TERMINAL_REPORT.test(data)
}
