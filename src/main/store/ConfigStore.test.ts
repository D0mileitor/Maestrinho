import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLI_NAME, CONFIG_FILE } from '@shared/constants'
import { compileIdlePatterns } from '@shared/idle'
import {
  AgentPresetSchema,
  AppConfigSchema,
  RoleSchema,
  SettingsSchema,
  type AgentPreset,
  type AppConfig,
  type Role
} from '@shared/schemas'
import { SettingsPatchReq } from '../ipc/schemas'
import { ConfigStore } from './ConfigStore'
import { builtinPresets, builtinRoles } from './defaults'

const BUILTIN_PRESET_IDS = ['shell', 'claude', 'opencode', 'ssh', 'codex', 'gemini', 'copilot', 'aider']
const BUILTIN_ROLE_IDS = ['lider', 'construtor', 'revisor', 'testador', 'documentador']

let dir = ''
let file = ''
const stores: ConfigStore[] = []

function open(): ConfigStore {
  const s = new ConfigStore(dir)
  stores.push(s)
  return s
}

function preset(id: string, extra: Partial<AgentPreset> = {}): AgentPreset {
  return AgentPresetSchema.parse({ id, label: `Preset ${id}`, command: `${id}-cmd`, ...extra })
}

function role(id: string, name: string, extra: Partial<Role> = {}): Role {
  return RoleSchema.parse({ id, name, instructions: `Instruções de ${name}`, ...extra })
}

