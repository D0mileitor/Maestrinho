import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IdleTransition } from '@shared/idle'
import type { PtyDataEvent, TerminalRuntimeInfo } from '@shared/runtime'
import { PtyManager, type TerminalSpec } from './PtyManager'
import { baseEnv } from './shell'

const isWin = process.platform === 'win32'

// ------------------------------------------------------------------ utilitários comuns

interface Recorder {
  data: PtyDataEvent[]
  infos: TerminalRuntimeInfo[]
  activity: IdleTransition[]
  exits: number[]
  /** Saída bruta concatenada. */
  raw(): string
}

function record(mgr: PtyManager, id: string): Recorder {
  const r: Recorder = {
    data: [],
    infos: [],
    activity: [],
    exits: [],
    raw: () => r.data.map((d) => d.data).join('')
  }
  mgr.on('data', (e) => {
    if (e.id === id) r.data.push(e)
  })
  mgr.on('info', (i) => {
    if (i.id === id) r.infos.push(i)
  })
  mgr.on('activity', (tid, t) => {
    if (tid === id) r.activity.push(t)
  })
  mgr.on('exit', (tid, code) => {
    if (tid === id) r.exits.push(code)
  })
  return r
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Script que grava argv em DUMP_FILE (para conferir como os argumentos chegam ao processo). */
const DUMP_ARGS_SCRIPT = "require('node:fs').writeFileSync(process.env.DUMP_FILE, JSON.stringify(process.argv.slice(2)))\n"

// ------------------------------------------------------------------ integração real (node-pty)

/**
 * Shell real da plataforma. No Windows, PowerShell com -NoLogo -NoProfile; o -Command só desliga a
 * gravação do histórico do PSReadLine, para os comandos do teste não irem para o histórico do usuário.
 */
const SHELL = isWin
  ? {
      command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NoExit', '-Command', 'try { Set-PSReadLineOption -HistorySaveStyle SaveNothing } catch {}']
    }
  : { command: '/bin/sh', args: [] as string[] }

/** Última linha da tela quando o shell está esperando comando. */
const PROMPT = isWin ? /^PS [^>]*>$/ : /[$#]$/

/** Comandos equivalentes nos dois shells; o texto esperado nunca aparece literalmente no eco do comando. */
const cmd = {
  marker: (n: number): string => (isWin ? `Write-Output ('MARC' + 'ADOR_' + (${n}+1))` : `echo "MARC""ADOR_$((${n}+1))"`),
  size: isWin
    ? `Write-Output ('TAM=' + $Host.UI.RawUI.WindowSize.Width + 'x' + $Host.UI.RawUI.WindowSize.Height)`
    : 'echo "TAM=$(stty size)"',
  sizeOutput: (cols: number, rows: number): string => (isWin ? `TAM=${cols}x${rows}` : `TAM=${rows} ${cols}`)
}

function shellSpec(id: string, extra: Partial<TerminalSpec> = {}): TerminalSpec {
  const env = baseEnv()
  if (!isWin) {
    env.PS1 = '$ '
    env.HISTFILE = '/dev/null'
  }
  return {
    id,
    command: SHELL.command,
    args: SHELL.args,
    cwd: os.tmpdir(),
    env,
    cols: 100,
    rows: 30,
    idleMs: 400,
    idlePatterns: [],
    ...extra
  }
}

const WAIT = { timeout: 30_000, interval: 100 }
const TEST_TIMEOUT = 90_000

async function waitPrompt(mgr: PtyManager, id: string): Promise<void> {
  await vi.waitFor(() => expect(mgr.readText(id, 1)).toMatch(PROMPT), WAIT)
}

async function waitText(mgr: PtyManager, id: string, text: string): Promise<void> {
  await vi.waitFor(() => expect(mgr.readText(id, 500)).toContain(text), WAIT)
}

/** Digita um comando (sem marcar como entrada do usuário), espera a saída e a volta do prompt. */
async function run(mgr: PtyManager, id: string, command: string, expected: string): Promise<void> {
  expect(mgr.writeRaw(id, `${command}\r`)).toBe(true)
  await waitText(mgr, id, expected)
  await waitPrompt(mgr, id)
}

describe('PtyManager com node-pty real', () => {
  let mgr: PtyManager
  let tmp = ''

  beforeEach(() => {
    mgr = new PtyManager()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-pty-'))
  })

  afterEach(() => {
    mgr.disposeAll()
    mgr.removeAllListeners()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it(
    'inicia o shell: status running com pid e eventos de dados com seq 1, 2, 3...',
    async () => {
      const id = 't-inicio'
      const r = record(mgr, id)
      const info = mgr.create(shellSpec(id))
      expect(info).toMatchObject({ id, status: 'running', activity: 'idle', cols: 100, rows: 30, attentionSeq: 0 })
      expect(info.pid).toBeGreaterThan(0)
      expect(info.commandLine).toContain(SHELL.command)
      expect(r.infos[0]?.status).toBe('running')
      await waitPrompt(mgr, id)
      expect(r.data.length).toBeGreaterThan(0)
      expect(r.data.map((d) => d.seq)).toEqual(r.data.map((_, i) => i + 1))
      expect(mgr.has(id)).toBe(true)
      expect(mgr.ids()).toEqual([id])
    },
    TEST_TIMEOUT
  )

  it(
    'create é idempotente: devolve o estado atual sem iniciar outro processo',
    async () => {
      const id = 't-idem'
      const first = mgr.create(shellSpec(id))
      const second = mgr.create(shellSpec(id, { cols: 50 }))
      expect(second.pid).toBe(first.pid)
      expect(second.cols).toBe(100)
      expect(mgr.ids()).toEqual([id])
    },
    TEST_TIMEOUT
  )

  it(
    'attach: snapshot com o marcador, seq igual ao último bloco emitido, e o snapshot reconstrói a tela',
    async () => {
      const id = 't-attach'
      const r = record(mgr, id)
      mgr.create(shellSpec(id))
      await waitPrompt(mgr, id)
      await run(mgr, id, cmd.marker(41), 'MARCADOR_42')

      const a = mgr.attach(id)!
      expect(a.info.status).toBe('running')
      expect(a.seq).toBe(r.data[r.data.length - 1]!.seq)
      expect(a.snapshot).toContain('MARCADOR_42')

      // O renderer reconstrói a tela escrevendo o snapshot num xterm novo.
      const replay = new HeadlessTerminal({ cols: a.info.cols, rows: a.info.rows, scrollback: 1000, allowProposedApi: true })
      await new Promise<void>((resolve) => replay.write(a.snapshot, resolve))
      const lines: string[] = []
      for (let y = 0; y < replay.buffer.active.length; y++) lines.push(replay.buffer.active.getLine(y)?.translateToString(true) ?? '')
      replay.dispose()
      expect(lines.join('\n')).toContain('MARCADOR_42')

      // Blocos posteriores ao attach têm seq maior que o do snapshot.
      const before = r.data.length
      await run(mgr, id, cmd.marker(99), 'MARCADOR_100')
      const after = r.data.slice(before)
      expect(after.length).toBeGreaterThan(0)
      expect(after.every((d) => d.seq > a.seq)).toBe(true)
    },
    TEST_TIMEOUT
  )

  it(
    'readText devolve texto limpo (sem ANSI) e respeita o número de linhas',
    async () => {
      const id = 't-read'
      mgr.create(shellSpec(id))
      await waitPrompt(mgr, id)
      await run(mgr, id, cmd.marker(41), 'MARCADOR_42')
      const text = mgr.readText(id, 200)!
      expect(text).toContain('MARCADOR_42')
      expect(text).not.toMatch(/[\x1b\r]/)
      const last = mgr.readText(id, 1)!
      expect(last).not.toContain('\n')
      expect(last).toMatch(PROMPT)
      expect(mgr.readText(id, 3)!.split('\n').length).toBeLessThanOrEqual(3)
      expect(mgr.readText('nao-existe', 5)).toBeNull()
      expect(mgr.lastActivity(id)).toBeGreaterThan(Date.now() - 60_000)
      expect(mgr.lastActivity('nao-existe')).toBe(Number.NEGATIVE_INFINITY)
    },
    TEST_TIMEOUT
  )

  it(
    'resize: atualiza o estado e o processo enxerga o novo tamanho',
    async () => {
      const id = 't-resize'
      mgr.create(shellSpec(id))
      await waitPrompt(mgr, id)
      mgr.resize(id, 120, 40)
      expect(mgr.info(id)).toMatchObject({ cols: 120, rows: 40 })
      await run(mgr, id, cmd.size, cmd.sizeOutput(120, 40))
    },
    TEST_TIMEOUT
  )

  it(
    'inject raw (shell): executa o comando; várias linhas viram vários comandos; envios concorrentes ficam em ordem',
    async () => {
      const id = 't-inject'
      mgr.create(shellSpec(id))
      await waitPrompt(mgr, id)
      const opts = { inputMode: 'raw' as const, submitDelayMs: 50, isShell: true }
      await mgr.inject(id, cmd.marker(6), opts)
      await waitText(mgr, id, 'MARCADOR_7')
      await waitPrompt(mgr, id)

      await mgr.inject(id, `${cmd.marker(10)}\n${cmd.marker(20)}`, opts)
      await waitText(mgr, id, 'MARCADOR_21')
      expect(mgr.readText(id, 500)).toContain('MARCADOR_11')
      await waitPrompt(mgr, id)

      await Promise.all([mgr.inject(id, cmd.marker(100), opts), mgr.inject(id, cmd.marker(200), opts), mgr.inject(id, cmd.marker(300), opts)])
      await waitText(mgr, id, 'MARCADOR_301')
      const text = mgr.readText(id, 500)!
      const at = (s: string): number => text.lastIndexOf(s)
      expect(at('MARCADOR_101')).toBeGreaterThan(-1)
      expect(at('MARCADOR_101')).toBeLessThan(at('MARCADOR_201'))
      expect(at('MARCADOR_201')).toBeLessThan(at('MARCADOR_301'))
    },
    TEST_TIMEOUT
  )

  it(
    'saída do processo: evento exit com o código, status exited e aviso na tela; escrita depois falha',
    async () => {
      const id = 't-exit'
      const r = record(mgr, id)
      mgr.create(shellSpec(id))
      await waitPrompt(mgr, id)
      mgr.writeRaw(id, 'exit 3\r')
      await vi.waitFor(() => expect(r.exits).toEqual([3]), WAIT)
      expect(mgr.info(id)).toMatchObject({ status: 'exited', exitCode: 3, activity: 'idle', pid: undefined })
      await waitText(mgr, id, '[processo encerrado com código 3]')
      expect(mgr.writeRaw(id, 'x')).toBe(false)
      await expect(mgr.inject(id, 'x', { inputMode: 'raw', submitDelayMs: 0, isShell: true })).rejects.toThrow(
        'o processo do terminal não está em execução'
      )
      // O terminal continua registrado (o nó pode reiniciá-lo).
      expect(mgr.has(id)).toBe(true)
    },
    TEST_TIMEOUT
  )

  it(
    'restart: novo processo (outro pid), tela limpa e sem evento exit do processo antigo',
    async () => {
      const id = 't-restart'
      const r = record(mgr, id)
      const first = mgr.create(shellSpec(id))
      await waitPrompt(mgr, id)
      await run(mgr, id, cmd.marker(41), 'MARCADOR_42')

      const info = mgr.restart(id)!
      expect(info.status).toBe('running')
      expect(info.pid).toBeGreaterThan(0)
      expect(info.pid).not.toBe(first.pid)
      expect(r.raw()).toContain('\x1bc')
      // O espelho processa o RIS de forma assíncrona: a tela antiga some logo depois, antes do prompt novo.
      await vi.waitFor(() => expect(mgr.readText(id, 500)).not.toContain('MARCADOR_42'), WAIT)
      await waitPrompt(mgr, id)
      expect(mgr.readText(id, 500)).not.toContain('MARCADOR_42')
      await run(mgr, id, cmd.marker(1), 'MARCADOR_2')
      await vi.waitFor(() => expect(isAlive(first.pid!)).toBe(false), WAIT)
      expect(r.exits).toEqual([])

      // Reiniciar depois de o processo sair também funciona.
      mgr.writeRaw(id, 'exit 5\r')
      await vi.waitFor(() => expect(r.exits).toEqual([5]), WAIT)
      expect(mgr.restart(id)?.status).toBe('running')
      await waitPrompt(mgr, id)
      expect(mgr.restart('nao-existe')).toBeUndefined()
    },
    TEST_TIMEOUT
  )

  it(
    'dispose mata o processo, descarta o terminal e para de emitir eventos',
    async () => {
      const id = 't-dispose'
      const r = record(mgr, id)
      const { pid } = mgr.create(shellSpec(id))
      await waitPrompt(mgr, id)
      expect(isAlive(pid!)).toBe(true)
      mgr.dispose(id)
      expect(mgr.has(id)).toBe(false)
      expect(mgr.info(id)).toBeUndefined()
      expect(mgr.attach(id)).toBeNull()
      expect(mgr.readText(id, 5)).toBeNull()
      const count = r.data.length
      await vi.waitFor(() => expect(isAlive(pid!)).toBe(false), WAIT)
      await sleep(300)
      expect(r.data.length).toBe(count)
      expect(r.exits).toEqual([])
      // Operações num terminal descartado não lançam.
      expect(() => mgr.resize(id, 80, 24)).not.toThrow()
      expect(() => mgr.dispose(id)).not.toThrow()
    },
    TEST_TIMEOUT
  )

  it(
    'ociosidade: após idleMs sem saída fica ocioso (primeira vez = pronto); nova saída volta a ocupado',
    async () => {
      const id = 't-idle'
      const r = record(mgr, id)
      mgr.create(shellSpec(id, { idleMs: 500 }))
      await vi.waitFor(() => expect(r.activity.some((t) => t.state === 'idle' && t.firstIdle)).toBe(true), WAIT)
      expect(r.activity[0]?.state).toBe('busy')
      expect(mgr.info(id)).toMatchObject({ activity: 'idle', ready: true })
      expect(r.activity.filter((t) => t.firstIdle)).toHaveLength(1)

      const seen = r.activity.length
      mgr.writeRaw(id, `${cmd.marker(41)}\r`)
      await vi.waitFor(() => {
        const later = r.activity.slice(seen)
        expect(later[0]?.state).toBe('busy')
        expect(later.some((t) => t.state === 'idle' && t.firstIdle === false && t.reason === 'timeout')).toBe(true)
      }, WAIT)
      const idle = r.activity.slice(seen).find((t) => t.state === 'idle')!
      expect(idle.busyMs).toBeGreaterThanOrEqual(0)
      expect(mgr.info(id)?.activity).toBe('idle')
    },
    TEST_TIMEOUT
  )

  it(
    'padrão de prompt declara ociosidade bem antes do idleMs (motivo "pattern")',
    async () => {
      const id = 't-pattern'
      const r = record(mgr, id)
      const idlePatterns = isWin ? ['^PS [^>]*>\\s?$'] : ['[$#]\\s?$']
      mgr.create(shellSpec(id, { idleMs: 120_000, idlePatterns }))
      await vi.waitFor(() => expect(r.activity.some((t) => t.state === 'idle')).toBe(true), WAIT)
      expect(r.activity.find((t) => t.state === 'idle')?.reason).toBe('pattern')
    },
    TEST_TIMEOUT
  )

  it('comando inexistente: status error com mensagem amigável na tela, sem processo', async () => {
    const id = 't-erro'
    const r = record(mgr, id)
    const info = mgr.create(shellSpec(id, { command: 'comando-inexistente-maestrinho-xyz', args: [] }))
    expect(info.status).toBe('error')
    expect(info.pid).toBeUndefined()
    expect(info.error).toBe(
      'Comando "comando-inexistente-maestrinho-xyz" não encontrado no PATH. Instale o agente ou edite o preset.'
    )
    expect(r.raw()).toContain('não encontrado no PATH')
    await waitText(mgr, id, 'não encontrado no PATH')
    expect(mgr.writeRaw(id, 'x')).toBe(false)
    await expect(mgr.inject(id, 'x', { inputMode: 'raw', submitDelayMs: 0, isShell: false })).rejects.toThrow(
      'o processo do terminal não está em execução'
    )
    await expect(mgr.inject('nao-existe', 'x', { inputMode: 'raw', submitDelayMs: 0, isShell: false })).rejects.toThrow(
      'terminal inexistente'
    )
    expect(mgr.restart(id)?.status).toBe('error')
  })

  it('selo e espera por peer: emitem info só quando mudam; info() devolve cópia', () => {
    const id = 't-selo'
    const r = record(mgr, id)
    mgr.create(shellSpec(id, { command: 'comando-inexistente-maestrinho-xyz', args: [] }))
    const before = r.infos.length
    mgr.setBadge(id, 'revisando')
    mgr.setWaitingOn(id, 'revisor')
    mgr.setWaitingOn(id, 'revisor')
    expect(r.infos.length).toBe(before + 2)
    expect(mgr.info(id)).toMatchObject({ badge: 'revisando', waitingOn: 'revisor' })
    const copy = mgr.info(id)!
    copy.badge = 'alterado'
    expect(mgr.info(id)?.badge).toBe('revisando')
    mgr.setWaitingOn(id, undefined)
    expect(mgr.info(id)?.waitingOn).toBeUndefined()
    expect(() => mgr.setBadge('nao-existe', 'x')).not.toThrow()
  })

  it(
    'argumentos chegam intactos ao processo (espaços, aspas internas, barras, %, &, vazio, quebra de linha)',
    async () => {
      const id = 't-args'
      const r = record(mgr, id)
      const script = path.join(tmp, 'dump.js')
      const out = path.join(tmp, 'argv.json')
      fs.writeFileSync(script, DUMP_ARGS_SCRIPT)
      const args = ['simples', 'com espaço', 'a"b', 'trail\\', 'trail2\\\\', 'bs2\\\\"x', '', 'linha1\nlinha2', 'tab\tx', '%PATH%', 'a&b', 'ação']
      mgr.create(shellSpec(id, { command: process.execPath, args: [script, ...args], env: { ...baseEnv(), DUMP_FILE: out }, cwd: tmp }))
      await vi.waitFor(() => expect(r.exits).toEqual([0]), WAIT)
      expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual(args)
    },
    TEST_TIMEOUT
  )

  // Regressão (Windows): com os argumentos em array, o node-pty deixava sem aspas um argumento que já
  // começa e termina com aspas e contém espaço, e o processo recebia vários argumentos (injeção:
  // '" --dangerously-skip-permissions "' virava 3). Agora o planSpawn monta a linha de comando.
  it(
    'argumento que começa e termina com aspas e contém espaço não é dividido (sem injeção)',
    async () => {
      const id = 't-args-aspas'
      const r = record(mgr, id)
      const script = path.join(tmp, 'dump.js')
      const out = path.join(tmp, 'argv.json')
      fs.writeFileSync(script, DUMP_ARGS_SCRIPT)
      const args = ['" --dangerously-skip-permissions "', '"aspas nas pontas"']
      mgr.create(shellSpec(id, { command: process.execPath, args: [script, ...args], env: { ...baseEnv(), DUMP_FILE: out }, cwd: tmp }))
      await vi.waitFor(() => expect(r.exits).toEqual([0]), WAIT)
      expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual(args)
    },
    TEST_TIMEOUT
  )
})

// ------------------------------------------------------------------ node-pty simulado (lógica determinística)

class FakePty {
  readonly pid: number
  readonly writes: { data: string; at: number }[] = []
  readonly resizes: [number, number][] = []
  killed = false
  /** Se definido, write lança quando o texto contém este trecho. */
  failOn: string | null = null
  resizeThrows = false
  private readonly dataListeners: ((d: string) => void)[] = []
  private readonly exitListeners: ((e: { exitCode: number; signal?: number }) => void)[] = []

  constructor(
    readonly file: string,
    readonly args: string[] | string,
    readonly options: Record<string, unknown>,
    index: number
  ) {
    this.pid = 40_000 + index
  }

  onData(listener: (d: string) => void): { dispose(): void } {
    this.dataListeners.push(listener)
    return { dispose: () => undefined }
  }

  onExit(listener: (e: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitListeners.push(listener)
    return { dispose: () => undefined }
  }

  write(data: string): void {
    if (this.failOn !== null && data.includes(this.failOn)) throw new Error('falha simulada de escrita')
    this.writes.push({ data, at: Date.now() })
  }

  resize(cols: number, rows: number): void {
    if (this.resizeThrows) throw new Error('pty já encerrado')
    this.resizes.push([cols, rows])
  }

  kill(): void {
    this.killed = true
  }

  emitData(data: string): void {
    for (const l of this.dataListeners) l(data)
  }

  emitExit(exitCode: number): void {
    for (const l of this.exitListeners) l({ exitCode })
  }

  get written(): string[] {
    return this.writes.map((w) => w.data)
  }
}

describe('PtyManager com node-pty simulado', () => {
  const fakes: FakePty[] = []
  let spawnError: Error | null = null
  let Manager: typeof PtyManager
  let mgr: PtyManager

  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('node-pty', () => ({
      spawn: (file: string, args: string[] | string, options: Record<string, unknown>): FakePty => {
        if (spawnError) throw spawnError
        const fake = new FakePty(file, args, options, fakes.length)
        fakes.push(fake)
        return fake
      }
    }))
    Manager = (await import('./PtyManager')).PtyManager
  })

  afterAll(() => {
    vi.doUnmock('node-pty')
    vi.resetModules()
  })

  beforeEach(() => {
    fakes.length = 0
    spawnError = null
    mgr = new Manager()
  })

  afterEach(() => {
    mgr.disposeAll()
    mgr.removeAllListeners()
  })

  function spec(id: string, extra: Partial<TerminalSpec> = {}): TerminalSpec {
    return { id, command: process.execPath, args: ['--versao'], cwd: os.tmpdir(), env: { FOO: 'bar' }, cols: 80, rows: 24, idleMs: 100, idlePatterns: [], ...extra }
  }

  /** Cria o terminal e leva ao estado "pronto" (primeira ociosidade), como um agente que terminou de abrir. */
  async function ready(id: string, extra: Partial<TerminalSpec> = {}): Promise<{ fake: FakePty; r: Recorder }> {
    const r = record(mgr, id)
    mgr.create(spec(id, extra))
    const fake = fakes[fakes.length - 1]!
    fake.emitData('pronto> ')
    await vi.waitFor(() => expect(mgr.info(id)?.ready).toBe(true), { timeout: 5000, interval: 10 })
    return { fake, r }
  }

  const paste = (text: string): string => `\x1b[200~${text}\x1b[201~`

  it('inicia o processo com o executável resolvido, args, cwd, env, tamanho e ConPTY empacotado', () => {
    const s = spec('t1')
    const info = mgr.create(s)
    expect(fakes).toHaveLength(1)
    const fake = fakes[0]!
    expect(fake.file).toBe(process.execPath)
    // No Windows o planSpawn entrega a linha de comando já montada (string); no Linux, o array.
    expect(fake.args).toEqual(isWin ? '--versao' : ['--versao'])
    expect(fake.options).toMatchObject({ name: 'xterm-256color', cols: 80, rows: 24, cwd: s.cwd, env: { FOO: 'bar' }, useConptyDll: isWin })
    expect(info).toMatchObject({ status: 'running', pid: fake.pid, ready: false })
  })

  it('falha ao iniciar (spawn lança): status error com mensagem e aviso na tela', () => {
    spawnError = new Error('sem ConPTY')
    const r = record(mgr, 't1')
    const info = mgr.create(spec('t1'))
    expect(info).toMatchObject({ status: 'error', error: 'Falha ao iniciar o processo: sem ConPTY', pid: undefined })
    expect(r.raw()).toContain('Falha ao iniciar o processo: sem ConPTY')
  })

  it('saída no mesmo tique vira um único bloco; seq cresce a cada bloco', async () => {
    const r = record(mgr, 't1')
    mgr.create(spec('t1'))
    const fake = fakes[0]!
    fake.emitData('a')
    fake.emitData('b')
    expect(r.data).toEqual([])
    await vi.waitFor(() => expect(r.data).toEqual([{ id: 't1', seq: 1, data: 'ab' }]), { timeout: 2000, interval: 5 })
    fake.emitData('c')
    await vi.waitFor(() => expect(r.data[1]).toEqual({ id: 't1', seq: 2, data: 'c' }), { timeout: 2000, interval: 5 })
  })

  it('saída grande (>= 64 KiB) é emitida na hora, sem esperar o timer', () => {
    const r = record(mgr, 't1')
    mgr.create(spec('t1'))
    fakes[0]!.emitData('x'.repeat(70_000))
    expect(r.data).toHaveLength(1)
    expect(r.data[0]!.data).toHaveLength(70_000)
  })

  it('attach inclui blocos emitidos ainda não processados pelo espelho e devolve o último seq', async () => {
    const r = record(mgr, 't1')
    mgr.create(spec('t1'))
    fakes[0]!.emitData('linha-1\r\n')
    const a = mgr.attach('t1')!
    // attach força o flush do que estava pendente: o bloco já tem seq e entra no snapshot (direto ou como "cauda").
    expect(r.data.map((d) => d.seq)).toEqual([1])
    expect(a.seq).toBe(1)
    expect(a.snapshot).toContain('linha-1')
    await vi.waitFor(() => expect(mgr.readText('t1', 5)).toBe('linha-1'), { timeout: 2000, interval: 5 })
    expect(mgr.attach('t1')!.snapshot).toContain('linha-1')
  })

  // Regressão: o serialize restaurava o rastreamento de mouse (1003) mas não o formato SGR (1006); o
  // renderer passava a mandar relatórios X10, que o ConPTY entregava ao Codex como texto digitado.
  it('attach preserva a codificação SGR do mouse ligada pelo programa (e o desligamento)', async () => {
    mgr.create(spec('t1'))
    const fake = fakes[0]!
    fake.emitData('\x1b[?1003;1006hpronto')
    await vi.waitFor(() => expect(mgr.readText('t1', 5)).toBe('pronto'), { timeout: 2000, interval: 5 })
    const on = mgr.attach('t1')!.snapshot
    expect(on).toContain('\x1b[?1003h')
    expect(on).toContain('\x1b[?1006h')
    fake.emitData('\x1b[?1006l fim')
    await vi.waitFor(() => expect(mgr.readText('t1', 5)).toBe('pronto fim'), { timeout: 2000, interval: 5 })
    expect(mgr.attach('t1')!.snapshot).not.toContain('\x1b[?1006h')
  })

  it('inject bracketed: cola entre \\x1b[200~ e \\x1b[201~ com texto sanitizado e envia Enter após submitDelayMs', async () => {
    const { fake } = await ready('t1')
    await mgr.inject('t1', 'oi\x1b[201~\x03\r\nlinha 2', { inputMode: 'bracketed', submitDelayMs: 80, isShell: false })
    expect(fake.written).toEqual([paste('oi[201~\nlinha 2'), '\r'])
    expect(fake.writes[1]!.at - fake.writes[0]!.at).toBeGreaterThanOrEqual(70)
  })

  it('colagem longa para agente: o Enter só sai quando a tela para de mudar (o agente terminou de receber)', async () => {
    const { fake } = await ready('t1')
    const longText = 'x'.repeat(2000)
    // O agente "absorve" a colagem redesenhando a tela por ~1 s.
    let n = 0
    const redraw = setInterval(() => {
      if (n++ < 20) fake.emitData('.')
    }, 50)
    const t0 = Date.now()
    await mgr.inject('t1', longText, { inputMode: 'bracketed', submitDelayMs: 50, isShell: false })
    clearInterval(redraw)
    const enter = fake.writes.find((w) => w.data === '\r')!
    expect(enter.at - t0).toBeGreaterThanOrEqual(1000)
    // Shell (comando colado) não espera: o Enter vai no tempo normal.
    const sh = await ready('t2')
    const t1 = Date.now()
    await mgr.inject('t2', 'y'.repeat(2000), { inputMode: 'bracketed', submitDelayMs: 50, isShell: true })
    expect(sh.fake.writes.find((w) => w.data === '\r')!.at - t1).toBeLessThan(600)
  })

  it('inject raw para agente: quebras de linha viram um espaço (o único Enter é o final)', async () => {
    const { fake } = await ready('t1')
    await mgr.inject('t1', 'a\n\nb\r\nc', { inputMode: 'raw', submitDelayMs: 0, isShell: false })
    expect(fake.written).toEqual(['a b c', '\r'])
  })

  it('inject raw para shell: cada linha vira um comando (\\n → \\r)', async () => {
    const { fake } = await ready('t1')
    await mgr.inject('t1', 'cmd1\ncmd2', { inputMode: 'raw', submitDelayMs: 0, isShell: true })
    expect(fake.written).toEqual(['cmd1\rcmd2', '\r'])
  })

  it('injeções concorrentes são serializadas: a segunda só começa depois do Enter da primeira', async () => {
    const { fake } = await ready('t1')
    const opts = { inputMode: 'bracketed' as const, submitDelayMs: 40, isShell: false }
    await Promise.all([mgr.inject('t1', 'um', opts), mgr.inject('t1', 'dois', opts), mgr.inject('t1', 'tres', opts)])
    expect(fake.written).toEqual([paste('um'), '\r', paste('dois'), '\r', paste('tres'), '\r'])
  })

  it('falha numa injeção rejeita só ela; as seguintes continuam', async () => {
    const { fake } = await ready('t1')
    fake.failOn = 'BOOM'
    const opts = { inputMode: 'bracketed' as const, submitDelayMs: 0, isShell: false }
    const bad = mgr.inject('t1', 'BOOM', opts)
    const good = mgr.inject('t1', 'ok', opts)
    await expect(bad).rejects.toThrow('falha simulada de escrita')
    await expect(good).resolves.toBeUndefined()
    expect(fake.written).toEqual([paste('ok'), '\r'])
  })

  it('entrada do usuário: o eco logo após digitar não marca o terminal como ocupado', async () => {
    const { fake, r } = await ready('t1')
    const seen = r.activity.length
    mgr.writeUser('t1', 'a')
    expect(fake.written).toEqual(['a'])
    fake.emitData('a')
    await sleep(250)
    expect(r.activity.slice(seen)).toEqual([])
    expect(mgr.info('t1')?.activity).toBe('idle')
    // Fora da janela de eco, saída é atividade real.
    fake.emitData('resposta')
    await vi.waitFor(() => expect(r.activity.slice(seen)[0]?.state).toBe('busy'), { timeout: 2000, interval: 5 })
  })

  it('lastUserInputAt registra só a digitação do usuário (não injeções nem escritas diretas)', async () => {
    const { fake } = await ready('t1')
    expect(mgr.lastUserInputAt('t1')).toBe(Number.NEGATIVE_INFINITY)
    await mgr.inject('t1', 'mensagem', { inputMode: 'bracketed', submitDelayMs: 0, isShell: false })
    mgr.writeRaw('t1', 'x')
    expect(mgr.lastUserInputAt('t1')).toBe(Number.NEGATIVE_INFINITY)
    const before = Date.now()
    mgr.writeUser('t1', 'a')
    expect(mgr.lastUserInputAt('t1')).toBeGreaterThanOrEqual(before)
    expect(mgr.lastUserInputAt('t1')).toBeLessThanOrEqual(Date.now())
    expect(fake.written).toEqual([paste('mensagem'), '\r', 'x', 'a'])
    expect(mgr.lastUserInputAt('nao-existe')).toBe(Number.NEGATIVE_INFINITY)
  })

  it('escritas sem processo são ignoradas (writeUser) ou recusadas (writeRaw)', () => {
    mgr.create(spec('t1'))
    fakes[0]!.emitExit(0)
    expect(() => mgr.writeUser('t1', 'a')).not.toThrow()
    expect(mgr.writeRaw('t1', 'a')).toBe(false)
    expect(mgr.writeRaw('nao-existe', 'a')).toBe(false)
    expect(fakes[0]!.written).toEqual([])
  })

  it('resize: limita valores, ignora tamanho igual, repassa ao processo e o redesenho não conta como atividade', async () => {
    const { fake, r } = await ready('t1')
    const seen = r.activity.length
    mgr.resize('t1', 120.7, 40.2)
    expect(fake.resizes).toEqual([[120, 40]])
    expect(mgr.info('t1')).toMatchObject({ cols: 120, rows: 40 })
    mgr.resize('t1', 120, 40)
    expect(fake.resizes).toHaveLength(1)
    mgr.resize('t1', 1, 0)
    mgr.resize('t1', 5000, 5000)
    expect(fake.resizes.slice(1)).toEqual([
      [2, 1],
      [1000, 500]
    ])
    fake.emitData('\x1b[2J redesenho da TUI')
    await sleep(250)
    expect(r.activity.slice(seen)).toEqual([])
    fake.resizeThrows = true
    expect(() => mgr.resize('t1', 90, 30)).not.toThrow()
    expect(() => mgr.resize('nao-existe', 90, 30)).not.toThrow()
  })

  it('atenção: conta só após trabalho real (>= 1,5 s), não na inicialização, rajadas curtas ou esperando peer', async () => {
    // idleMs folgado (300 ms) diante dos intervalos de 40 ms entre blocos: carga na máquina não encerra o trabalho antes.
    const { fake, r } = await ready('t1', { idleMs: 300 })
    expect(mgr.info('t1')?.attentionSeq).toBe(0)

    // Rajada curta: ocupado e ocioso, mas sem atenção.
    fake.emitData('x')
    await vi.waitFor(() => expect(r.activity.filter((t) => t.state === 'idle')).toHaveLength(2), { timeout: 3000, interval: 10 })
    expect(mgr.info('t1')?.attentionSeq).toBe(0)

    const work = async (): Promise<void> => {
      const start = Date.now()
      while (Date.now() - start < 1700) {
        fake.emitData('.')
        await sleep(40)
      }
    }
    await work()
    await vi.waitFor(() => expect(mgr.info('t1')?.attentionSeq).toBe(1), { timeout: 3000, interval: 10 })
    const lastIdle = r.activity.filter((t) => t.state === 'idle').pop()!
    expect(lastIdle.busyMs).toBeGreaterThanOrEqual(1500)

    // Esperando outro agente (orq send --wait): o "terminou" não chama atenção.
    mgr.setWaitingOn('t1', 'revisor')
    const idles = r.activity.filter((t) => t.state === 'idle').length
    await work()
    await vi.waitFor(() => expect(r.activity.filter((t) => t.state === 'idle').length).toBe(idles + 1), {
      timeout: 3000,
      interval: 10
    })
    expect(mgr.info('t1')?.attentionSeq).toBe(1)
  })

  it('estado exato: o aviso "trabalhando" segura o ocupado no silêncio; o Stop avisa que terminou', async () => {
    const { r } = await ready('t1', { idleMs: 100 })
    mgr.agentSignal('t1', 'working', Date.now())
    expect(mgr.info('t1')).toMatchObject({ activity: 'busy', exact: true })
    await sleep(1600)
    // Muito além do idleMs sem saída: continua ocupado (ex.: um comando longo sem saída).
    expect(mgr.info('t1')?.activity).toBe('busy')
    mgr.agentSignal('t1', 'done', Date.now())
    expect(mgr.info('t1')).toMatchObject({ activity: 'idle', attentionSeq: 1, attentionKind: 'done', needsInput: false })
    expect(r.activity[r.activity.length - 1]).toMatchObject({ state: 'idle', reason: 'signal' })
  })

  it('estado exato: pedido de aprovação avisa na hora e aviso atrasado (fora de ordem) é descartado', async () => {
    await ready('t1', { idleMs: 100 })
    const t0 = Date.now()
    mgr.agentSignal('t1', 'working', t0)
    mgr.agentSignal('t1', 'needsInput', t0 + 10)
    expect(mgr.info('t1')).toMatchObject({ activity: 'idle', attentionSeq: 1, attentionKind: 'waiting', needsInput: true })
    mgr.agentSignal('t1', 'working', t0 + 5)
    expect(mgr.info('t1')).toMatchObject({ activity: 'idle', needsInput: true })
    // Esperando outro agente (orq send --wait): nem o pedido de aprovação chama atenção.
    mgr.setWaitingOn('t1', 'revisor')
    mgr.agentSignal('t1', 'working', t0 + 20)
    mgr.agentSignal('t1', 'needsInput', t0 + 30)
    expect(mgr.info('t1')?.attentionSeq).toBe(1)
  })

  it('estado exato: o silêncio não chama atenção e Esc (interrupção) volta à detecção pelo silêncio', async () => {
    const { fake, r } = await ready('t1', { idleMs: 100 })
    mgr.agentSignal('t1', 'working', Date.now())
    const start = Date.now()
    while (Date.now() - start < 1700) {
      fake.emitData('.')
      await sleep(40)
    }
    expect(mgr.info('t1')?.activity).toBe('busy')
    mgr.writeUser('t1', '\x1b')
    const idles = r.activity.filter((t) => t.state === 'idle').length
    await vi.waitFor(() => expect(r.activity.filter((t) => t.state === 'idle').length).toBe(idles + 1), { timeout: 3000, interval: 10 })
    expect(mgr.info('t1')?.attentionSeq).toBe(0)
  })

  it('Codex: a notificação OSC 9 do terminal vira "precisa de você"; sem o modo ligado é ignorada', async () => {
    const { fake } = await ready('t1', { idleMs: 100, agentEvents: 'codex' })
    fake.emitData('\x1b]9;4;1;30\x07')
    await sleep(100)
    expect(mgr.info('t1')?.exact).toBeUndefined()
    fake.emitData('\x1b]9;Approval requested: npm test\x07')
    await vi.waitFor(() => expect(mgr.info('t1')).toMatchObject({ exact: true, attentionKind: 'waiting', attentionSeq: 1 }), { timeout: 3000, interval: 10 })

    const other = await ready('t2', { idleMs: 100 })
    other.fake.emitData('\x1b]9;Approval requested: npm test\x07')
    await sleep(300)
    expect(mgr.info('t2')?.exact).toBeUndefined()
    expect(mgr.info('t2')?.attentionSeq).toBe(0)
  })

  it('padrões de ociosidade: casam a linha do cursor; updateSpec troca os padrões compilados', async () => {
    const r = record(mgr, 't1')
    // A linha testada inclui os espaços finais escritos pelo programa ("PRONTO> "), por isso o \s*$
    // (os padrões de fábrica usam \s?$ pelo mesmo motivo).
    mgr.create(spec('t1', { idleMs: 60_000, idlePatterns: ['PRONTO>\\s*$'] }))
    const fake = fakes[0]!
    fake.emitData('trabalhando...\r\nPRONTO> ')
    await vi.waitFor(() => expect(r.activity.find((t) => t.state === 'idle')?.reason).toBe('pattern'), {
      timeout: 3000,
      interval: 10
    })
    mgr.updateSpec('t1', { idlePatterns: [] })
    const seen = r.activity.length
    fake.emitData('\r\nde novo\r\nPRONTO> ')
    await vi.waitFor(() => expect(r.activity.slice(seen)[0]?.state).toBe('busy'), { timeout: 2000, interval: 5 })
    await sleep(500)
    expect(r.activity.slice(seen).some((t) => t.state === 'idle')).toBe(false)
  })

  it('processo encerra: idle forçado, status exited, aviso na tela e evento exit', async () => {
    const r = record(mgr, 't1')
    mgr.create(spec('t1', { idleMs: 60_000 }))
    const fake = fakes[0]!
    fake.emitData('trabalhando')
    await vi.waitFor(() => expect(mgr.info('t1')?.activity).toBe('busy'), { timeout: 2000, interval: 5 })
    fake.emitExit(9)
    expect(r.exits).toEqual([9])
    expect(r.activity[r.activity.length - 1]).toMatchObject({ state: 'idle' })
    expect(mgr.info('t1')).toMatchObject({ status: 'exited', exitCode: 9, activity: 'idle', pid: undefined })
    expect(r.raw()).toContain('[processo encerrado com código 9]')
  })

  it('restart: mata o processo antigo, ignora eventos dele e reseta a tela (RIS)', async () => {
    const r = record(mgr, 't1')
    mgr.create(spec('t1'))
    const old = fakes[0]!
    old.emitData('antes\r\n')
    await vi.waitFor(() => expect(mgr.readText('t1', 5)).toContain('antes'), { timeout: 2000, interval: 5 })
    mgr.setBadge('t1', 'selo')
    const info = mgr.restart('t1', spec('t1', { cols: 999, args: ['--novo'] }))!
    expect(old.killed).toBe(true)
    expect(fakes).toHaveLength(2)
    const fresh = fakes[1]!
    expect(fresh.args).toEqual(isWin ? '--novo' : ['--novo'])
    // O tamanho atual é mantido mesmo com spec novo.
    expect(fresh.options).toMatchObject({ cols: 80, rows: 24 })
    expect(info).toMatchObject({ status: 'running', pid: fresh.pid, badge: undefined })
    expect(r.raw()).toContain('\x1bc')
    old.emitData('velho')
    old.emitExit(1)
    await sleep(50)
    expect(r.raw()).not.toContain('velho')
    expect(r.exits).toEqual([])
    await vi.waitFor(() => expect(mgr.readText('t1', 5)).toBe(''), { timeout: 2000, interval: 5 })
  })

  it('dispose mata o processo e nada mais é emitido; disposeAll descarta todos', async () => {
    const r = record(mgr, 't1')
    mgr.create(spec('t1'))
    mgr.create(spec('t2'))
    const [a, b] = fakes
    a!.emitData('pendente')
    mgr.dispose('t1')
    expect(a!.killed).toBe(true)
    a!.emitData('depois')
    a!.emitExit(0)
    await sleep(50)
    expect(r.data).toEqual([])
    expect(r.exits).toEqual([])
    mgr.disposeAll()
    expect(b!.killed).toBe(true)
    expect(mgr.ids()).toEqual([])
  })
})
