import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { CLI_NAME, ENV_PREFIX } from '@shared/constants'
import type { AgentPreset, TerminalNodeData } from '@shared/schemas'
import type { TerminalRuntimeInfo } from '@shared/runtime'
import type { PtyManager, TerminalSpec } from '../pty/PtyManager'
import { buildTerminalEnv } from '../pty/env'
import { baseEnv } from '../pty/shell'
import type { ConfigStore } from '../store/ConfigStore'
import type { WorkspaceStore } from '../store/WorkspaceStore'
import { log } from '../util/log'
import { claudeSessionExists, codexSessionFile } from './sessions'
import { locateCodexTranscript, readFirstLine } from '../chat/transcripts'
import { codexSessionMeta } from '@shared/chat'
import { codexNotifyArgs } from '@shared/agentEvents'
import { agentFamily, effectiveModelEffort, fillArgs, sessionSlug, sessionTitle } from '@shared/agentModels'

export interface TerminalServiceDeps {
  ptys: PtyManager
  config: ConfigStore
  /** Workspace vivo que contém o nó. */
  workspaceOf: (nodeId: string) => WorkspaceStore | undefined
  binDir: string
  nodeExe: string
  cliScript: string
  apiPort: () => number
  /** Gera o texto de instruções (papel + peers + referência do CLI) do terminal. */
  instructionsFor: (node: TerminalNodeData, preset: AgentPreset) => string
  /** Prepara arquivos de instruções no diretório de trabalho (AGENTS.md / skill). */
  prepareInstructions?: (node: TerminalNodeData, preset: AgentPreset, cwd: string, resuming: boolean) => void
  /** Desfaz o que `prepareInstructions` criou. */
  cleanupInstructions?: (node: TerminalNodeData, cwd: string) => void
  /** Persiste o id de sessão do agente no nó (operação originada no main). */
  setSessionId?: (nodeId: string, sessionId: string | undefined) => void
  /** Ambiente para achar os históricos (CODEX_HOME etc.); padrão: o do processo. */
  env?: Record<string, string | undefined>
  /** Arquivo `--settings` com os hooks do Claude Code (estado exato); ausente = sem hooks. */
  claudeHooksFile?: string
}

/**
 * Liga nós de terminal do canvas a processos em PTY: escolhe preset, diretório, ambiente
 * (variáveis do CLI + PATH) e token exclusivo por terminal.
 */
export class TerminalService extends EventEmitter<{ started: [string]; stopped: [string] }> {
  /** token -> id do terminal. Cada terminal tem o seu token: um agente não consegue se passar por outro. */
  private readonly tokens = new Map<string, string>()
  private readonly tokenOf = new Map<string, string>()
  /** cwd efetivo e nó (no momento do início) de cada terminal, para limpar instruções ao fechar. */
  private readonly started = new Map<string, { cwd: string; node: TerminalNodeData }>()
  private readonly startedAt = new Map<string, number>()
  /** Como a sessão do agente foi iniciada (para recuperar de falhas de retomada). */
  private readonly sessionMode = new Map<string, 'new' | 'resume'>()
  private readonly sessionRetried = new Set<string>()
  /** Porta remota do túnel reverso de terminais SSH. */
  private readonly tunnelPorts = new Map<string, number>()
  /** Terminais iniciados com modelo/esforço/nome da sessão (argumentos que versões antigas do agente recusam). */
  private readonly extrasUsed = new Set<string>()
  /** Terminais em que esses argumentos derrubaram o agente: seguem sem eles até você reiniciar. */
  private readonly extrasOff = new Set<string>()

  constructor(private readonly deps: TerminalServiceDeps) {
    super()
  }

  /** Terminal autenticado pelo token (usado pela API local). */
  terminalForToken(token: string): string | undefined {
    return this.tokens.get(token)
  }

  /** Token de um terminal em execução (para o bootstrap do `orq` remoto). */
  tokenOfTerminal(id: string): string | undefined {
    return this.tokenOf.get(id)
  }

  /** Porta remota do túnel SSH de um terminal (sorteada uma vez por terminal). */
  tunnelPortFor(id: string): number {
    let port = this.tunnelPorts.get(id)
    if (!port) {
      const used = new Set(this.tunnelPorts.values())
      do {
        port = 20000 + (randomBytes(2).readUInt16BE(0) % 40000)
      } while (used.has(port))
      this.tunnelPorts.set(id, port)
    }
    return port
  }

