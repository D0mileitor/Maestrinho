import * as fs from 'node:fs'
import * as path from 'node:path'
import { ROUTINES_FILE } from '@shared/constants'
import type { RoutinesState, RoutineView } from '@shared/ipc'
import { isDue, matchingFiles, nextRunAt, parseRoutineSteps, renderRoutineScript, triggerMatches, underHourlyCap, type RoutineEvent } from '@shared/routines'
import type { UsagePause } from '@shared/usage'
import {
  RoutineSchema,
  RoutinesFileSchema,
  type Routine,
  type RoutineOutcome,
  type RoutineRun,
  type RoutinesFile
} from '@shared/schemas'
import { DebouncedWriter } from '../store/atomicWrite'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import type { WorkspaceStore } from '../store/WorkspaceStore'
import type { PtyManager } from '../pty/PtyManager'
import type { TerminalService } from '../terminals/TerminalService'
import { log } from '../util/log'

const TICK_MS = 15_000
const MAX_HISTORY = 100
/** Tempo máximo esperando um passo terminar. */
const STEP_TIMEOUT_MS = 30 * 60_000
/** Se o agente não reagir a um passo neste tempo, segue adiante. */
const NO_ACTIVITY_MS = 90_000
/** Disparo por evento com o alvo ocupado: espera ele ficar livre até este tempo. */
const EVENT_WAIT_IDLE_MS = 30 * 60_000

export interface RoutineDeps {
  workspaces: WorkspaceManager
  ptys: PtyManager
  terminals: TerminalService
  notify(title: string, body: string, info: { terminalId: string; dir: string }): void
  onChanged(dir: string, state: RoutinesState): void
  /** Acorda o alvo se estiver hibernando e espera ele ficar pronto. */
  wake?(id: string): Promise<unknown>
  /** Pausa automática por limite da assinatura (Configurações): disparos agendados são pulados. */
  limitPause?(): UsagePause | null
  /** Uma execução terminou (linha do tempo). */
  onRun?(dir: string, run: RoutineRun): void
}

/** "assinatura do Claude em 96% (sessão de 5 h)". */
export function limitPauseDetail(p: UsagePause): string {
  const provider = p.provider === 'claude' ? 'Claude' : p.provider === 'codex' ? 'Codex' : p.provider
  const window = p.kind === 'session' ? 'sessão de 5 h' : p.kind === 'weekly' ? 'semana' : 'limite'
  return `assinatura do ${provider} em ${Math.round(p.percent)}% (${p.scope ? `${window}, ${p.scope}` : window})`
}

interface Loaded {
  ws: WorkspaceStore
  data: RoutinesFile
  writer: DebouncedWriter
}

interface RunState {
  step: number
  total: number
  cancelled: boolean
}

