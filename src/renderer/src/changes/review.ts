import type { ChangedFile } from '@shared/changes'

/** Até quantos arquivos vão listados na mensagem (o resto vira "e mais N"). */
const MAX_LISTED = 50

/**
 * Revisor sugerido: o terminal com o papel "revisor"; senão o primeiro que não editou nenhum dos
 * arquivos (quem escreveu não revisa o próprio código); senão o primeiro terminal.
 */
export function defaultReviewer<T extends { id: string; name: string; roleId?: string }>(terminals: T[], editors: string[]): T | null {
  return (
    terminals.find((t) => t.roleId === 'revisor') ??
    terminals.find((t) => !editors.includes(t.name)) ??
    terminals[0] ??
    null
  )
}

/** Mensagem enviada ao revisor: onde estão as mudanças, quais arquivos, quem editou e o que fazer. */
export function reviewRequest(opts: {
  root: string
  branch: string | null
  files: Pick<ChangedFile, 'path' | 'kind'>[]
  kinds: Record<string, string>
  editors: string[]
}): string {
  const { root, branch, files, kinds, editors } = opts
  const listed = files.slice(0, MAX_LISTED).map((f) => `- ${f.path} (${kinds[f.kind] ?? f.kind})`)
  if (files.length > MAX_LISTED) listed.push(`- … e mais ${files.length - MAX_LISTED}`)
  const where = branch ? `${root} (branch ${branch})` : root
  const lines = [
    `Revisão de código pedida pelo usuário no repositório ${where}.`,
    `Arquivos (${files.length})${editors.length ? `, editados por ${editors.join(', ')}` : ''}:`,
    ...listed,
    `Veja o que mudou com: git -C "${root}" diff -- <arquivo> (arquivos novos ainda fora do git: leia o arquivo inteiro).`,
    'Aponte bugs, riscos de segurança, casos não tratados e testes faltando, citando arquivo e linha. Não altere os arquivos: só revise e responda aqui.'
  ]
  if (editors.length) lines.push(`Se estiver conectado a ${editors.join(', ')}, mande também o resultado pelo orq para quem editou.`)
  return lines.join('\n')
}
