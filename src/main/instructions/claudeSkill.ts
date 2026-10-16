import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { APP_ID, APP_NAME, CLI_NAME } from '@shared/constants'
import { log } from '../util/log'
import { dirKey, errCode, readJsonFile, writeFileAtomicSync } from './fsutil'

/**
 * Skill do Claude Code com a referência do CLI, em <cwd>/.claude/skills/<cli>/SKILL.md (presets com
 * instructionsTarget "claude-skill").
 *
 * O arquivo só é escrito se não existir ou se for do app (contém SKILL_MARKER); uma skill do usuário
 * com o mesmo nome nunca é sobrescrita. Ao sair o último terminal da pasta, o app apaga apenas o
 * arquivo dele e os diretórios que ele mesmo criou, se tiverem ficado vazios.
 */

export const SKILL_MARKER = `<!-- ${APP_ID}:skill — arquivo gerado pelo ${APP_NAME}; será removido ao fechar o terminal (apague esta linha para mantê-lo) -->`

/** Nome da skill (minúsculas, números e hífens, como o Claude Code exige). */
export function skillName(): string {
  return (
    CLI_NAME.toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'cli'
  )
}

/** Diretórios da skill, do mais raso ao mais profundo. */
function skillDirs(cwd: string): string[] {
  const claude = path.join(cwd, '.claude')
  const skills = path.join(claude, 'skills')
  return [claude, skills, path.join(skills, skillName())]
}

export function skillFilePath(cwd: string): string {
  return path.join(skillDirs(cwd)[2]!, 'SKILL.md')
}

/** Arquivo completo: frontmatter (name, description), marcador do app e corpo. */
export function composeSkillFile(description: string, body: string): string {
  const desc = description.replace(/\s+/g, ' ').trim().slice(0, 1000)
  return [
    '---',
    `name: ${skillName()}`,
    // JSON é um escalar entre aspas válido em YAML: dispensa escapar ":" e "#" da descrição.
    `description: ${JSON.stringify(desc)}`,
    '---',
    SKILL_MARKER,
    '',
    body.replace(/\r\n?/g, '\n').trim(),
    ''
  ].join('\n')
}

const EntrySchema = z.object({
  dir: z.string().min(1).max(4096),
  file: z.string().min(1).max(4096),
  terminals: z.array(z.string().min(1).max(64)).max(1000),
  /** Diretórios que não existiam e foram criados pelo app. */
  createdDirs: z.array(z.string().min(1).max(4096)).max(3)
})
type Entry = z.infer<typeof EntrySchema>

const RegistrySchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string().max(4096), EntrySchema)
})

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (errCode(err) === 'ENOENT') return null
    throw err
  }
}

export class ClaudeSkillManager {
  private entries: Record<string, Entry>
  /** Pares "chave|terminal" adquiridos por este processo. */
  private readonly live = new Set<string>()

  constructor(private readonly registryFile: string) {
    this.entries = readJsonFile(registryFile, RegistrySchema)?.entries ?? {}
  }

  /**
   * Garante a skill do app em `cwd` e conta o terminal. Devolve false se não foi possível (ex.: já
   * existe uma skill do usuário com esse nome) — nesse caso nada foi alterado.
   */
  acquire(cwd: string, terminalId: string, description: string, body: string): boolean {
    const key = dirKey(cwd)
    const prev = this.entries[key]
    const alive = (prev?.terminals ?? []).filter((t) => t !== terminalId && this.live.has(liveKey(key, t)))
    const file = prev?.file ?? skillFilePath(cwd)
    const content = composeSkillFile(description, body)
    try {
      const current = readText(file)
      if (current !== null && !current.includes(SKILL_MARKER)) {
        log.warn('já existe uma skill do usuário com o nome do CLI; ela não será alterada', { terminal: terminalId })
        return false
      }
      const dirs = skillDirs(path.dirname(path.dirname(path.dirname(path.dirname(file)))))
      const missing = current === null ? dirs.filter((d) => !fs.existsSync(d)) : []
      const createdDirs = [...new Set([...(prev?.createdDirs ?? []), ...missing])]
      // Registro antes do arquivo: um crash entre os dois ainda deixa como limpar.
      this.entries[key] = { dir: cwd, file, terminals: [...alive, terminalId], createdDirs }
      this.persist()
      try {
        for (const d of missing) fs.mkdirSync(d)
        if (current !== content) writeFileAtomicSync(file, content)
      } catch (err) {
        if (prev) this.entries[key] = prev
        else delete this.entries[key]
        this.persist()
        throw err
      }
      this.live.add(liveKey(key, terminalId))
      return true
    } catch (err) {
      log.warn('falha ao criar a skill do CLI', { terminal: terminalId, code: errCode(err) })
      return false
    }
  }

  /** Libera o terminal; o último da pasta remove o arquivo do app e os diretórios vazios que ele criou. */
  release(cwd: string, terminalId: string): void {
    let key = dirKey(cwd)
    if (!this.live.has(liveKey(key, terminalId))) {
      const found = Object.keys(this.entries).find((k) => this.live.has(liveKey(k, terminalId)))
      if (!found) return
      key = found
    }
    const entry = this.entries[key]
    this.live.delete(liveKey(key, terminalId))
    if (!entry) return
    const alive = entry.terminals.filter((t) => t !== terminalId && this.live.has(liveKey(key, t)))
    if (alive.length > 0) {
      entry.terminals = alive
      this.persist()
      return
    }
    this.removeFrom(entry)
    delete this.entries[key]
    this.persist()
  }

  /** No início do app: remove skills deixadas por uma sessão anterior e zera o registro. */
  cleanupOrphans(): void {
    for (const [key, entry] of Object.entries(this.entries)) {
      const alive = entry.terminals.filter((t) => this.live.has(liveKey(key, t)))
      if (alive.length > 0) {
        entry.terminals = alive
        continue
      }
      this.removeFrom(entry)
      delete this.entries[key]
    }
    this.persist()
  }

  activeDirs(): string[] {
    return Object.values(this.entries).map((e) => e.dir)
  }

  private removeFrom(entry: Entry): void {
    try {
      const current = readText(entry.file)
      if (current !== null) {
        if (current.includes(SKILL_MARKER)) fs.unlinkSync(entry.file)
        else log.info('skill sem o marcador do app (o usuário assumiu o arquivo); mantida')
      }
    } catch (err) {
      log.warn('falha ao remover a skill do CLI', { code: errCode(err) })
    }
    // Só diretórios criados pelo app, do mais profundo ao mais raso, e só se estiverem vazios.
    const expected = new Set(skillDirs(path.dirname(path.dirname(path.dirname(path.dirname(entry.file))))))
    for (const d of [...entry.createdDirs].filter((x) => expected.has(x)).sort((a, b) => b.length - a.length)) {
      try {
        fs.rmdirSync(d)
      } catch {
        // não vazio (há arquivos do usuário) ou já removido: mantém
      }
    }
  }

  private persist(): void {
    try {
      writeFileAtomicSync(this.registryFile, JSON.stringify({ version: 1, entries: this.entries }, null, 2))
    } catch (err) {
      log.warn('falha ao salvar o registro da skill do CLI', { code: errCode(err) })
    }
  }
}

function liveKey(key: string, terminalId: string): string {
  return `${key}|${terminalId}`
}
