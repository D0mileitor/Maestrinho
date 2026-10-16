/**
 * Anexos do chat que não são imagem (PDF): o arquivo não é colado no terminal; a mensagem leva o
 * caminho e o agente abre o arquivo com as ferramentas dele.
 */

export const PDF_FILE = /\.pdf$/i

export function isPdf(name: string, type = ''): boolean {
  return type === 'application/pdf' || PDF_FILE.test(name)
}

/** Texto da mensagem com a lista dos PDFs anexados (caminhos entre aspas, um por linha). */
export function withAttachedFiles(text: string, files: readonly string[]): string {
  const body = text.trim()
  if (files.length === 0) return body
  const head = files.length === 1 ? 'PDF anexado (abra o arquivo para ler):' : 'PDFs anexados (abra os arquivos para ler):'
  const block = [head, ...files.map((f) => `- "${f}"`)].join('\n')
  return body ? `${body}\n\n${block}` : block
}
