import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { z } from 'zod'
import { CLAUDE_MODELS, EFFORTS } from '@shared/agentModels'
import type { AgentCatalog } from '@shared/ipc'

/** Cache de modelos que o próprio Codex mantém (~/.codex/models_cache.json): só os campos usados aqui. */
const CodexCacheSchema = z.object({
  models: z
    .array(
      z.object({
        slug: z.string().min(1).max(100),
        display_name: z.string().max(100).optional(),
        description: z.string().max(500).optional(),
        default_reasoning_level: z.string().max(16).optional(),
        visibility: z.string().max(20).optional(),
        supported_reasoning_levels: z.array(z.object({ effort: z.string().max(16) })).max(20).optional()
      })
    )
    .max(200)
})

/**
 * Modelos e esforços que a interface oferece ao criar um terminal. Claude Code: apelidos fixos (sempre a
 * versão mais nova). Codex: a lista que o próprio Codex baixou (só leitura; sem rede).
 */
export async function agentCatalog(env: Record<string, string | undefined> = process.env): Promise<AgentCatalog> {
  const catalog: AgentCatalog = {
    claude: { models: CLAUDE_MODELS.map((id) => ({ id, label: id, efforts: [...EFFORTS.claude] })), efforts: [...EFFORTS.claude] },
    codex: { models: [], efforts: [...EFFORTS.codex] }
  }
  try {
    const home = env['CODEX_HOME']?.trim() || path.join(os.homedir(), '.codex')
    const raw = await fsp.readFile(path.join(home, 'models_cache.json'), 'utf8')
    const parsed = CodexCacheSchema.safeParse(JSON.parse(raw))
    if (parsed.success) {
      catalog.codex.models = parsed.data.models
        .filter((m) => m.visibility !== 'hide')
        .map((m) => ({
          id: m.slug,
          label: m.display_name || m.slug,
          description: m.description,
          defaultEffort: m.default_reasoning_level,
          efforts: (m.supported_reasoning_levels ?? []).map((r) => r.effort).filter((e) => /^[a-z]{2,16}$/.test(e))
        }))
    }
  } catch {
    // Codex não instalado ou cache ilegível: o campo aceita qualquer nome de modelo.
  }
  return catalog
}
