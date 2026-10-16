import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { CONFIG_FILE } from '@shared/constants'
import {
  AgentPresetSchema,
  AppConfigSchema,
  RoleSchema,
  SettingsSchema,
  type AgentPreset,
  type AppConfig,
  type Role,
  type Settings
} from '@shared/schemas'
import { DebouncedWriter } from './atomicWrite'
import { builtinPresets, builtinRoles } from './defaults'
import { log } from '../util/log'

/**
 * Configuração global (presets de agentes, papéis, preferências) em userData/config.json.
 * Arquivo inválido é preservado como config.json.invalido-<data> e o app segue com os padrões.
 */
export class ConfigStore extends EventEmitter<{ changed: [AppConfig] }> {
  private config: AppConfig
  private readonly file: string
  private readonly writer: DebouncedWriter

  constructor(userDataDir: string) {
    super()
    this.file = path.join(userDataDir, CONFIG_FILE)
    this.writer = new DebouncedWriter(this.file, 300, (err) =>
      log.error('falha ao salvar config', err instanceof Error ? err : undefined)
    )
    this.config = this.load()
  }

  private load(): AppConfig {
    let raw: unknown = undefined
    try {
      if (fs.existsSync(this.file)) raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch (err) {
      // Só o tipo do erro: a mensagem do JSON.parse inclui um trecho do conteúdo (pode ter segredos).
      log.warn('config.json ilegível; usando padrões', { error: err instanceof Error ? err.name : 'erro' })
      this.quarantine()
    }
    let cfg: AppConfig
    const parsed = raw === undefined ? null : AppConfigSchema.safeParse(raw)
    if (parsed && !parsed.success) {
      log.warn('config.json inválido; usando padrões', { issues: parsed.error.issues.length })
      this.quarantine()
    }
    if (parsed?.success) {
      cfg = parsed.data
    } else {
      cfg = AppConfigSchema.parse({ version: 1, presets: [], roles: [] })
    }
    // Garante que presets/papéis de fábrica existam (sem sobrescrever edições do usuário).
    const presetIds = new Set(cfg.presets.map((p) => p.id))
    const builtins = builtinPresets()
    for (const p of builtins) if (!presetIds.has(p.id)) cfg.presets.push(p)
    // Campos novos de presets de fábrica (ex.: retomada de sessão) entram só se estiverem vazios.
    for (const p of cfg.presets) {
      const def = builtins.find((b) => b.id === p.id)
      if (!p.builtin || !def) continue
      if (p.sessionArgs.length === 0 && p.resumeArgs.length === 0 && (def.sessionArgs.length > 0 || def.resumeArgs.length > 0)) {
        p.sessionArgs = [...def.sessionArgs]
        p.resumeArgs = [...def.resumeArgs]
        p.sessionStore = def.sessionStore
      }
      // Estado exato (hooks/notificações): campo novo; ausente = nunca foi escolhido pelo usuário.
      if (p.agentEvents === undefined && def.agentEvents !== undefined) p.agentEvents = def.agentEvents
      if (p.modelArgs === undefined && def.modelArgs) p.modelArgs = [...def.modelArgs]
      if (p.effortArgs === undefined && def.effortArgs) p.effortArgs = [...def.effortArgs]
      if (p.titleArgs === undefined && def.titleArgs) p.titleArgs = [...def.titleArgs]
    }
    // Papéis de exemplo: em config nova, inválida (voltou aos padrões) ou sem a chave "roles".
    // Um array vazio num arquivo válido é escolha do usuário e é respeitado.
    const fresh = raw === undefined || !parsed?.success
    const roleIds = new Set(cfg.roles.map((r) => r.id))
    const hasRolesKey = typeof raw === 'object' && raw !== null && 'roles' in raw
    const addRoles = fresh || !hasRolesKey
    if (addRoles) for (const r of builtinRoles()) if (!roleIds.has(r.id)) cfg.roles.push(r)
    this.config = cfg
    if (addRoles) this.persist()
    return cfg
  }

  private quarantine(): void {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      fs.copyFileSync(this.file, `${this.file}.invalido-${stamp}`)
    } catch {
      // ignora
    }
  }

  private persist(): void {
    const snapshot = JSON.stringify(this.config, null, 2)
    this.writer.schedule(() => snapshot)
    this.emit('changed', this.get())
  }

  get(): AppConfig {
    return structuredClone(this.config)
  }

  get settings(): Settings {
    return structuredClone(this.config.settings)
  }

  preset(id: string): AgentPreset | undefined {
    return this.config.presets.find((p) => p.id === id)
  }

  role(id: string): Role | undefined {
    return this.config.roles.find((r) => r.id === id)
  }

  /** Busca papel por id ou por nome (sem diferenciar maiúsculas/acentos). */
  findRole(idOrName: string): Role | undefined {
    const norm = (s: string): string =>
      s
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim()
    const key = norm(idOrName)
    return this.config.roles.find((r) => r.id === idOrName || norm(r.id) === key || norm(r.name) === key)
  }

  get presets(): AgentPreset[] {
    return structuredClone(this.config.presets)
  }

  get roles(): Role[] {
    return structuredClone(this.config.roles)
  }

  setSettings(patch: Partial<Settings>): Settings {
    // Chave presente com undefined não apaga o valor atual (o parse trocaria pelo padrão).
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    this.config.settings = SettingsSchema.parse({ ...this.config.settings, ...defined })
    this.persist()
    return this.settings
  }

  savePreset(preset: AgentPreset): AgentPreset[] {
    const valid = AgentPresetSchema.parse(preset)
    const idx = this.config.presets.findIndex((p) => p.id === valid.id)
    if (idx >= 0) this.config.presets[idx] = valid
    else this.config.presets.push(valid)
    this.persist()
    return this.presets
  }

  deletePreset(id: string): AgentPreset[] {
    if (this.config.presets.length <= 1) throw new Error('é preciso manter ao menos um preset')
    this.config.presets = this.config.presets.filter((p) => p.id !== id)
    this.persist()
    return this.presets
  }

  /** Restaura os presets de fábrica (mantém presets criados pelo usuário). */
  resetPresets(): AgentPreset[] {
    const builtins = builtinPresets()
    const builtinIds = new Set(builtins.map((p) => p.id))
    this.config.presets = [...builtins, ...this.config.presets.filter((p) => !builtinIds.has(p.id) && !p.builtin)]
    this.persist()
    return this.presets
  }

  saveRole(role: Role): Role[] {
    const valid = RoleSchema.parse(role)
    const idx = this.config.roles.findIndex((r) => r.id === valid.id)
    if (idx >= 0) this.config.roles[idx] = valid
    else this.config.roles.push(valid)
    this.persist()
    return this.roles
  }

  deleteRole(id: string): Role[] {
    this.config.roles = this.config.roles.filter((r) => r.id !== id)
    this.persist()
    return this.roles
  }

  addRecentWorkspace(dir: string): void {
    const recents = [dir, ...this.config.settings.recentWorkspaces.filter((d) => d !== dir)].slice(0, 12)
    this.setSettings({ recentWorkspaces: recents, lastWorkspace: dir })
  }

  flushSync(): void {
    this.writer.flushSync()
  }
}