  tunnelPortOf(id: string): number | undefined {
    return this.tunnelPorts.get(id)
  }

  /** Portas remotas de túneis ativos (aceitas no header Host da API local). */
  activeTunnelPorts(): number[] {
    return [...this.tunnelPorts.values()]
  }

  node(id: string): TerminalNodeData | undefined {
    const n = this.deps.workspaceOf(id)?.doc.nodes.find((x) => x.id === id)
    return n && n.kind === 'terminal' ? n : undefined
  }

  presetFor(node: TerminalNodeData): AgentPreset {
    return (
      this.deps.config.preset(node.presetId) ??
      this.deps.config.preset('shell') ??
      this.deps.config.presets[0]!
    )
  }

  /** Diretório de trabalho efetivo: floor (worktree) > cwd do nó > raiz do workspace. */
  resolveCwd(node: TerminalNodeData): string {
    const ws = this.deps.workspaceOf(node.id)
    if (!ws) throw new Error('o terminal não pertence a um workspace aberto')
    let root = ws.dir
    if (node.floorId) {
      const floor = ws.doc.floors.find((f) => f.id === node.floorId)
      if (floor && fs.existsSync(floor.worktreePath)) root = floor.worktreePath
    }
    let cwd = root
    if (node.cwd.trim() !== '') cwd = path.isAbsolute(node.cwd) ? node.cwd : path.resolve(root, node.cwd)
    try {
      if (!fs.statSync(cwd).isDirectory()) cwd = root
    } catch {
      cwd = root
    }
    return cwd
  }

  private tokenFor(id: string): string {
    let token = this.tokenOf.get(id)
    if (!token) {
      token = randomBytes(24).toString('base64url')
      this.tokenOf.set(id, token)
      this.tokens.set(token, id)
    }
    return token
  }

  private revokeToken(id: string): void {
    const token = this.tokenOf.get(id)
    if (token) this.tokens.delete(token)
    this.tokenOf.delete(id)
  }

  buildSpec(node: TerminalNodeData, cols: number, rows: number): TerminalSpec {
    const ws = this.deps.workspaceOf(node.id)
    if (!ws) throw new Error('o terminal não pertence a um workspace aberto')
    const preset = this.presetFor(node)
    const cwd = this.resolveCwd(node)
    const role = node.roleId ? this.deps.config.role(node.roleId) : undefined
    const needsInstructions = preset.args.some((a) => a.includes('{instructions}'))
    const instructions = needsInstructions ? this.deps.instructionsFor(node, preset) : ''
    const host = node.remoteHost ?? ''
    if (preset.args.some((a) => a.includes('{host}'))) {
      // Defesa extra além do schema: um destino começando com "-" viraria opção do ssh.
      if (!host) throw new Error(`o terminal "${node.name}" precisa de um servidor (usuario@host) para o preset ${preset.label}`)
      if (host.startsWith('-')) throw new Error('destino SSH inválido')
    }
    const vars: Record<string, string> = {
      instructions,
      name: node.name,
      role: role?.name ?? '',
      cwd,
      cli: CLI_NAME,
      host
    }
    const args = preset.args.map((a) => a.replace(/\{(instructions|name|role|cwd|cli|host)\}/g, (_m, k: string) => vars[k] ?? ''))
    // Estado exato: o Codex avisa por notificação de terminal (opções globais, antes de "resume <id>");
    // o Claude Code chama `orq hook` pelos hooks do arquivo de configurações.
    const events = this.deps.config.settings.exactAgentState ? (preset.agentEvents ?? 'none') : 'none'
    if (events === 'codex') args.push(...codexNotifyArgs())
    // Modelo e esforço (do terminal ou da função) e nome "projeto/agente" da sessão; antes de "resume <id>".
    const extras = this.extrasOff.has(node.id) ? [] : this.extraArgs(node, preset, ws.doc.name)
    if (extras.length > 0) this.extrasUsed.add(node.id)
    else this.extrasUsed.delete(node.id)
    args.push(...extras)
    args.push(...this.sessionArgs(node, preset, cwd))
    if (events === 'claude' && this.deps.claudeHooksFile) args.push('--settings', this.deps.claudeHooksFile)
    if (preset.remoteOrq) {
      // Túnel reverso: no servidor, 127.0.0.1:<porta remota> chega à API local deste app.
      const remotePort = this.tunnelPortFor(node.id)
      args.unshift('-R', `127.0.0.1:${remotePort}:127.0.0.1:${this.deps.apiPort()}`, '-o', 'ServerAliveInterval=30')
    }
    const env = buildTerminalEnv({
      base: baseEnv(),
      presetEnv: preset.env,
      binDir: this.deps.binDir,
      apiPort: this.deps.apiPort(),
      token: this.tokenFor(node.id),
      terminalId: node.id,
      terminalName: node.name,
      workspaceDir: ws.dir,
      nodeExe: this.deps.nodeExe,
      cliScript: this.deps.cliScript
    })
    // Terminais de um floor sabem onde estão (úteis em scripts de setup e nas instruções).
    const floor = node.floorId ? ws.doc.floors.find((f) => f.id === node.floorId) : undefined
    if (floor) {
      env[`${ENV_PREFIX}_FLOOR_NAME`] = floor.name
      env[`${ENV_PREFIX}_BRANCH_NAME`] = floor.branch
      env[`${ENV_PREFIX}_FLOOR_PATH`] = floor.worktreePath
      env[`${ENV_PREFIX}_ROOT_PATH`] = ws.dir
    }
    const settings = this.deps.config.settings
    return {
      id: node.id,
      command: preset.command,
      args,
      cwd,
      env,
      cols,
      rows,
      idleMs: preset.idleMs,
      idlePatterns: preset.idlePatterns,
      scrollback: settings.scrollback,
      agentEvents: events === 'claude' && !this.deps.claudeHooksFile ? 'none' : events
    }
  }

