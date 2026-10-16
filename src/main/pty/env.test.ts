import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV } from '@shared/constants'
import { buildTerminalEnv, prependPath, type TerminalEnvInput } from './env'
import { baseEnv } from './shell'

const isWin = process.platform === 'win32'
/** Separador e nome típico da variável PATH na plataforma em que o teste roda. */
const SEP = isWin ? ';' : ':'
const PATH_KEY = isWin ? 'Path' : 'PATH'
const SYSTEM_DIRS = isWin ? ['C:\\Windows\\system32', 'C:\\Windows'] : ['/usr/bin', '/bin']
const BIN_DIR = isWin ? 'C:\\Users\\dev\\AppData\\Roaming\\Maestrinho\\bin' : '/home/dev/.config/Maestrinho/bin'

function input(extra: Partial<TerminalEnvInput> = {}): TerminalEnvInput {
  return {
    base: { [PATH_KEY]: SYSTEM_DIRS.join(SEP), HOME_TESTE: 'x' },
    presetEnv: {},
    binDir: BIN_DIR,
    apiPort: 43210,
    token: 'tok-123',
    terminalId: 't-abc',
    terminalName: 'revisor',
    workspaceDir: isWin ? 'C:\\proj' : '/home/dev/proj',
    nodeExe: isWin ? 'C:\\app\\Maestrinho.exe' : '/opt/maestrinho/maestrinho',
    cliScript: isWin ? 'C:\\app\\resources\\out\\main\\orq.js' : '/opt/maestrinho/out/main/orq.js',
    ...extra
  }
}

describe('prependPath (win32)', () => {
  it('preserva o nome "Path" usado pelo Windows e prefixa o diretório', () => {
    const env: Record<string, string> = { Path: 'C:\\A;C:\\B' }
    prependPath(env, 'C:\\bin', 'win32')
    expect(env).toEqual({ Path: 'C:\\bin;C:\\A;C:\\B' })
  })

  it('preserva o nome "PATH" quando é esse o usado', () => {
    const env: Record<string, string> = { PATH: 'C:\\A' }
    prependPath(env, 'C:\\bin', 'win32')
    expect(env).toEqual({ PATH: 'C:\\bin;C:\\A' })
  })

  it('remove o próprio diretório de outras posições, sem diferenciar maiúsculas nem "/" e "\\"', () => {
    const env: Record<string, string> = { Path: 'C:\\A;c:/BIN;C:\\B;C:\\Bin' }
    prependPath(env, 'C:\\bin', 'win32')
    expect(env.Path).toBe('C:\\bin;C:\\A;C:\\B')
  })

  it('remove entradas vazias', () => {
    const env: Record<string, string> = { Path: ';C:\\A;;C:\\B;' }
    prependPath(env, 'C:\\bin', 'win32')
    expect(env.Path).toBe('C:\\bin;C:\\A;C:\\B')
  })

  it('com "Path" e "PATH" ao mesmo tempo, a primeira variante vence e as outras são descartadas', () => {
    // Documenta o comportamento atual: o valor da variante descartada é perdido.
    const env: Record<string, string> = { Path: 'C:\\A', PATH: 'C:\\B', path: 'C:\\C' }
    prependPath(env, 'C:\\bin', 'win32')
    expect(env).toEqual({ Path: 'C:\\bin;C:\\A' })
  })

  it('sem PATH, cria "PATH" só com o diretório', () => {
    const env: Record<string, string> = {}
    prependPath(env, 'C:\\bin', 'win32')
    expect(env).toEqual({ PATH: 'C:\\bin' })
  })

  it('é idempotente', () => {
    const env: Record<string, string> = { Path: 'C:\\A' }
    prependPath(env, 'C:\\bin', 'win32')
    prependPath(env, 'C:\\bin', 'win32')
    expect(env.Path).toBe('C:\\bin;C:\\A')
  })
})

describe('prependPath (linux)', () => {
  it('usa ":" e mantém as demais entradas na ordem', () => {
    const env: Record<string, string> = { PATH: '/usr/bin:/bin' }
    prependPath(env, '/opt/bin', 'linux')
    expect(env.PATH).toBe('/opt/bin:/usr/bin:/bin')
  })

  it('deduplica só por igualdade exata (Linux diferencia maiúsculas)', () => {
    const env: Record<string, string> = { PATH: '/usr/bin:/opt/bin:/OPT/bin' }
    prependPath(env, '/opt/bin', 'linux')
    expect(env.PATH).toBe('/opt/bin:/usr/bin:/OPT/bin')
  })

  it('remove entradas vazias (que no POSIX significariam o diretório atual)', () => {
    const env: Record<string, string> = { PATH: ':/usr/bin::/bin:' }
    prependPath(env, '/opt/bin', 'linux')
    expect(env.PATH).toBe('/opt/bin:/usr/bin:/bin')
  })

  it('sem PATH, cria a variável', () => {
    const env: Record<string, string> = {}
    prependPath(env, '/opt/bin', 'linux')
    expect(env).toEqual({ PATH: '/opt/bin' })
  })
})