const readConfigFile = (): AppConfig => AppConfigSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
const quarantined = (): string[] => fs.readdirSync(dir).filter((f) => f.startsWith(`${CONFIG_FILE}.invalido-`))

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-config-'))
  file = path.join(dir, CONFIG_FILE)
  // O log do app escreve no console fora de produção; silencia nos testes (os avisos são esperados).
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  // Nenhuma gravação com debounce pode rodar depois que a pasta temporária for apagada.
  for (const s of stores.splice(0)) s.flushSync()
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('ConfigStore: carga inicial', () => {
  it('userData vazio: padrões com presets e papéis de fábrica, gravados em config.json', () => {
    const store = open()
    const cfg = store.get()
    expect(cfg.version).toBe(1)
    expect(cfg.presets.map((p) => p.id)).toEqual(BUILTIN_PRESET_IDS)
    expect(cfg.roles.map((r) => r.id)).toEqual(BUILTIN_ROLE_IDS)
    expect(cfg.settings).toEqual(SettingsSchema.parse({}))
    store.flushSync()
    expect(readConfigFile()).toEqual(cfg)
  })

  it('a gravação inicial acontece sozinha após o debounce', async () => {
    open()
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(true), { timeout: 5000, interval: 25 })
    expect(readConfigFile().presets.map((p) => p.id)).toEqual(BUILTIN_PRESET_IDS)
  })

  it('reabrir carrega o que foi salvo', () => {
    const a = open()
    a.savePreset(preset('meu'))
    a.saveRole(role('arquiteto', 'Arquiteto'))
    a.setSettings({ theme: 'light' })
    a.flushSync()
    const b = open()
    expect(b.preset('meu')?.command).toBe('meu-cmd')
    expect(b.role('arquiteto')?.name).toBe('Arquiteto')
    expect(b.settings.theme).toBe('light')
    expect(b.roles.map((r) => r.id)).toEqual([...BUILTIN_ROLE_IDS, 'arquiteto'])
  })

  it('config.json ilegível (JSON inválido): copia para config.json.invalido-<data> e usa os padrões', () => {
    fs.writeFileSync(file, '{"version": 1, "presets": [')
    const store = open()
    const copies = quarantined()
    expect(copies).toHaveLength(1)
    expect(copies[0]).toMatch(/^config\.json\.invalido-\d{4}-\d{2}-\d{2}T[\d-]+Z$/)
    expect(fs.readFileSync(path.join(dir, copies[0]!), 'utf8')).toBe('{"version": 1, "presets": [')
    expect(store.get().presets.map((p) => p.id)).toEqual(BUILTIN_PRESET_IDS)
    expect(store.get().roles.map((r) => r.id)).toEqual(BUILTIN_ROLE_IDS)
    store.flushSync()
    expect(readConfigFile().presets).toHaveLength(BUILTIN_PRESET_IDS.length)
  })

  it('config.json com estrutura inválida: copia para quarentena e usa os presets de fábrica', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 2, presets: 'nao-e-lista' }))
    const store = open()
    expect(quarantined()).toHaveLength(1)
    expect(store.get().presets.map((p) => p.id)).toEqual(BUILTIN_PRESET_IDS)
    expect(store.settings).toEqual(SettingsSchema.parse({}))
  })

  // Regressão: com JSON válido mas estrutura inválida, os papéis de exemplo não eram adicionados e o
  // arquivo inválido ficava no disco (indo de novo para a quarentena a cada abertura).
  it('config.json com estrutura inválida: inclui os papéis de exemplo e regrava um arquivo válido', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 2 }))
    const store = open()
    expect(store.get().roles.map((r) => r.id)).toEqual(BUILTIN_ROLE_IDS)
    store.flushSync()
    expect(AppConfigSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8'))).success).toBe(true)
    // Reabrir não gera nova quarentena.
    open()
    expect(quarantined()).toHaveLength(1)
  })

  // Regressão: o aviso registrava err.message, que no V8 inclui um trecho do conteúdo do arquivo
  // (ex.: Unexpected token 'S', "SEGREDO-AP"... is not valid JSON). O log deve ter só metadados.
  it('não registra no log trechos do conteúdo de um config.json ilegível', () => {
    const lines: string[] = []
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    })
    fs.writeFileSync(file, 'SEGREDO-API-KEY=sk-123456')
    open()
    expect(lines.some((l) => l.includes('config.json ilegível'))).toBe(true)
    expect(lines.join('\n')).not.toContain('SEGREDO')
  })

  it('acrescenta presets de fábrica ausentes sem sobrescrever os editados pelo usuário', () => {
    const editedClaude = preset('claude', { label: 'Meu Claude', command: 'claude-custom', builtin: true })
    fs.writeFileSync(file, JSON.stringify({ version: 1, presets: [editedClaude, preset('meu')], roles: [] }))
    const store = open()
    expect(store.presets.map((p) => p.id)).toEqual(['claude', 'meu', 'shell', 'opencode', 'ssh', 'codex', 'gemini', 'copilot', 'aider'])
    expect(store.preset('claude')?.command).toBe('claude-custom')
  })

  it('papéis apagados pelo usuário não voltam (lista presente no arquivo é respeitada, mesmo vazia)', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, presets: [], roles: [role('meu', 'Meu')] }))
    expect(open().roles.map((r) => r.id)).toEqual(['meu'])
    fs.writeFileSync(file, JSON.stringify({ version: 1, presets: [], roles: [] }))
    expect(open().roles).toEqual([])
  })

  it('config.json sem a chave "roles" recebe os papéis de exemplo e é regravado', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, presets: [preset('meu')] }))
    const store = open()
    expect(store.roles.map((r) => r.id)).toEqual(BUILTIN_ROLE_IDS)
    store.flushSync()
    expect(readConfigFile().roles.map((r) => r.id)).toEqual(BUILTIN_ROLE_IDS)
    expect(readConfigFile().presets.map((p) => p.id)).toEqual(['meu', ...BUILTIN_PRESET_IDS])
  })

  it('preset de fábrica antigo (sem retomada de sessão) recebe os campos novos; preset do usuário não', () => {
    const def = builtinPresets().find((p) => p.id === 'claude')!
    expect(def.sessionArgs.length).toBeGreaterThan(0)
    const oldBuiltin = preset('claude', { builtin: true, command: 'claude', sessionArgs: [], resumeArgs: [] })
    const mine = preset('meu-claude', { command: 'claude', sessionArgs: [], resumeArgs: [] })
    fs.writeFileSync(file, JSON.stringify({ version: 1, presets: [oldBuiltin, mine], roles: [] }))
    const store = open()
    expect(store.preset('claude')).toMatchObject({
      sessionArgs: def.sessionArgs,
      resumeArgs: def.resumeArgs,
      sessionStore: def.sessionStore
    })
    expect(store.preset('meu-claude')).toMatchObject({ sessionArgs: [], resumeArgs: [], sessionStore: 'none' })
  })

  it('Codex de fábrica já salvo (sem retomada) passa a retomar a conversa com "codex resume <id>"', () => {
    const oldCodex = preset('codex', { builtin: true, command: 'codex', args: ['-c', 'sandbox_workspace_write.network_access=true'], sessionArgs: [], resumeArgs: [] })
    fs.writeFileSync(file, JSON.stringify({ version: 1, presets: [oldCodex], roles: [] }))
    const store = open()
    expect(store.preset('codex')).toMatchObject({ sessionArgs: [], resumeArgs: ['resume', '{sessionId}'], sessionStore: 'codex' })
  })

  it('preset de fábrica com retomada já configurada pelo usuário não é sobrescrito', () => {
    const custom = preset('claude', { builtin: true, sessionArgs: ['--minha-sessao', '{sessionId}'], resumeArgs: [] })
    fs.writeFileSync(file, JSON.stringify({ version: 1, presets: [custom], roles: [] }))
    expect(open().preset('claude')?.sessionArgs).toEqual(['--minha-sessao', '{sessionId}'])
  })

  it('config.json válido não é regravado só por ser aberto', () => {
    const content = JSON.stringify({ version: 1, presets: builtinPresets(), roles: [] })
    fs.writeFileSync(file, content)
    open().flushSync()
    expect(fs.readFileSync(file, 'utf8')).toBe(content)
  })
})