  /** Modelo, esforço e nome da sessão, conforme o preset aceite cada um. */
  extraArgs(node: TerminalNodeData, preset: AgentPreset, project: string): string[] {
    const role = node.roleId ? this.deps.config.role(node.roleId) : undefined
    const { model, effort } = effectiveModelEffort(node, role, agentFamily(preset))
    return [
      ...fillArgs(preset.modelArgs, { model: model ?? undefined }),
      ...fillArgs(preset.effortArgs, { effort: effort ?? undefined }),
      ...fillArgs(preset.titleArgs, { title: sessionTitle(project, node.name), titleSlug: sessionSlug(project, node.name) })
    ]
  }

  /**
   * Argumentos de sessão: retoma a conversa se ela existir (e a preferência estiver ligada), senão
   * inicia uma sessão nova com o id do nó (gerado e persistido na primeira vez).
   */
  private sessionArgs(node: TerminalNodeData, preset: AgentPreset, cwd: string): string[] {
    if (preset.sessionArgs.length === 0 && preset.resumeArgs.length === 0) {
      this.sessionMode.delete(node.id)
      return []
    }
    if (preset.sessionStore === 'codex') {
      // O Codex escolhe o id: só retoma se já descobrimos a sessão deste terminal e ela ainda existe.
      const id = node.sessionId
      const resume =
        Boolean(id) && this.deps.config.settings.resumeSessions && preset.resumeArgs.length > 0 && codexSessionFile(id!, this.deps.env) !== null
      this.sessionMode.set(node.id, resume ? 'resume' : 'new')
      // Conversa nova: o id antigo não vale mais (o novo é descoberto depois da primeira mensagem).
      if (!resume && id) this.deps.setSessionId?.(node.id, undefined)
      const template = resume ? preset.resumeArgs : preset.sessionArgs
      return template.map((a) => a.replace(/\{sessionId\}/g, id ?? ''))
    }
    let sessionId = node.sessionId
    if (!sessionId) {
      sessionId = randomUUID()
      this.deps.setSessionId?.(node.id, sessionId)
    }
    const exists = preset.sessionStore === 'claude' ? claudeSessionExists(cwd, sessionId) : false
    const resume = this.deps.config.settings.resumeSessions && exists && preset.resumeArgs.length > 0
    this.sessionMode.set(node.id, resume ? 'resume' : 'new')
    const template = resume ? preset.resumeArgs : preset.sessionArgs
    return template.map((a) => a.replace(/\{sessionId\}/g, sessionId!))
  }

