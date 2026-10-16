import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { RoutinesState } from '@shared/ipc'
import type { Routine, TerminalNodeData } from '@shared/schemas'
import { AgentPresetSchema } from '@shared/schemas'
import { WorkspaceStore, emptyDoc, ensureMetaDir } from '../store/WorkspaceStore'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import type { PtyManager } from '../pty/PtyManager'
import type { TerminalService } from '../terminals/TerminalService'
import { RoutineService } from './RoutineService'

/** PTY falso: cada injeção gera ~300 ms de "atividade" e depois fica ocioso. */
class FakePty {
  status: 'running' | 'exited' = 'running'
  activity: 'idle' | 'busy' = 'idle'
  last = 0
  sent: string[] = []
  info(): { status: string; activity: string; attentionSeq: number } | undefined {
    return { status: this.status, activity: this.activity, attentionSeq: 0 }
  }
  lastActivity(): number {
    return this.last
  }
  async inject(_id: string, text: string): Promise<void> {
    this.sent.push(text)
    this.activity = 'busy'
    this.last = Date.now() + 1
    setTimeout(() => {
      this.last = Date.now()
      this.activity = 'idle'
    }, 300)
  }
}

const terminal: TerminalNodeData = {
  id: 't1',
  kind: 'terminal',
  name: 'agente',
  presetId: 'shell',
  cwd: '',
  autoStart: true,
  position: { x: 0, y: 0 },
  size: { w: 600, h: 420 }
}

function routine(patch: Partial<Routine> = {}): Routine {
  return {
    id: 'rt1',
    name: 'Testes',
    targetId: 't1',
    script: 'passo um\n&&\npasso dois\n&&\npasso três',
    intervalMinutes: 10,
    enabled: true,
    skipIfBusy: true,
    notifyOnRun: false,
    trigger: { kind: 'interval' },
    maxPerHour: 12,
    createdAt: new Date().toISOString(),
    ...patch
  }
}