function key(dir: string): string {
  const abs = path.resolve(dir)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Routines: prompts agendados enviados a um terminal em intervalos. Passos separados por `&&`
 * (linha própria) são enviados em sequência, cada um após o agente ficar ocioso.
 * Persistência em <workspace>/.maestrinho/routines.json.
 */
export class RoutineService {
  private readonly loaded = new Map<string, Loaded>()
  private readonly running = new Map<string, RunState>()
  /** Instantes dos disparos por evento de cada rotina na última hora (teto por hora). */
  private readonly fired = new Map<string, number[]>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: RoutineDeps) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const r of this.running.values()) r.cancelled = true
    for (const l of this.loaded.values()) l.writer.flushSync()
  }

  load(ws: WorkspaceStore): void {
    const k = key(ws.dir)
    if (this.loaded.has(k)) return
    const file = path.join(ws.metaDir, ROUTINES_FILE)
    let data: RoutinesFile = RoutinesFileSchema.parse({ version: 1 })
    if (fs.existsSync(file)) {
      try {
        const parsed = RoutinesFileSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
        if (parsed.success) data = parsed.data
        else {
          log.warn('routines.json inválido; preservado e ignorado', { issues: parsed.error.issues.length })
          fs.copyFileSync(file, `${file}.invalido-${Date.now()}`)
        }
      } catch {
        log.warn('routines.json ilegível; preservado e ignorado')
        try {
          fs.copyFileSync(file, `${file}.invalido-${Date.now()}`)
        } catch {
          // ignora
        }
      }
    }
    const writer = new DebouncedWriter(file, 300, (err) => log.error('falha ao salvar routines', err instanceof Error ? err : undefined))
    this.loaded.set(k, { ws, data, writer })
  }

  unload(dir: string): void {
    const k = key(dir)
    const l = this.loaded.get(k)
    if (!l) return
    for (const r of l.data.routines) {
      const run = this.running.get(r.id)
      if (run) run.cancelled = true
    }
    l.writer.flushSync()
    this.loaded.delete(k)
  }

  private get(dir: string): Loaded {
    const l = this.loaded.get(key(dir))
    if (!l) throw new Error('workspace não está aberto')
    return l
  }

  state(dir: string): RoutinesState {
    const l = this.get(dir)
    const routines: RoutineView[] = l.data.routines.map((r) => {
      const run = this.running.get(r.id)
      return { ...r, nextRunAt: nextRunAt(r), running: run ? { step: run.step, total: run.total } : null }
    })
    return { routines, history: [...l.data.history].reverse() }
  }

  private persist(l: Loaded): void {
    const snapshot = JSON.stringify(l.data, null, 2)
    l.writer.schedule(() => snapshot)
    this.deps.onChanged(l.ws.dir, this.state(l.ws.dir))
  }

  save(dir: string, routine: Routine): RoutinesState {
    const l = this.get(dir)
    const valid = RoutineSchema.parse(routine)
    if (parseRoutineSteps(valid.script).length === 0) throw new Error('a routine precisa de pelo menos um passo com texto')
    const target = l.ws.doc.nodes.find((n) => n.id === valid.targetId)
    if (!target || target.kind !== 'terminal') throw new Error('o terminal alvo não existe neste workspace')
    const idx = l.data.routines.findIndex((r) => r.id === valid.id)
    if (idx >= 0) {
      const prev = l.data.routines[idx]!
      // Mudar o intervalo reinicia a contagem a partir de agora.
      const intervalChanged = prev.intervalMinutes !== valid.intervalMinutes
      l.data.routines[idx] = {
        ...valid,
        createdAt: prev.createdAt,
        lastRunAt: intervalChanged ? new Date().toISOString() : prev.lastRunAt
      }
    } else {
      l.data.routines.push({ ...valid, createdAt: new Date().toISOString(), lastRunAt: undefined })
    }
    this.persist(l)
    return this.state(dir)
  }

  delete(dir: string, id: string): RoutinesState {
    const l = this.get(dir)
    const run = this.running.get(id)
    if (run) run.cancelled = true
    l.data.routines = l.data.routines.filter((r) => r.id !== id)
    this.persist(l)
    return this.state(dir)
  }

  runNow(dir: string, id: string): void {
    const l = this.get(dir)
    const r = l.data.routines.find((x) => x.id === id)
    if (!r) throw new Error('routine não encontrada')
    if (this.running.has(id)) throw new Error('esta routine já está em execução')
    void this.execute(l, r, true)
  }

  cancel(dir: string, id: string): void {
    this.get(dir)
    const run = this.running.get(id)
    if (run) run.cancelled = true
  }

  /** Remove routines cujo terminal alvo deixou de existir (nó apagado). */
  pruneTargets(dir: string): void {
    const l = this.loaded.get(key(dir))
    if (!l) return
    const ids = new Set(l.ws.doc.nodes.filter((n) => n.kind === 'terminal').map((n) => n.id))
    const before = l.data.routines.length
    l.data.routines = l.data.routines.filter((r) => ids.has(r.targetId))
    if (l.data.routines.length !== before) this.persist(l)
  }

  private tick(): void {
    const now = Date.now()
    for (const l of this.loaded.values()) {
      for (const r of l.data.routines) {
        if (this.running.has(r.id)) continue
        if (isDue(r, now)) void this.execute(l, r, false)
      }
    }
  }

  /**
   * Acontecimento no workspace `dir` (agente terminou, mensagem entre agentes, cartão mudou de coluna,
   * arquivos mudaram): dispara as rotinas ativas cujo gatilho casa com ele, respeitando o teto por hora.
   * `vars` preenche {origem}, {destino}, {tom}, {cartao} no texto da rotina.
   */
  onEvent(dir: string, event: RoutineEvent, vars: Record<string, string> = {}, why = ''): void {
    const l = this.loaded.get(key(dir))
    if (!l) return
    const now = Date.now()
    for (const r of l.data.routines) {
      if (!r.enabled || this.running.has(r.id)) continue
      if (!triggerMatches(r.trigger, event, process.platform === 'win32')) continue
      const times = this.fired.get(r.id) ?? []
      this.fired.set(r.id, times)
      if (!underHourlyCap(times, r.maxPerHour, now)) {
        this.record(l, r, 'skippedCap', 0, parseRoutineSteps(r.script).length, `já disparou ${r.maxPerHour} vez(es) na última hora`)
        continue
      }
      times.push(now)
      const extra: Record<string, string> = {}
      if (event.kind === 'fileChange' && r.trigger.kind === 'fileChange') {
        extra['arquivos'] = matchingFiles(event.files, r.trigger.pattern, process.platform === 'win32').slice(0, 20).join(', ')
      }
      void this.execute(l, r, false, { ...vars, ...extra }, why)
    }
  }

  /** Há rotina ativa disparada por mudança de arquivos neste workspace? */
  hasFileTriggers(dir: string): boolean {
    return this.loaded.get(key(dir))?.data.routines.some((r) => r.enabled && r.trigger.kind === 'fileChange') ?? false
  }

  /** Espera o terminal ficar ocioso (disparo por evento logo depois de outro agente falar com ele). */
  private async waitUntilIdle(id: string, state: RunState): Promise<boolean> {
    const deadline = Date.now() + EVENT_WAIT_IDLE_MS
    while (Date.now() < deadline) {
      if (state.cancelled) return false
      const info = this.deps.ptys.info(id)
      if (!info || info.status !== 'running') return false
      if (info.activity !== 'busy') return true
      await sleep(1000)
    }
    return false
  }

  private record(l: Loaded, r: Routine, outcome: RoutineOutcome, stepsSent: number, stepsTotal: number, detail?: string): void {
    const run: RoutineRun = { routineId: r.id, name: r.name, at: new Date().toISOString(), outcome, stepsSent, stepsTotal, detail }
    l.data.history.push(run)
    this.deps.onRun?.(l.ws.dir, run)
    if (l.data.history.length > MAX_HISTORY) l.data.history.splice(0, l.data.history.length - MAX_HISTORY)
    this.persist(l)
  }

  private markRan(l: Loaded, r: Routine): void {
    const idx = l.data.routines.findIndex((x) => x.id === r.id)
    if (idx >= 0) l.data.routines[idx] = { ...l.data.routines[idx]!, lastRunAt: new Date().toISOString() }
    this.persist(l)
  }

  private async execute(l: Loaded, r: Routine, manual: boolean, vars?: Record<string, string>, why = ''): Promise<void> {
    const steps = parseRoutineSteps(vars ? renderRoutineScript(r.script, vars) : r.script)
    const byEvent = vars !== undefined
    this.markRan(l, r)
    const pause = manual ? null : (this.deps.limitPause?.() ?? null)
    if (pause) {
      this.record(l, r, 'skippedLimit', 0, steps.length, limitPauseDetail(pause))
      return
    }
    const node = this.deps.terminals.node(r.targetId)
    if (node?.hibernated) await this.deps.wake?.(node.id)
    const info = node ? this.deps.ptys.info(node.id) : undefined
    if (!node || !info || info.status !== 'running') {
      this.record(l, r, 'terminalNotRunning', 0, steps.length, node ? `"${node.name}" não está em execução` : 'terminal removido')
      return
    }
    // Disparo por evento: o alvo costuma estar ocupado com a mensagem que acabou de receber; espera.
    if (byEvent && info.activity === 'busy') {
      const waitState: RunState = { step: 0, total: steps.length, cancelled: false }
      this.running.set(r.id, waitState)
      this.deps.onChanged(l.ws.dir, this.state(l.ws.dir))
      const free = await this.waitUntilIdle(node.id, waitState)
      this.running.delete(r.id)
      if (!free) {
        this.record(l, r, waitState.cancelled ? 'cancelled' : 'skippedBusy', 0, steps.length, `"${node.name}" não ficou livre${why ? ` (${why})` : ''}`)
        return
      }
    } else if (!manual && r.skipIfBusy && info.activity === 'busy') {
      this.record(l, r, 'skippedBusy', 0, steps.length, `"${node.name}" estava trabalhando`)
      return
    }
    const preset = this.deps.terminals.presetFor(node)
    const state: RunState = { step: 0, total: steps.length, cancelled: false }
    this.running.set(r.id, state)
    this.deps.onChanged(l.ws.dir, this.state(l.ws.dir))
    let sent = 0
    let outcome: RoutineOutcome = 'completed'
    let detail: string | undefined
    try {
      for (const step of steps) {
        if (state.cancelled) {
          outcome = 'cancelled'
          break
        }
        const sentAt = Date.now()
        await this.deps.ptys.inject(node.id, step, {
          inputMode: preset.inputMode,
          submitDelayMs: preset.submitDelayMs,
          isShell: preset.isShell
        })
        sent += 1
        state.step = sent
        this.deps.onChanged(l.ws.dir, this.state(l.ws.dir))
        const result = await this.waitForIdle(node.id, sentAt, state)
        if (result === 'exited') {
          outcome = 'failed'
          detail = 'o processo do terminal encerrou durante a routine'
          break
        }
        if (result === 'cancelled') {
          outcome = 'cancelled'
          break
        }
        if (result === 'timeout') {
          outcome = 'failed'
          detail = 'o passo não terminou dentro de 30 minutos'
          break
        }
      }
    } catch (err) {
      outcome = 'failed'
      detail = err instanceof Error ? err.message.slice(0, 200) : 'erro ao enviar'
    } finally {
      this.running.delete(r.id)
    }
    this.record(l, r, outcome, sent, steps.length, detail ?? (why || undefined))
    if (r.notifyOnRun) {
      const what = outcome === 'completed' ? `${sent} passo(s) concluído(s)` : `terminou com "${outcome}"`
      this.deps.notify(`Routine "${r.name}"`, `${node.name}: ${what}`, { terminalId: node.id, dir: l.ws.dir })
    }
    log.info('routine executada', { outcome, sent, total: steps.length, manual })
  }

  private async waitForIdle(
    id: string,
    sentAt: number,
    state: RunState
  ): Promise<'idle' | 'exited' | 'timeout' | 'cancelled' | 'noActivity'> {
    for (;;) {
      await sleep(1000)
      if (state.cancelled) return 'cancelled'
      const info = this.deps.ptys.info(id)
      if (!info || info.status !== 'running') return 'exited'
      const last = this.deps.ptys.lastActivity(id)
      const now = Date.now()
      if (info.activity === 'idle' && last > sentAt) return 'idle'
      if (last <= sentAt && now - sentAt > NO_ACTIVITY_MS) return 'noActivity'
      if (now - sentAt > STEP_TIMEOUT_MS) return 'timeout'
    }
  }
}