  /** Começa uma conversa nova no agente (novo id de sessão) e reinicia o processo. */
  newSession(id: string, opts: { keepFallback?: boolean } = {}): TerminalRuntimeInfo | null {
    const node = this.node(id)
    if (!node) return null
    this.forgetSession(node)
    return this.restart(id, opts)
  }

  /** Esquece a conversa atual sem mexer no processo: a próxima vez que o terminal iniciar, ela é nova. */
  private forgetSession(node: TerminalNodeData): void {
    // No Codex o id da conversa nova é dele: some o atual e o novo é descoberto depois.
    this.deps.setSessionId?.(node.id, this.presetFor(node).sessionStore === 'codex' ? undefined : randomUUID())
  }

  /**
   * Nova tarefa: cada agente começa uma conversa nova. Os que estão rodando reiniciam; hibernados e parados só
   * esquecem a conversa (sem iniciar). Shells ficam de fora: reiniciar derrubaria o que roda neles.
   */
  newTask(ids: string[]): { restarted: number; later: number } {
    let restarted = 0
    let later = 0
    for (const id of ids) {
      const node = this.node(id)
      if (!node) continue
      const preset = this.presetFor(node)
      if (preset.isShell) continue
      if (!node.hibernated && this.deps.ptys.has(id)) {
        if (this.newSession(id)) restarted++
        continue
      }
      if (preset.sessionArgs.length > 0 || preset.resumeArgs.length > 0) this.forgetSession(node)
      later++
    }
    return { restarted, later }
  }

  /** O histórico da conversa deste terminal existe (dá para retomá-la depois de encerrar o processo)? */
  sessionExists(node: TerminalNodeData): boolean {
    if (!node.sessionId) return false
    const store = this.presetFor(node).sessionStore
    if (store === 'codex') return codexSessionFile(node.sessionId, this.deps.env) !== null
    if (store === 'claude') {
      try {
        return claudeSessionExists(this.resolveCwd(node), node.sessionId, this.deps.env)
      } catch {
        return false
      }
    }
    return false
  }

  /** O processo deste terminal retomou uma conversa (em vez de começar uma nova)? */
  isResuming(id: string): boolean {
    return this.sessionMode.get(id) === 'resume'
  }

  /**
   * Codex numa conversa nova: acha o histórico criado por este processo (mesma pasta, depois do início,
   * que nenhum outro terminal já tenha) e guarda o id no nó, para retomar quando o app reabrir.
   */
  discoverCodexSession(id: string): void {
    const node = this.node(id)
    if (!node || node.sessionId || this.presetFor(node).sessionStore !== 'codex') return
    const startedAt = this.startedAt.get(id)
    if (!startedAt) return
    const taken = new Set<string | null>()
    for (const ws of [this.deps.workspaceOf(id)].filter(Boolean)) {
      for (const n of ws!.doc.nodes) {
        if (n.kind !== 'terminal' || n.id === id || !n.sessionId) continue
        const file = codexSessionFile(n.sessionId, this.deps.env)
        if (file) taken.add(file)
      }
    }
    const file = locateCodexTranscript(this.resolveCwd(node), startedAt, taken, this.deps.env ?? process.env)
    const meta = file ? codexSessionMeta(readFirstLine(file)) : null
    if (!meta?.id || !/^[0-9a-f-]{36}$/i.test(meta.id)) return
    this.deps.setSessionId?.(id, meta.id)
    log.info('sessão do Codex associada ao terminal', { id })
  }