async function until(cond: () => boolean, ms = 15_000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('tempo esgotado esperando condição')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('RoutineService', () => {
  let root: string
  let ws: WorkspaceStore
  let pty: FakePty
  let service: RoutineService
  let last: RoutinesState | null

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-routine-'))
    await ensureMetaDir(root)
    ws = new WorkspaceStore(root, { ...emptyDoc(root), nodes: [terminal] })
    pty = new FakePty()
    last = null
    service = new RoutineService({
      workspaces: {} as unknown as WorkspaceManager,
      ptys: pty as unknown as PtyManager,
      terminals: {
        node: (id: string) => (id === 't1' ? terminal : undefined),
        presetFor: () => AgentPresetSchema.parse({ id: 'shell', label: 'Shell', command: 'x' })
      } as unknown as TerminalService,
      notify: () => undefined,
      onChanged: (_dir, state) => {
        last = state
      }
    })
    service.load(ws)
  })

  afterEach(() => {
    service.stop()
    // Grava o workspace.json pendente (debounce de 400 ms) antes de apagar a pasta.
    ws.flushSync()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('salva, persiste em routines.json e recarrega', async () => {
    service.save(root, routine())
    service.unload(root)
    const file = path.join(root, '.maestrinho', 'routines.json')
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).routines).toHaveLength(1)
    service.load(ws)
    expect(service.state(root).routines[0]!.name).toBe('Testes')
  })

  it('recusa rotina sem passos ou com terminal inexistente', () => {
    expect(() => service.save(root, routine({ script: '&&\n  \n&&' }))).toThrow(/passo/)
    expect(() => service.save(root, routine({ targetId: 'nao-existe' }))).toThrow(/terminal alvo/)
  })

  it('executa os 3 passos em ordem, cada um após o anterior ficar ocioso', async () => {
    service.save(root, routine())
    service.runNow(root, 'rt1')
    await until(() => (last?.history.length ?? 0) > 0)
    expect(pty.sent).toEqual(['passo um', 'passo dois', 'passo três'])
    const run = service.state(root).history[0]!
    expect(run.outcome).toBe('completed')
    expect(run.stepsSent).toBe(3)
    expect(service.state(root).routines[0]!.lastRunAt).toBeDefined()
  }, 30_000)

  it('registra terminalNotRunning quando o alvo está parado', async () => {
    pty.status = 'exited'
    service.save(root, routine())
    service.runNow(root, 'rt1')
    await until(() => (last?.history.length ?? 0) > 0)
    expect(service.state(root).history[0]!.outcome).toBe('terminalNotRunning')
    expect(pty.sent).toEqual([])
  })

  it('gatilho por evento: dispara com o texto preenchido e não pelo relógio', async () => {
    service.save(root, routine({ script: '{origem} terminou; revise {arquivos}', trigger: { kind: 'agentDone', sourceId: 'construtor-id' } }))
    expect(service.state(root).routines[0]!.trigger).toEqual({ kind: 'agentDone', sourceId: 'construtor-id' })
    service.onEvent(root, { kind: 'agentDone', terminalId: 'outro' }, { origem: 'x' })
    service.onEvent(root, { kind: 'agentDone', terminalId: 'construtor-id' }, { origem: 'construtor' }, 'construtor terminou')
    await until(() => (last?.history.length ?? 0) > 0)
    expect(pty.sent).toEqual(['construtor terminou; revise {arquivos}'])
    expect(service.state(root).history[0]).toMatchObject({ outcome: 'completed', detail: 'construtor terminou' })
  })

  it('gatilho de arquivos preenche {arquivos} só com os que batem com o padrão', async () => {
    service.save(root, routine({ script: 'Rode os testes de {arquivos}', trigger: { kind: 'fileChange', pattern: 'src/**/*.ts' } }))
    expect(service.hasFileTriggers(root)).toBe(true)
    service.onEvent(root, { kind: 'fileChange', files: ['README.md'] })
    service.onEvent(root, { kind: 'fileChange', files: ['src/a.ts', 'README.md', 'src/b/c.ts'] })
    await until(() => (last?.history.length ?? 0) > 0)
    expect(pty.sent).toEqual(['Rode os testes de src/a.ts, src/b/c.ts'])
  })

  it('teto por hora: o disparo a mais é registrado como pulado', async () => {
    service.save(root, routine({ script: 'oi', maxPerHour: 1, trigger: { kind: 'boardColumn', column: 'qa' } }))
    service.onEvent(root, { kind: 'boardColumn', column: 'qa' })
    await until(() => (last?.history.length ?? 0) > 0)
    service.onEvent(root, { kind: 'boardColumn', column: 'qa' })
    await until(() => (last?.history.length ?? 0) > 1)
    expect(service.state(root).history[0]!.outcome).toBe('skippedCap')
    expect(pty.sent).toEqual(['oi'])
  })

  it('disparo por evento com o alvo ocupado espera ele ficar livre', async () => {
    service.save(root, routine({ script: 'corrija', trigger: { kind: 'message', mood: 'complaint' } }))
    pty.activity = 'busy'
    service.onEvent(root, { kind: 'message', fromId: 'rev', toId: 't1', mood: 'praise' })
    service.onEvent(root, { kind: 'message', fromId: 'rev', toId: 't1', mood: 'complaint' })
    await new Promise((r) => setTimeout(r, 1500))
    expect(pty.sent).toEqual([])
    expect(service.state(root).routines[0]!.running).not.toBeNull()
    pty.activity = 'idle'
    await until(() => (last?.history.length ?? 0) > 0)
    expect(pty.sent).toEqual(['corrija'])
  })

  it('cancelar interrompe antes do próximo passo', async () => {
    service.save(root, routine())
    service.runNow(root, 'rt1')
    await until(() => pty.sent.length === 1)
    service.cancel(root, 'rt1')
    await until(() => (last?.history.length ?? 0) > 0)
    expect(service.state(root).history[0]!.outcome).toBe('cancelled')
    expect(pty.sent.length).toBeLessThan(3)
  }, 30_000)

  it('não deixa rodar duas vezes ao mesmo tempo e remove rotinas de terminais apagados', async () => {
    service.save(root, routine())
    service.runNow(root, 'rt1')
    expect(() => service.runNow(root, 'rt1')).toThrow(/em execução/)
    ws.apply([{ op: 'removeNodes', ids: ['t1'] }], 'renderer')
    service.pruneTargets(root)
    expect(service.state(root).routines).toHaveLength(0)
  })
})