describe('ConfigStore: presets', () => {
  it('savePreset adiciona um preset novo validado (defaults do schema) e notifica', () => {
    const store = open()
    const changed: AppConfig[] = []
    store.on('changed', (cfg) => changed.push(cfg))
    const list = store.savePreset({ id: 'goose', label: 'Goose', command: 'goose' } as AgentPreset)
    expect(list.map((p) => p.id)).toEqual([...BUILTIN_PRESET_IDS, 'goose'])
    expect(store.preset('goose')).toMatchObject({ inputMode: 'bracketed', idleMs: 4000, submitDelayMs: 200, builtin: false })
    expect(changed).toHaveLength(1)
    expect(changed[0]!.presets.map((p) => p.id)).toContain('aider')
  })

  it('savePreset com id existente substitui no mesmo lugar', () => {
    const store = open()
    store.savePreset(preset('claude', { label: 'Claude editado' }))
    expect(store.presets.map((p) => p.id)).toEqual(BUILTIN_PRESET_IDS)
    expect(store.preset('claude')?.label).toBe('Claude editado')
  })

  it('savePreset inválido lança e não altera nada', () => {
    const store = open()
    const before = store.get()
    expect(() => store.savePreset({ id: 'com espaço', label: 'x', command: 'x' } as AgentPreset)).toThrow()
    expect(() => store.savePreset({ id: 'ok', label: 'x', command: '' } as AgentPreset)).toThrow()
    expect(store.get()).toEqual(before)
  })

  it('deletePreset remove e devolve a lista; id desconhecido não muda nada', () => {
    const store = open()
    expect(store.deletePreset('codex').map((p) => p.id)).toEqual(['shell', 'claude', 'opencode', 'ssh', 'gemini', 'copilot', 'aider'])
    expect(store.deletePreset('nao-existe').map((p) => p.id)).toEqual(['shell', 'claude', 'opencode', 'ssh', 'gemini', 'copilot', 'aider'])
  })

  it('deletePreset recusa apagar o último preset', () => {
    const store = open()
    store.deletePreset('codex')
    store.deletePreset('gemini')
    store.deletePreset('copilot')
    store.deletePreset('aider')
    store.deletePreset('ssh')
    store.deletePreset('opencode')
    store.deletePreset('claude')
    expect(() => store.deletePreset('shell')).toThrow('é preciso manter ao menos um preset')
    expect(store.presets.map((p) => p.id)).toEqual(['shell'])
  })

  it('preset de fábrica apagado volta ao reabrir (presets de fábrica sempre existem)', () => {
    const a = open()
    a.deletePreset('codex')
    a.flushSync()
    expect(open().preset('codex')).toBeDefined()
  })

  it('resetPresets restaura os de fábrica, mantém os do usuário e descarta "de fábrica" obsoletos', () => {
    const store = open()
    store.savePreset(preset('claude', { command: 'claude-editado', builtin: true }))
    store.savePreset(preset('meu'))
    store.savePreset(preset('antigo-de-fabrica', { builtin: true }))
    const list = store.resetPresets()
    expect(list.map((p) => p.id)).toEqual([...BUILTIN_PRESET_IDS, 'meu'])
    expect(store.preset('claude')?.command).toBe('claude')
  })

  it('get/presets devolvem cópias (mutar o retorno não altera o store)', () => {
    const store = open()
    store.get().presets[0]!.command = 'alterado'
    store.presets[0]!.label = 'alterado'
    expect(store.preset('shell')?.command).not.toBe('alterado')
    expect(store.preset('shell')?.label).not.toBe('alterado')
  })
})

