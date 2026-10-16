/**
 * Tom de uma mensagem entre agentes, só para a visão Escritório: reprovação vira bronca de desenho animado
 * (o remetente vai até a mesa do colega com um jornal enrolado, uma galinha de borracha ou uma luva de mola) e
 * aprovação vira comemoração. O texto não sai do processo principal: só o tom acompanha a atividade da conexão.
 */
export type MessageMood = 'complaint' | 'praise'

/** O veredito costuma vir logo no começo ("REPROVADO rodada 2: ..."); o resto é relatório. */
const HEAD = 400
const SOFT_HEAD = 200

const COMPLAINT =
  /\b(reprovad[oa]s?|reprovei|rejeitad[oa]s?|recusad[oa]s?|nao (foi |foram )?aprovad[oa]s?|nao passou|nao passaram|rejected|changes requested|requested changes)\b/
const PRAISE = /\b(aprovad[oa]s?|aprovei|lgtm|approved|mandou bem|parabens|ficou otimo|ficou perfeito|passou em tudo|todos os testes passaram)\b/
/** Sinais mais fracos de que algo deu errado (só sem veredito explícito e sem "corrigi" na mensagem). */
const SOFT_COMPLAINT = /\b(falhou|falharam|quebrou|quebrad[oa]|nao funciona|nao esta funcionando|deu erro|continua com erro|voltou a falhar)\b/g
const FIXED = /\b(corrigi|corrigid[oa]s?|resolvi|resolvid[oa]s?|ajustei|consertei|arrumei|fixed)\b/
const NEGATION = /\b(nao|sem|nunca|nada)\s+$/

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Tom da mensagem para o escritório, ou `undefined` se for uma mensagem comum. */
export function messageMood(text: string): MessageMood | undefined {
  const head = normalize(text.slice(0, HEAD))
  const bad = COMPLAINT.exec(head)
  const good = PRAISE.exec(head)
  // O veredito que aparece primeiro vale ("nao aprovado" começa antes do "aprovado").
  if (bad && (!good || bad.index <= good.index)) return 'complaint'
  if (good) return 'praise'
  const soft = head.slice(0, SOFT_HEAD)
  if (FIXED.test(soft)) return undefined
  for (const m of soft.matchAll(SOFT_COMPLAINT)) {
    if (!NEGATION.test(soft.slice(Math.max(0, m.index - 8), m.index))) return 'complaint'
  }
  return undefined
}