  /**
   * Processo saiu: se foi logo depois de iniciar uma sessão com id (ex.: sessão não encontrada ou
   * id em uso), tenta uma única vez com uma sessão nova.
   */
  handleExit(id: string, exitCode: number): void {
    const startedAt = this.startedAt.get(id) ?? 0
    // Primeiro suspeito: modelo/esforço/nome da sessão (versão antiga do agente, modelo inexistente).
    if (exitCode !== 0 && Date.now() - startedAt <= 8000 && this.extrasUsed.has(id) && !this.extrasOff.has(id)) {
      this.extrasOff.add(id)
      log.warn('agente saiu logo após iniciar; tentando sem modelo/esforço/nome da sessão', { id })
      this.restart(id, { keepFallback: true })
      return
    }
    const mode = this.sessionMode.get(id)
    if (!mode || exitCode === 0 || Date.now() - startedAt > 8000 || this.sessionRetried.has(id)) return
    this.sessionRetried.add(id)
    log.warn('agente saiu logo após iniciar a sessão; tentando com sessão nova', { id, mode })
    this.newSession(id, { keepFallback: true })
  }

  /** Inicia o terminal se ainda não estiver rodando (idempotente). */
  ensure(id: string, cols: number, rows: number): TerminalRuntimeInfo {
    const { ptys } = this.deps
    if (ptys.has(id)) {
      ptys.resize(id, cols, rows)
      return ptys.info(id)!
    }
    const node = this.node(id)
    if (!node) throw new Error('terminal não encontrado no workspace')
    const preset = this.presetFor(node)
    const spec = this.buildSpec(node, cols, rows)
    try {
      this.deps.prepareInstructions?.(node, preset, spec.cwd, this.isResuming(id))
    } catch (err) {
      log.warn('falha ao preparar instruções do agente', err instanceof Error ? err : undefined)
    }
    this.started.set(id, { cwd: spec.cwd, node })
    this.startedAt.set(id, Date.now())
    const info = ptys.create(spec)
    log.info('terminal iniciado', { id, preset: preset.id, status: info.status })
    this.emit('started', id)
    return info
  }

  restart(id: string, opts: { keepFallback?: boolean } = {}): TerminalRuntimeInfo | null {
    const { ptys } = this.deps
    // Reiniciar pela interface (ex.: depois de trocar o modelo) tenta de novo com todos os argumentos.
    if (!opts.keepFallback) this.extrasOff.delete(id)
    const node = this.node(id)
    if (!node) return null
    const current = ptys.info(id)
    if (!ptys.has(id)) return this.ensure(id, current?.cols ?? 100, current?.rows ?? 30)
    // Desfaz as instruções do início anterior (preset/papel/pasta podem ter mudado) antes de preparar.
    const prev = this.started.get(id)
    if (prev) {
      try {
        this.deps.cleanupInstructions?.(prev.node, prev.cwd)
      } catch (err) {
        log.warn('falha ao limpar instruções do agente', err instanceof Error ? err : undefined)
      }
    }
    const spec = this.buildSpec(node, current?.cols ?? 100, current?.rows ?? 30)
    try {
      this.deps.prepareInstructions?.(node, this.presetFor(node), spec.cwd, this.isResuming(id))
    } catch (err) {
      log.warn('falha ao preparar instruções do agente', err instanceof Error ? err : undefined)
    }
    this.started.set(id, { cwd: spec.cwd, node })
    this.startedAt.set(id, Date.now())
    const info = ptys.restart(id, spec) ?? null
    log.info('terminal reiniciado', { id })
    return info
  }

  /** Encerra o processo e libera recursos do terminal. */
  stop(id: string): void {
    const started = this.started.get(id)
    this.deps.ptys.dispose(id)
    this.revokeToken(id)
    this.started.delete(id)
    this.startedAt.delete(id)
    this.sessionMode.delete(id)
    this.sessionRetried.delete(id)
    this.tunnelPorts.delete(id)
    this.extrasUsed.delete(id)
    this.extrasOff.delete(id)
    if (started) {
      try {
        this.deps.cleanupInstructions?.(started.node, started.cwd)
      } catch (err) {
        log.warn('falha ao limpar instruções do agente', err instanceof Error ? err : undefined)
      }
    }
    this.emit('stopped', id)
  }

  /** Encerra todos (saída do app). */
  stopAll(): void {
    for (const id of this.deps.ptys.ids()) this.stop(id)
  }

  /** Encerra os terminais de um conjunto de nós (ex.: workspace sendo fechado). */
  stopMany(ids: Iterable<string>): void {
    for (const id of ids) if (this.deps.ptys.has(id)) this.stop(id)
  }

  runningIds(): string[] {
    return this.deps.ptys.ids()
  }
}