describe('ConfigStore: papéis', () => {
  it('saveRole adiciona (com defaults) e atualiza por id', () => {
    const store = open()
    store.saveRole({ id: 'arquiteto', name: 'Arquiteto', instructions: 'desenha' } as Role)
    expect(store.role('arquiteto')).toEqual({ id: 'arquiteto', name: 'Arquiteto', instructions: 'desenha', color: '', builtin: false })
    store.saveRole(role('arquiteto', 'Arquiteta', { color: '#AABBCC' }))
    expect(store.roles.filter((r) => r.id === 'arquiteto')).toHaveLength(1)
    expect(store.role('arquiteto')?.name).toBe('Arquiteta')
  })

  it('saveRole inválido (cor fora de #RRGGBB, nome vazio) lança', () => {
    const store = open()
    expect(() => store.saveRole({ id: 'x', name: 'X', instructions: '', color: 'azul' } as Role)).toThrow()
    expect(() => store.saveRole({ id: 'y', name: '', instructions: '' } as Role)).toThrow()
    expect(store.role('x')).toBeUndefined()
  })

  it('findRole encontra por id ou por nome, sem diferenciar maiúsculas nem acentos', () => {
    const store = open()
    store.saveRole(role('r-rapido', 'Ação Rápida'))
    expect(store.findRole('revisor')?.id).toBe('revisor')
    expect(store.findRole('REVISOR')?.id).toBe('revisor')
    expect(store.findRole('Líder')?.id).toBe('lider')
    expect(store.findRole('LIDER')?.id).toBe('lider')
    expect(store.findRole('acao rapida')?.id).toBe('r-rapido')
    expect(store.findRole('  AÇÃO RÁPIDA ')?.id).toBe('r-rapido')
    expect(store.findRole('R-RAPIDO')?.id).toBe('r-rapido')
    expect(store.findRole('inexistente')).toBeUndefined()
  })

  it('deleteRole remove o papel', () => {
    const store = open()
    expect(store.deleteRole('testador').map((r) => r.id)).toEqual(['lider', 'construtor', 'revisor', 'documentador'])
    expect(store.findRole('Testador')).toBeUndefined()
  })
})

