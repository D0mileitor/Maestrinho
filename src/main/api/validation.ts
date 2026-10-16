import { z } from 'zod'
import { ApiError, ApiRequestSchemas, type ApiMethod, type ApiParsedRequest } from '@shared/api'

/**
 * Validação dos corpos de requisição da API local com mensagens em pt-BR, escritas para que o
 * agente que chamou o CLI entenda o que corrigir.
 */

/** Mensagens padrão do zod em pt-BR (mensagens próprias dos schemas, como "mensagem vazia", têm prioridade). */
export const PT_BR_ERRORS = z.locales.ptBR().localeError

const API_METHOD_SET: ReadonlySet<string> = new Set(Object.keys(ApiRequestSchemas))

export function isApiMethod(name: string): name is ApiMethod {
  return API_METHOD_SET.has(name)
}

function hasPath(body: unknown, path: readonly PropertyKey[]): boolean {
  let cur: unknown = body
  for (const key of path) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, key)) return false
    cur = (cur as Record<PropertyKey, unknown>)[key]
  }
  return true
}

function acceptedFields(method: ApiMethod): string[] {
  return Object.keys(ApiRequestSchemas[method].shape)
}

/** Texto do primeiro problema de validação, com o campo envolvido e os campos aceitos quando útil. */
export function describeIssue(method: ApiMethod, issue: z.core.$ZodIssue, body: unknown): string {
  const prefix = `Parâmetros inválidos em "${method}"`
  const field = issue.path.map(String).join('.')
  if (issue.code === 'unrecognized_keys') {
    const fields = acceptedFields(method)
    const accepted = fields.length > 0 ? `campos aceitos: ${fields.join(', ')}` : 'este comando não aceita campos'
    return `${prefix}: ${issue.message} (${accepted}).`
  }
  if (issue.code === 'invalid_type' && issue.path.length > 0 && !hasPath(body, issue.path)) {
    return `${prefix}: o campo obrigatório "${field}" não foi informado.`
  }
  return field ? `${prefix}: campo "${field}": ${issue.message}.` : `${prefix}: ${issue.message}.`
}

/** Valida o corpo de uma chamada; lança ApiError('bad_request') com a primeira falha. */
export function parseApiRequest<M extends ApiMethod>(method: M, body: unknown): ApiParsedRequest<M> {
  const schema = ApiRequestSchemas[method]
  const parsed = schema.safeParse(body, { error: PT_BR_ERRORS })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ApiError('bad_request', issue ? describeIssue(method, issue, body) : `Parâmetros inválidos em "${method}".`)
  }
  return parsed.data as ApiParsedRequest<M>
}