describe('buildTerminalEnv', () => {
  it('injeta as variáveis do CLI com os nomes da especificação (ORQ_*)', () => {
    const env = buildTerminalEnv(input())
    expect(env).toMatchObject({
      ORQ_PORT: '43210',
      ORQ_TOKEN: 'tok-123',
      ORQ_SESSION: 'tok-123',
      ORQ_TERMINAL_ID: 't-abc',
      ORQ_TERMINAL_NAME: 'revisor',
      ORQ_WORKSPACE_DIR: input().workspaceDir,
      ORQ_NODE: input().nodeExe,
      ORQ_CLI: input().cliScript
    })
    // Os nomes vêm das constantes centralizadas (renomear o CLI = alterar constants.ts).
    for (const key of Object.values(ENV)) expect(env).toHaveProperty(key)
  })

  it('prefixa o diretório bin do app ao PATH herdado, preservando o nome da variável', () => {
    const env = buildTerminalEnv(input())
    expect(env[PATH_KEY]).toBe([BIN_DIR, ...SYSTEM_DIRS].join(SEP))
    expect(Object.keys(env).filter((k) => k.toLowerCase() === 'path')).toEqual([PATH_KEY])
  })

  it('mantém o restante do ambiente base e não modifica o objeto recebido', () => {
    const data = input()
    const before = structuredClone(data.base)
    const env = buildTerminalEnv(data)
    expect(env.HOME_TESTE).toBe('x')
    expect(data.base).toEqual(before)
    expect(env).not.toBe(data.base)
  })

  it('variáveis extras do preset são aplicadas e sobrescrevem as do ambiente base', () => {
    const env = buildTerminalEnv(
      input({ base: { [PATH_KEY]: '', HOME_TESTE: 'x', FOO: 'base' }, presetEnv: { FOO: 'preset', NOVA: '1' } })
    )
    expect(env.FOO).toBe('preset')
    expect(env.NOVA).toBe('1')
  })

  it('o preset não consegue sobrescrever as variáveis ORQ_* (o app sempre vence)', () => {
    const presetEnv = {
      ORQ_PORT: '1',
      ORQ_TOKEN: 'falso',
      ORQ_SESSION: 'falso',
      ORQ_TERMINAL_ID: 'outro',
      ORQ_TERMINAL_NAME: 'outro',
      ORQ_WORKSPACE_DIR: '/tmp',
      ORQ_NODE: '/tmp/evil',
      ORQ_CLI: '/tmp/evil.js'
    }
    const env = buildTerminalEnv(input({ presetEnv }))
    expect(env.ORQ_PORT).toBe('43210')
    expect(env.ORQ_TOKEN).toBe('tok-123')
    expect(env.ORQ_SESSION).toBe('tok-123')
    expect(env.ORQ_TERMINAL_ID).toBe('t-abc')
    expect(env.ORQ_TERMINAL_NAME).toBe('revisor')
    expect(env.ORQ_NODE).toBe(input().nodeExe)
    expect(env.ORQ_CLI).toBe(input().cliScript)
  })

  it('PATH do preset (mesma grafia) substitui o herdado, mas o bin do app continua na frente', () => {
    const custom = isWin ? 'C:\\custom' : '/custom'
    const env = buildTerminalEnv(input({ presetEnv: { [PATH_KEY]: custom } }))
    expect(env[PATH_KEY]).toBe([BIN_DIR, custom].join(SEP))
  })

  // BUG (produção, só Windows): o ambiente herdado usa "Path" e o preset define "PATH"; as duas
  // chaves coexistem no objeto e prependPath mantém a primeira (a herdada), descartando o PATH do
  // preset em silêncio (no Linux o PATH do preset vale). Correção proposta em env.ts: no Windows,
  // ao aplicar presetEnv, remover a chave existente com a mesma grafia sem caixa (ver relatório).
  it.runIf(isWin)('Windows: PATH do preset vale mesmo com grafia diferente da herdada (Path × PATH)', () => {
    const env = buildTerminalEnv(input({ base: { Path: 'C:\\Windows' }, presetEnv: { PATH: 'C:\\custom' } }))
    const keys = Object.keys(env).filter((k) => k.toLowerCase() === 'path')
    expect(keys).toHaveLength(1)
    expect(env[keys[0]!]).toBe(`${BIN_DIR};C:\\custom`)
  })
})

describe('baseEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('remove variáveis internas do Electron/Vite, NODE_OPTIONS e ORQ_* herdadas', () => {
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
    vi.stubEnv('ELECTRON_NO_ATTACH_CONSOLE', '1')
    vi.stubEnv('VITE_DEV_SERVER_URL', 'http://localhost:5173')
    vi.stubEnv('MAIN_VITE_ALGO', 'x')
    vi.stubEnv('NODE_OPTIONS', '--inspect')
    vi.stubEnv('ORQ_TOKEN', 'token-de-outro-terminal')
    vi.stubEnv('MAESTRINHO_TESTE_OK', 'sim')
    vi.stubEnv('NODE_OPTIONS_EXTRA', 'mantida')
    const env = baseEnv()
    for (const key of Object.keys(env)) {
      expect(key).not.toMatch(/^(ELECTRON_|VITE_|MAIN_VITE_|ORQ_)/i)
      expect(key.toUpperCase()).not.toBe('NODE_OPTIONS')
    }
    expect(env.MAESTRINHO_TESTE_OK).toBe('sim')
    expect(env.NODE_OPTIONS_EXTRA).toBe('mantida')
  })

  it('filtra sem diferenciar maiúsculas', () => {
    vi.stubEnv('electron_run_as_node', '1')
    vi.stubEnv('orq_port', '1')
    const env = baseEnv()
    expect(Object.keys(env).some((k) => /^(electron_|orq_)/i.test(k))).toBe(false)
  })

  it('define TERM=xterm-256color e COLORTERM=truecolor', () => {
    vi.stubEnv('TERM', 'dumb')
    const env = baseEnv()
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
  })

  it('combinado com buildTerminalEnv: o terminal recebe as ORQ_* do app, não as herdadas', () => {
    vi.stubEnv('ORQ_TOKEN', 'token-de-outro-terminal')
    vi.stubEnv('ORQ_TERMINAL_ID', 'outro')
    const env = buildTerminalEnv(input({ base: baseEnv() }))
    expect(env.ORQ_TOKEN).toBe('tok-123')
    expect(env.ORQ_TERMINAL_ID).toBe('t-abc')
  })
})