describe('ConfigStore: preferências', () => {
  it('setSettings mescla, valida e devolve cópia', () => {
    const store = open()
    const s = store.setSettings({ terminalFontSize: 15, showMinimap: false })
    expect(s.terminalFontSize).toBe(15)
    expect(store.settings.showMinimap).toBe(false)
    expect(store.settings.theme).toBe('dark')
    s.terminalFontSize = 99
    expect(store.settings.terminalFontSize).toBe(15)
  })

  it('patch parcial vindo do renderer (IPC) não volta as outras preferências ao padrão', () => {
    // Bug real: trocar o cenário do escritório apagava a lista de workspaces da barra lateral.
    const store = open()
    store.addRecentWorkspace('/ws/portal')
    store.addRecentWorkspace('/ws/loja')
    store.setSettings({ terminalFontSize: 16, theme: 'light' })
    const patch = SettingsPatchReq.parse({ officeScene: 'inferno' })
    expect(patch).toEqual({ officeScene: 'inferno' })
    store.setSettings(patch)
    expect(store.settings.recentWorkspaces).toEqual(['/ws/loja', '/ws/portal'])
    expect(store.settings.lastWorkspace).toBe('/ws/loja')
    expect(store.settings.terminalFontSize).toBe(16)
    expect(store.settings.theme).toBe('light')
    expect(store.settings.officeScene).toBe('inferno')
    // chave presente com undefined também não apaga
    store.setSettings({ recentWorkspaces: undefined })
    expect(store.settings.recentWorkspaces).toHaveLength(2)
  })

  it('setSettings inválido lança e mantém o valor anterior', () => {
    const store = open()
    expect(() => store.setSettings({ terminalFontSize: 200 })).toThrow()
    expect(() => store.setSettings({ theme: 'roxo' as 'dark' })).toThrow()
    expect(store.settings.terminalFontSize).toBe(13)
  })

  it('addRecentWorkspace: mais recente primeiro, sem duplicatas, no máximo 12, e define lastWorkspace', () => {
    const store = open()
    for (let i = 0; i < 15; i++) store.addRecentWorkspace(`/ws/${i}`)
    store.addRecentWorkspace('/ws/10')
    const { recentWorkspaces, lastWorkspace } = store.settings
    expect(recentWorkspaces).toHaveLength(12)
    expect(recentWorkspaces[0]).toBe('/ws/10')
    expect(recentWorkspaces.filter((d) => d === '/ws/10')).toHaveLength(1)
    expect(recentWorkspaces).not.toContain('/ws/0')
    expect(lastWorkspace).toBe('/ws/10')
  })
})

describe('presets e papéis de fábrica', () => {
  it('são válidos pelos schemas e marcados como de fábrica', () => {
    for (const p of builtinPresets()) {
      expect(AgentPresetSchema.safeParse(p).success).toBe(true)
      expect(p.builtin).toBe(true)
    }
    for (const r of builtinRoles()) {
      expect(RoleSchema.safeParse(r).success).toBe(true)
      expect(r.builtin).toBe(true)
    }
  })

  it('o preset shell é um shell em modo raw com padrões de prompt que compilam e casam', () => {
    const shell = builtinPresets().find((p) => p.id === 'shell')!
    expect(shell).toMatchObject({ isShell: true, inputMode: 'raw', messageTemplate: '{text}' })
    const patterns = compileIdlePatterns(shell.idlePatterns)
    expect(patterns).toHaveLength(shell.idlePatterns.length)
    const matches = (line: string): boolean => patterns.some((re) => re.test(line))
    expect(matches('PS C:\\Users\\dev\\projeto>')).toBe(true)
    expect(matches('dev@maquina:~/projeto$')).toBe(true)
    expect(matches('Compilando 3 de 10 arquivos')).toBe(false)
  })

  it('o preset do Claude Code recebe as instruções e pré-autoriza só o CLI', () => {
    const claude = builtinPresets().find((p) => p.id === 'claude')!
    expect(claude.args).toContain('{instructions}')
    expect(claude.args).toContain(`Bash(${CLI_NAME} *)`)
    expect(claude.inputMode).toBe('bracketed')
  })
})
