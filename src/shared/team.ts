import { z } from 'zod'
import { BoardColumnSchema } from './board'
import { AgentPresetSchema, PartituraSchema, type AgentPreset, type Role } from './schemas'
import { uniqueName } from './ids'

/**
 * Time pronto: a partitura do workspace inteiro (terminais com funções, modelo e esforço, notas e
 * conexões) mais os presets usados e as colunas do quadro, num arquivo único para levar a outra máquina.
 * Caminhos locais, sessões e hibernação não viajam. Ao importar, nada roda sozinho: presets que não
 * existem aqui só entram se você marcar, vendo a linha de comando.
 */

export const TEAM_KIND = 'maestrinho-time'

export const TeamFileSchema = PartituraSchema.extend({
  kind: z.literal(TEAM_KIND),
  description: z.string().max(2000).default(''),
  presets: z.array(AgentPresetSchema).max(50).default([]),
  boardColumns: z.array(BoardColumnSchema).min(1).max(12).optional()
})
export type TeamFile = z.infer<typeof TeamFileSchema>

export type PresetStatus = 'igual' | 'diferente' | 'novo'

export interface TeamPreview {
  /** Identifica o arquivo lido (guardado no main até a importação). */
  token: string
  name: string
  description: string
  terminals: { name: string; role: string | null; preset: string; presetLabel: string; presetStatus: PresetStatus | 'ausente'; renamedTo?: string }[]
  roles: { name: string; status: 'nova' | 'existente' }[]
  notes: { file: string; status: 'nova' | 'igual' | 'copia'; chars: number }[]
  presets: { id: string; label: string; commandLine: string; status: PresetStatus }[]
  /** Colunas do quadro que vieram no arquivo (null = não vieram). */
  board: string[] | null
}

/** Linha de comando legível de um preset (para você decidir se aceita). */
export function presetCommandLine(p: Pick<AgentPreset, 'command' | 'args'>): string {
  const quote = (a: string): string => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)
  const args = p.args.map((a) => (a.length > 60 ? `${a.slice(0, 57)}…` : a))
  return [p.command, ...args].map(quote).join(' ')
}

/** O preset do arquivo é igual ao local? (o que importa para executar: comando, argumentos e ambiente). */
export function samePreset(a: AgentPreset, b: AgentPreset): boolean {
  const key = (p: AgentPreset): string =>
    JSON.stringify([p.command, p.args, p.env, p.sessionArgs, p.resumeArgs, p.modelArgs ?? [], p.effortArgs ?? [], p.titleArgs ?? [], p.isShell, p.inputMode])
  return key(a) === key(b)
}

export function presetStatus(incoming: AgentPreset, local: AgentPreset | undefined): PresetStatus {
  if (!local) return 'novo'
  return samePreset(incoming, local) ? 'igual' : 'diferente'
}

/** Resumo do que a importação vai fazer (nada é alterado aqui). */
export function teamPreview(
  team: TeamFile,
  local: { presets: AgentPreset[]; roles: Role[]; notes: Map<string, string>; terminalNames?: string[] },
  token: string
): TeamPreview {
  const fold = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim()
  const localPreset = (id: string): AgentPreset | undefined => local.presets.find((p) => p.id === id)
  const presets = team.presets.map((p) => ({ id: p.id, label: p.label, commandLine: presetCommandLine(p), status: presetStatus(p, localPreset(p.id)) }))
  const roleName = (id: string | undefined): string | null => (id ? (team.roles.find((r) => r.id === id)?.name ?? null) : null)
  // Mesmo critério da inserção: nome já usado no workspace ganha sufixo (dev → dev-2).
  const taken = [...(local.terminalNames ?? [])]
  const terminals = team.nodes.flatMap((n) => {
    if (n.kind !== 'terminal') return []
    const finalName = uniqueName(n.name, taken)
    taken.push(finalName)
    const incoming = team.presets.find((p) => p.id === n.presetId)
    const here = localPreset(n.presetId)
    const status: PresetStatus | 'ausente' = incoming ? presetStatus(incoming, here) : here ? 'igual' : 'ausente'
    const entry = { name: n.name, role: roleName(n.roleId), preset: n.presetId, presetLabel: incoming?.label ?? here?.label ?? n.presetId, presetStatus: status }
    return [finalName !== n.name ? { ...entry, renamedTo: finalName } : entry]
  })
  const roles = team.roles.map((r) => ({
    name: r.name,
    status: (local.roles.some((x) => x.id === r.id || fold(x.name) === fold(r.name)) ? 'existente' : 'nova') as 'nova' | 'existente'
  }))
  const notes = Object.entries(team.notes).map(([file, content]) => {
    const cur = local.notes.get(file)
    const status: 'nova' | 'igual' | 'copia' = cur === undefined ? 'nova' : cur === content ? 'igual' : 'copia'
    return { file, status, chars: content.length }
  })
  return {
    token,
    name: team.name,
    description: team.description,
    terminals,
    roles,
    notes,
    presets,
    board: team.boardColumns ? team.boardColumns.map((c) => c.name) : null
  }
}

/**
 * Preset do arquivo que você aceitou: se o id já existe aqui com outro comando, entra com id novo
 * (nunca sobrescreve o seu). Devolve o preset a gravar.
 */
export function adoptPreset(incoming: AgentPreset, localIds: readonly string[]): AgentPreset {
  let id = incoming.id
  if (localIds.includes(id)) {
    const base = `${incoming.id}-time`.slice(0, 58)
    id = base
    for (let i = 2; localIds.includes(id); i++) id = `${base}-${i}`
  }
  return { ...incoming, id, builtin: false, label: id === incoming.id ? incoming.label : `${incoming.label} (time)` }
}
