import * as fs from 'node:fs'
import * as path from 'node:path'
import { claudeHookSettings } from '@shared/agentEvents'
import { log } from '../util/log'

/**
 * Arquivo de configurações passado ao Claude Code com `--settings` (só hooks, todos `orq hook`). Gerado a
 * cada inicialização em <userData>/run; o conteúdo é fixo (sem tokens nem caminhos): o `orq` lê porta e
 * token do ambiente do terminal. Sem o arquivo, o Claude Code roda sem hooks (estado pelo silêncio da tela).
 */
export function installClaudeHooks(userDataDir: string): string | undefined {
  const dir = path.join(userDataDir, 'run')
  const file = path.join(dir, 'claude-hooks.json')
  const content = `${JSON.stringify(claudeHookSettings(), null, 2)}\n`
  try {
    fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return file
    fs.writeFileSync(file, content, 'utf8')
    return file
  } catch (err) {
    log.warn('não foi possível gravar os hooks do Claude Code', { error: err instanceof Error ? err.name : 'erro' })
    return undefined
  }
}
