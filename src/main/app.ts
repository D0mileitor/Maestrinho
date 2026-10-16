import { app, BrowserWindow, dialog, shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { APP_NAME, CLI_NAME } from '@shared/constants'
import type { WorkspaceOp } from '@shared/ipc'
import type { TerminalNodeData } from '@shared/schemas'
import { EventBus, handle, on } from './ipc/registry'
import * as S from './ipc/schemas'
import { PtyManager } from './pty/PtyManager'
import { ConfigStore } from './store/ConfigStore'
import { WorkspaceManager } from './store/WorkspaceManager'
import type { WorkspaceStore } from './store/WorkspaceStore'
import { TerminalService } from './terminals/TerminalService'
import { findExecutable } from './pty/resolveCommand'
import { baseEnv } from './pty/shell'
import { installShims } from './cli/shims'
import { installClaudeHooks } from './terminals/agentHooks'
import { applyTitleBarTheme, isSafeExternalUrl, resolveTheme } from './window'
import { log } from './util/log'
import { RoutineService } from './routines/RoutineService'
import { FloorService } from './floors/FloorService'
import { SearchService } from './search/SearchService'
import { SummaryService } from './summary/SummaryService'
import { NotesService } from './notes/NotesService'
import { bindNotesWatcher, registerNotesIpc } from './notes/ipc'
import { createInstructions, type InstructionsService } from './instructions'
import { createApiHandlers, type ApiHandlers } from './api/handlers'
import { LocalApi } from './api/LocalApi'
import { createNotifier, type Notifier } from './notify'
import { PartituraService } from './partituras/PartituraService'
import { runCliInProcess } from './api/cliBridge'
import { looksLikeSecretPrompt, looksLikeShellPrompt, remoteBootstrap } from './remote/remoteOrq'
import { PastedImages } from './pastedImages'
import { ChatService } from './chat/ChatService'
import { pdfThumbnail } from './chat/attachments'
import { OfficeActivityService } from './office/OfficeActivityService'
import { importBackground, listBackgrounds, readBackground, removeBackground } from './office/backgrounds'
import { importCharacter, listCharacters, readCharacter, removeCharacter } from './office/characters'
import * as fsp from 'node:fs/promises'
import { HubCatalog } from './hub/HubCatalog'
import { DesktopBuddy } from './buddy/DesktopBuddy'
import { clipBuddyText, lastOutputLine, plainSummary, type BuddyKind } from '@shared/buddy'
import { detectPendingChoice, lastAssistantText } from '@shared/chat'
import { defaultLook, effectiveLook } from '@shared/office'
import { chatAgentFor, locateClaudeTranscript, locateCodexTranscript, readFrom } from './chat/transcripts'
import { codexSessionFile } from './terminals/sessions'
import { HibernationService } from './terminals/HibernationService'
import { agentCatalog } from './terminals/modelCatalog'
import { readSubscriptionUsage } from './usage/subscriptionUsage'
import { AgentUsageService, type AgentTerminal } from './usage/AgentUsageService'
import { UsageWatch } from './usage/UsageWatch'
import { CheckpointService } from './checkpoints/CheckpointService'
import { PortalRegistry } from './portals/PortalRegistry'
import { FileTriggerWatcher } from './routines/FileTriggerWatcher'
import { ActivityService } from './activity/ActivityService'
import { limitPauseDetail } from './routines/RoutineService'
import type { BoardFile } from '@shared/board'
import type { EdgeActivityEvent } from '@shared/runtime'
import { windowStart, type UsageReport } from '@shared/usage'
import { BoardService } from './board/BoardService'
import { ChangesService } from './changes/ChangesService'
import { TeamService } from './partituras/TeamService'
import { ChatWindow } from './chatWindow'
import { branchSlug } from './floors/git'
import { applyBoardAction, assignmentMessage, updateCard } from '@shared/board'

/**
 * Contêiner dos serviços do processo principal. Cada fase acrescenta serviços aqui; os handlers
 * IPC ficam próximos dos serviços que usam.
 */
export class AppContext {
  readonly bus = new EventBus()
  readonly ptys = new PtyManager()
  readonly config: ConfigStore
  readonly workspaces: WorkspaceManager
  readonly terminals: TerminalService
  readonly binDir: string
  readonly routines: RoutineService
  readonly floors: FloorService
  readonly search: SearchService
  readonly summary: SummaryService
  readonly pastedImages: PastedImages
  readonly chat: ChatService
  readonly office: OfficeActivityService
  readonly hibernation: HibernationService
  readonly notes = new NotesService()
  readonly board = new BoardService()
  readonly changes: ChangesService
  readonly team: TeamService
  readonly chatWindow: ChatWindow
  readonly instructions: InstructionsService
  readonly notifier: Notifier
  readonly buddy: DesktopBuddy
  readonly handlers: ApiHandlers
  readonly api: LocalApi
  readonly partituras: PartituraService
  readonly agentUsage = new AgentUsageService()
  readonly usageWatch: UsageWatch
  readonly checkpoints = new CheckpointService({ trash: (file) => shell.trashItem(file) })
  /** Rotinas disparadas por mudança de arquivos (só observa workspaces que têm uma). */
  readonly fileTriggers = new FileTriggerWatcher((dir, files) => this.routines.onEvent(dir, { kind: 'fileChange', files }, {}, 'arquivos mudaram'))
  /** Linha do tempo (só metadados) para o painel de atividade e o resumo "enquanto você estava fora". */
  readonly activity = new ActivityService((e) => this.bus.emit('activity:new', e))
  /** Coluna de cada cartão do quadro na última versão vista (para saber quem mudou de coluna). */
  private readonly boardColumns = new Map<string, Map<string, string>>()
  readonly portals = new PortalRegistry(() => {
    const win = this.bus.window
    return win && !win.isDestroyed() ? win.webContents : null
  })
  apiPort = 0
  /** Terminais SSH em que o orq remoto já foi instalado nesta sessão do processo. */
  private readonly remoteReady = new Set<string>()
  /** Último attentionSeq visto por terminal (para notificar só transições novas). */
  private readonly lastAttention = new Map<string, number>()
  /** Terminal em que o usuário está no app (o renderer informa); com o app em foco, ele não precisa de aviso. */
  private focusedTerminal: string | null = null
  /** Terminais parados pelo usuário (o fim do processo não é "parou com erro"). */
  private readonly stoppedByUser = new Set<string>()
  private shuttingDown = false

  constructor(readonly userDataDir: string) {
    this.config = new ConfigStore(userDataDir)
    this.workspaces = new WorkspaceManager(this.config)
    this.binDir = installShims(userDataDir)
    this.terminals = new TerminalService({
      ptys: this.ptys,
      config: this.config,
      workspaceOf: (id) => this.workspaces.forNode(id),
      binDir: this.binDir,
      nodeExe: process.execPath,
      cliScript: path.join(__dirname, `${CLI_NAME}.js`),
      apiPort: () => this.apiPort,
      claudeHooksFile: installClaudeHooks(userDataDir),
      instructionsFor: (node, preset) => this.instructions.instructionsFor(node, preset),
      prepareInstructions: (node, preset, cwd, resuming) => this.instructions.prepare(node, preset, cwd, resuming),
      cleanupInstructions: (node, cwd) => this.instructions.cleanup(node, cwd),
      setSessionId: (nodeId, sessionId) => {
        const ws = this.workspaces.forNode(nodeId)
        if (ws) this.applyMainOps(ws, [{ op: 'updateNode', id: nodeId, patch: { sessionId } }])
      }
    })
    this.routines = new RoutineService({
      workspaces: this.workspaces,
      ptys: this.ptys,
      terminals: this.terminals,
      notify: (title, body, info) => this.notify(title, body, info),
      onChanged: (dir, state) => {
        this.bus.emit('routines:changed', { dir, ...state })
        this.fileTriggers.sync(dir, this.routines.hasFileTriggers(dir))
      },
      wake: (id) => this.hibernation.wakeAndWait(id),
      limitPause: () => this.usageWatch.paused(),
      onRun: (dir, run) => this.activity.add({ kind: 'routine', dir, who: run.name, detail: run.outcome })
    })
    this.usageWatch = new UsageWatch({
      read: () => readSubscriptionUsage(),
      settings: () => this.config.settings,
      notify: (title, body) => this.notifyApp(title, body),
      onPauseChanged: (pause) => {
        this.bus.emit('usage:changed', { pause })
        this.activity.add({ kind: 'limit', dir: '', who: '', detail: pause ? `pausadas: ${limitPauseDetail(pause)}` : 'retomadas' })
      }
    })
    this.floors = new FloorService({
      workspaces: this.workspaces,
      stopTerminals: (ids) => this.terminals.stopMany(ids),
      applyMainOps: (ws, ops) => this.applyMainOps(ws, ops)
    })
    this.search = new SearchService({ workspaces: this.workspaces, config: this.config, searchOutput: (q) => this.ptys.searchOutput(q) })
    this.instructions = createInstructions({
      config: this.config,
      registryDir: path.join(userDataDir, 'run'),
      workspaceOf: (id) => this.workspaces.forNode(id),
      ptys: this.ptys
    })
    this.notifier = createNotifier({
      getWindow: () => this.bus.window,
      onClick: (info) => this.bus.emit('canvas:focusNode', { dir: info.dir, id: info.terminalId })
    })
    this.buddy = new DesktopBuddy({
      mainWindow: () => this.bus.window,
      open: (terminalId, dir) => {
        const win = this.bus.window
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore()
          win.show()
          win.moveTop()
          win.focus()
        }
        // Abre no escritório, com o chat já na aba do agente que chamou.
        this.bus.emit('chat:openAgent', { dir, id: terminalId })
      }
    })
    this.handlers = createApiHandlers({
      workspaces: this.workspaces,
      terminals: this.terminals,
      ptys: this.ptys,
      config: this.config,
      notes: this.notes,
      applyMainOps: (ws, ops) => this.applyMainOps(ws, ops),
      notify: (title, body, info) => this.notify(title, body, info),
      emitEdgeActivity: (e) => {
        this.bus.emit('edge:activity', e)
        if (e.kind === 'send') this.messageEvent(e)
      },
      wake: (id) => this.hibernation.wake(id),
      board: this.board,
      portals: this.portals
    })
    this.api = new LocalApi({
      resolveCaller: (token) => this.terminals.terminalForToken(token),
      dispatch: (callerId, method, body, signal) => this.handlers.dispatch(callerId, method, body, signal),
      // Terminais SSH chegam pela porta remota do túnel; o orq remoto usa a rota /v1/cli.
      extraHostPorts: () => this.terminals.activeTunnelPorts(),
      runCli: (_callerId, token, argv, stdin, signal) => runCliInProcess({ argv, stdin, port: this.apiPort, token, signal })
    })
    this.partituras = new PartituraService({
      workspaces: this.workspaces,
      config: this.config,
      notes: this.notes,
      applyMainOps: (ws, ops) => this.applyMainOps(ws, ops)
    })
    this.team = new TeamService({ workspaces: this.workspaces, config: this.config, notes: this.notes, partituras: this.partituras, board: this.board })
    bindNotesWatcher(this.notes, this.workspaces)
    this.summary = new SummaryService({ config: this.config, ptys: this.ptys })
    this.pastedImages = new PastedImages(path.join(userDataDir, 'imagens-coladas'))
    this.chat = new ChatService({
      node: (id) => this.terminals.node(id),
      presetFor: (node) => this.terminals.presetFor(node),
      resolveCwd: (node) => this.terminals.resolveCwd(node),
      isRunning: (id) => this.ptys.info(id)?.status === 'running',
      startedAt: (id) => this.ptys.info(id)?.startedAt,
      inject: (id, text, opts) => this.ptys.inject(id, text, opts),
      writeRaw: (id, data) => this.ptys.writeRaw(id, data),
      emit: (update) => this.bus.emit('chat:update', update)
    })
    this.chatWindow = new ChatWindow({ bus: this.bus, userDataDir, theme: () => resolveTheme(this.config.settings.theme), onClosed: () => this.chat.dispose() })
    this.office = new OfficeActivityService({
      node: (id) => this.terminals.node(id),
      presetFor: (node) => this.terminals.presetFor(node),
      resolveCwd: (node) => this.terminals.resolveCwd(node),
      startedAt: (id) => this.ptys.info(id)?.startedAt,
      isRunning: (id) => this.ptys.info(id)?.status === 'running',
      readScreen: (id, rows) => this.ptys.readScreen(id, rows),
      claimedByChat: (exceptId) => this.chat.claimedFiles(exceptId),
      emit: (activity) => this.bus.emit('office:activity', activity)
    })
    this.changes = new ChangesService({ workspaces: this.workspaces, terminals: this.terminals, trash: (file) => shell.trashItem(file) })
    this.hibernation = new HibernationService({
      workspaces: this.workspaces,
      terminals: this.terminals,
      ptys: this.ptys,
      config: this.config,
      applyMainOps: (ws, ops) => this.applyMainOps(ws, ops),
      focusedTerminal: () => this.focusedTerminal,
      chatOpen: (id) => this.chat.isOpen(id)
    })
    this.wireEvents()
    this.routines.start()
    this.hibernation.start()
    this.usageWatch.start()
  }

  /** Começou um turno de agente: checkpoint da pasta dele (shells e SSH ficam de fora). */
  private checkpointTurn(id: string): void {
    if (!this.config.settings.checkpoints || !this.ptys.info(id)?.ready) return
    const node = this.terminals.node(id)
    if (!node || node.remoteHost) return
    if (this.terminals.presetFor(node).isShell) return
    let cwd: string
    try {
      cwd = this.terminals.resolveCwd(node)
    } catch {
      return
    }
    void this.checkpoints.onTurnStart(id, node.name, cwd)
  }

  /** Mensagem entre agentes (orq send): gatilhos "quando X mandar (reprovação/aprovação) para Y". */
  private messageEvent(e: EdgeActivityEvent): void {
    const from = this.terminals.node(e.from)
    const to = this.terminals.node(e.to)
    const ws = this.workspaces.forNode(e.from)
    if (!from || !to || !ws) return
    const tom = e.mood === 'complaint' ? 'reprovação' : e.mood === 'praise' ? 'aprovação' : ''
    this.activity.add({ kind: 'message', dir: ws.dir, terminalId: from.id, who: from.name, to: to.name, mood: e.mood ?? null })
    this.routines.onEvent(
      ws.dir,
      { kind: 'message', fromId: from.id, toId: to.id, mood: e.mood ?? null },
      { origem: from.name, destino: to.name, tom },
      `${from.name} mandou mensagem para ${to.name}`
    )
  }

  /** Cartões que entraram numa coluna (movidos ou criados nela) disparam os gatilhos do quadro. */
  private boardMoves(dir: string, board: BoardFile): void {
    const prev = this.boardColumns.get(dir)
    this.boardColumns.set(dir, new Map(board.cards.map((c) => [c.id, c.column])))
    if (!prev) return
    for (const card of board.cards) {
      if (prev.get(card.id) === card.column) continue
      const column = board.columns.find((c) => c.id === card.column)?.name ?? card.column
      this.activity.add({ kind: 'board', dir, who: '', detail: `#${card.seq} ${card.title} → ${column}` })
      this.routines.onEvent(dir, { kind: 'boardColumn', column: card.column }, { cartao: `#${card.seq} ${card.title}` }, `cartão #${card.seq} entrou em ${column}`)
    }
  }

  /** Aviso que não é de um terminal: dentro do app se ele estiver em foco, senão notificação do sistema. */
  private notifyApp(title: string, body: string): void {
    const win = this.bus.window
    if (win && !win.isDestroyed() && win.isFocused()) this.bus.emit('app:toast', { level: 'warn', message: `${title}. ${body}` })
    else this.notifier(title, body, { terminalId: '', dir: '' })
  }

  /** Uso da assinatura; com `withAgents`, também a divisão entre os terminais de agente abertos. */
  private async usageReport(withAgents: boolean): Promise<UsageReport> {
    const report: UsageReport = { ...(await readSubscriptionUsage()), pause: this.usageWatch.paused() }
    if (!withAgents) return report
    const now = Date.now()
    const span = (id: string): { session: number; week: number } => {
      const p = report.providers.find((x) => x.provider === id)
      return { session: windowStart(p, 'session', now), week: windowStart(p, 'weekly', now) }
    }
    report.agents = await this.agentUsage.read(this.agentTerminals(), { claude: span('claude'), codex: span('codex') }, now)
    return report
  }

  /** Terminais de agente (Claude Code/Codex) de todos os workspaces abertos, com o histórico da sessão. */
  private agentTerminals(): AgentTerminal[] {
    const out: AgentTerminal[] = []
    for (const ws of this.workspaces.all()) {
      for (const node of ws.doc.nodes) {
        if (node.kind !== 'terminal' || !node.sessionId) continue
        const agent = chatAgentFor(this.terminals.presetFor(node), node)
        if (!agent) continue
        const file =
          agent === 'claude' ? locateClaudeTranscript(this.terminals.resolveCwd(node), node.sessionId, process.env) : codexSessionFile(node.sessionId)
        if (file) out.push({ terminalId: node.id, name: node.name, workspace: ws.doc.name, provider: agent, file })
      }
    }
    return out
  }

  /**
   * Aviso ao usuário, conforme "Como avisar": o próprio agente no canto da tela, a notificação do
   * sistema ou os dois. Clicar foca o terminal (trocando de workspace se preciso).
   */
  notify(
    title: string,
    body: string,
    info: { terminalId: string; dir: string },
    call?: { kind: BuddyKind; headline: string },
    channels?: { system: boolean; buddy: boolean }
  ): void {
    const style = this.config.settings.notifyStyle
    const system = channels?.system ?? style !== 'personagem'
    const buddy = channels?.buddy ?? style !== 'sistema'
    if (system) this.notifier(title, body, info)
    if (!buddy) return
    const node = this.terminals.node(info.terminalId)
    if (!node) {
      this.notifier(title, body, info)
      return
    }
    // orq notify: o título vem como "nome: assunto".
    const prefix = `${node.name}: `
    const headline = call?.headline ?? (title.startsWith(prefix) ? title.slice(prefix.length) : 'Tenho um recado')
    const role = node.roleId ? this.config.role(node.roleId) : undefined
    this.buddy.show(
      {
        terminalId: node.id,
        name: node.name,
        roleName: role?.name ?? '',
        roleColor: role?.color ?? '',
        look: effectiveLook(node.look, node.id, role?.color || undefined),
        kind: call?.kind ?? 'message',
        headline: clipBuddyText(headline, 80),
        text: clipBuddyText(body),
        at: Date.now()
      },
      info.dir
    )
  }

  /** Última resposta escrita do agente (histórico do Claude Code/Codex), para o texto do aviso. */
  private lastReply(id: string, node: TerminalNodeData): string {
    try {
      const agent = chatAgentFor(this.terminals.presetFor(node), node)
      if (!agent) return ''
      const cwd = this.terminals.resolveCwd(node)
      const file =
        agent === 'claude'
          ? node.sessionId
            ? locateClaudeTranscript(cwd, node.sessionId, process.env)
            : null
          : ((node.sessionId ? codexSessionFile(node.sessionId) : null) ??
            locateCodexTranscript(cwd, this.ptys.info(id)?.startedAt ?? 0, this.chat.claimedFiles(id), process.env, Date.now()))
      const chunk = file ? readFrom(file, 0, 256 * 1024) : null
      if (!chunk?.text) return ''
      const text = chunk.truncated ? chunk.text.slice(chunk.text.indexOf('\n') + 1) : chunk.text
      return plainSummary(lastAssistantText(text, agent))
    } catch {
      return ''
    }
  }

  /**
   * Instala o orq remoto num terminal SSH: digita no shell do servidor o script (com curl) e as
   * variáveis da sessão. Automático só quando a tela mostra um prompt de shell (nunca num pedido de
   * senha ou de confirmação de host); `force` = pedido explícito do usuário pelo menu, que aceita
   * prompts fora do padrão mas também recusa pedidos de senha. Devolve o motivo quando não instala.
   */
  maybeBootstrapRemote(id: string, force: boolean): true | string {
    const node = this.terminals.node(id)
    if (!node) return 'terminal não encontrado'
    const preset = this.terminals.presetFor(node)
    if (!preset.remoteOrq) return 'este terminal não é uma sessão SSH com orq remoto (preset com "orq remoto")'
    if (!force && this.remoteReady.has(id)) return 'orq remoto já ativado nesta sessão'
    const port = this.terminals.tunnelPortOf(id)
    const token = this.terminals.tokenOfTerminal(id)
    if (!port || !token) return 'a sessão SSH não está em execução'
    const screen = this.ptys.readText(id, 12) ?? ''
    if (looksLikeSecretPrompt(screen, force ? 1 : 4)) return 'o terminal está pedindo senha ou confirmação; termine o login e tente de novo'
    if (!force && !looksLikeShellPrompt(screen)) return 'aguardando o prompt do servidor'
    this.remoteReady.add(id)
    const text = remoteBootstrap({ port, token, terminalId: id, terminalName: node.name })
    void this.ptys.inject(id, text, { inputMode: 'raw', submitDelayMs: 80, isShell: true }).catch(() => this.remoteReady.delete(id))
    log.info('orq remoto instalado na sessão SSH', { id, force })
    return true
  }

  /** Inicia a API local (antes de qualquer terminal, que recebe a porta no ambiente). */
  async start(): Promise<void> {
    this.instructions.cleanupOrphans()
    this.pastedImages.prune()
    this.apiPort = await this.api.start()
    log.info('API local pronta', { port: this.apiPort })
  }

  /** Agente terminou uma tarefa: notificação (configurável) e resumo opcional. */
  /**
   * Para onde vai um aviso de "precisa de atenção". O personagem acompanha o "!" do app: aparece sempre
   * que o terminal pede atenção e você não está nele (com o app em foco, só o terminal em que você está
   * fica de fora). A notificação do sistema segue "só quando a janela não estiver em foco".
   */
  private attentionChannels(id: string): { system: boolean; buddy: boolean } {
    const settings = this.config.settings
    const focused = this.bus.window?.isFocused() ?? false
    if (!settings.notifyOnIdle) return { system: false, buddy: false }
    return {
      system: settings.notifyStyle !== 'personagem' && (!focused || !settings.notifyOnlyWhenUnfocused),
      buddy: settings.notifyStyle !== 'sistema' && !(focused && this.focusedTerminal === id)
    }
  }

  /** O processo do agente terminou sozinho com erro: também pede atenção. */
  private onExited(id: string, code: number): void {
    if (this.shuttingDown || this.stoppedByUser.has(id)) return
    // Saída logo após iniciar com sessão: o serviço já tentou de novo com sessão nova.
    const st = this.ptys.info(id)?.status
    if (code === 0 || st === 'starting' || st === 'running') return
    const node = this.terminals.node(id)
    const ws = this.workspaces.forNode(id)
    if (!node || !ws) return
    this.activity.add({ kind: 'exited', dir: ws.dir, terminalId: id, who: node.name, detail: `código ${code}` })
    const channels = this.attentionChannels(id)
    if (!channels.system && !channels.buddy) return
    this.notify(
      node.name + ' parou',
      `O processo terminou com código ${code}. Abra o terminal para ver o que aconteceu e reiniciar.`,
      { terminalId: id, dir: ws.dir },
      { kind: 'waiting', headline: 'Parei com erro!' },
      channels
    )
  }

  private onAttention(id: string): void {
    const node = this.terminals.node(id)
    const ws = this.workspaces.forNode(id)
    if (!node || !ws) return
    const channels = this.attentionChannels(id)
    const shouldNotify = channels.system || channels.buddy
    const screen = this.ptys.readText(id, 40) ?? ''
    // No shell, a última linha da tela é o prompt: vale a última saída de verdade.
    const lastLine = lastOutputLine(screen)
    // Parou numa pergunta com opções (permissão, AskUserQuestion): o aviso é "precisa de você". Com estado
    // exato, quem diz é o próprio agente; a tela só fornece o texto da pergunta.
    const rt = this.ptys.info(id)
    const choice = detectPendingChoice(this.ptys.readScreen(id, 40) ?? '')
    const waiting = rt?.exact ? rt.attentionKind === 'waiting' : Boolean(choice)
    this.activity.add({ kind: waiting ? 'waiting' : 'done', dir: ws.dir, terminalId: id, who: node.name })
    if (!waiting) this.routines.onEvent(ws.dir, { kind: 'agentDone', terminalId: id }, { origem: node.name }, `${node.name} terminou`)
    const pending = waiting ? (choice ?? { question: 'Aprovação pendente: abra o terminal para decidir.' }) : null
    const info = { terminalId: id, dir: ws.dir }
    const call = pending ? { kind: 'waiting' as const, headline: 'Preciso de você!' } : { kind: 'done' as const, headline: 'Terminei!' }
    const title = pending ? node.name + ' precisa de você' : node.name + ' terminou'
    const fallback = pending ? pending.question : this.lastReply(id, node) || lastLine || 'Aguardando você.'
    if (this.summary.enabled && !pending) {
      void this.summary
        .summarize(id, node.name)
        .then((summary) => {
          this.bus.emit('summary:ready', { id, summary })
          if (shouldNotify) this.notify(title, summary, info, call, channels)
        })
        .catch(() => {
          if (shouldNotify) this.notify(title, fallback, info, call, channels)
        })
    } else if (shouldNotify) {
      this.notify(title, fallback, info, call, channels)
    }
  }

  private wireEvents(): void {
    const { bus, ptys, workspaces, terminals, config } = this
    ptys.on('data', (e) => bus.emit('pty:data', e))
    ptys.on('exit', (id, code) => {
      terminals.handleExit(id, code)
      this.onExited(id, code)
    })
    ptys.on('activity', (id, t) => {
      this.instructions.handleActivity(id, t)
      if (t.state === 'busy') this.checkpointTurn(id)
      // Codex numa conversa nova: depois da primeira resposta o histórico existe e o id pode ser guardado.
      if (t.state === 'idle') terminals.discoverCodexSession(id)
      if (t.state === 'idle') this.maybeBootstrapRemote(id, false)
    })
    // Mensagem ou Enter enviado ao agente: checkpoint antes que ele comece a mexer nos arquivos.
    ptys.on('submit', (id) => this.checkpointTurn(id))
    terminals.on('stopped', (id) => {
      this.remoteReady.delete(id)
      this.stoppedByUser.add(id)
      setTimeout(() => this.stoppedByUser.delete(id), 10_000).unref?.()
    })
    ptys.on('exit', (id) => this.remoteReady.delete(id))
    ptys.on('info', (info) => {
      bus.emit('pty:info', info)
      const prev = this.lastAttention.get(info.id) ?? 0
      if (info.attentionSeq > prev) {
        this.lastAttention.set(info.id, info.attentionSeq)
        this.onAttention(info.id)
      }
    })
    config.on('changed', (cfg) => bus.emit('config:changed', cfg))
    this.board.on('changed', (dir, board) => {
      bus.emit('board:changed', { dir, board })
      this.boardMoves(dir, board)
    })

    workspaces.on('ops', (dir, ops, source) => {
      this.applySideEffects(dir, ops)
      // Operações originadas no main (API, gerente, routines) são repassadas ao renderer;
      // as do renderer já foram aplicadas lá de forma otimista.
      if (source === 'main') bus.emit('workspace:ops', { dir, ops })
    })
    workspaces.on('closing', (ws) => {
      this.board.unload(ws.dir)
      terminals.stopMany(ws.doc.nodes.filter((n) => n.kind === 'terminal').map((n) => n.id))
      this.routines.unload(ws.dir)
      this.fileTriggers.sync(ws.dir, false)
      this.boardColumns.delete(ws.dir)
    })
    workspaces.on('opened', (ws) => {
      this.routines.load(ws)
      this.fileTriggers.sync(ws.dir, this.routines.hasFileTriggers(ws.dir))
      // Retrato inicial do quadro: a primeira mudança já sabe de onde cada cartão veio.
      void this.board
        .get(ws.dir)
        .then((b) => this.boardColumns.set(ws.dir, new Map(b.cards.map((c) => [c.id, c.column]))))
        .catch(() => undefined)
    })
    const pushList = (): void => bus.emit('workspace:listChanged', workspaces.list())
    workspaces.on('opened', pushList)
    workspaces.on('activated', (dir) => {
      pushList()
      bus.emit('workspace:activated', { dir })
    })
  }

  /** Efeitos colaterais das operações (independente da origem). */
  private applySideEffects(dir: string, ops: WorkspaceOp[]): void {
    for (const op of ops) {
      if (op.op === 'removeNodes') {
        // Os nós já saíram do documento; encerra os processos que sobraram.
        for (const id of op.ids) {
          if (this.ptys.has(id)) this.terminals.stop(id)
          this.lastAttention.delete(id)
        }
        this.routines.pruneTargets(dir)
      } else if (op.op === 'updateNode') {
        // Papel/preset/gerente mudaram: a sessão antiga guardou o system prompt anterior, então a
        // próxima inicialização começa uma conversa nova.
        const keys = Object.keys(op.patch)
        const node = this.terminals.node(op.id)
        if (node?.sessionId && keys.some((k) => k === 'roleId' || k === 'presetId' || k === 'manager')) {
          const ws = this.workspaces.get(dir)
          if (ws) this.applyMainOps(ws, [{ op: 'updateNode', id: op.id, patch: { sessionId: randomUUID() } }])
        }
      }
    }
  }

  /** Aplica operações vindas do próprio main e avisa o renderer. */
  applyMainOps(ws: WorkspaceStore, ops: WorkspaceOp[]): void {
    ws.apply(ops, 'main')
  }

  terminalNode(id: string): TerminalNodeData | undefined {
    return this.terminals.node(id)
  }

  registerIpc(): void {
    const { config, workspaces, terminals, ptys } = this

    handle('app:info', null, () => ({
      appName: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      cliName: CLI_NAME,
      userDataDir: this.userDataDir,
      apiPort: this.apiPort,
      electron: process.versions.electron ?? '',
      node: process.versions.node,
      chrome: process.versions.chrome ?? ''
    }))
    handle('app:openExternal', S.UrlReq, ({ url }) => {
      if (!isSafeExternalUrl(url)) throw new Error('URL não permitida')
      void shell.openExternal(url)
    })
    handle('app:openPath', S.PathReq, async ({ path: p }) => {
      // Só abre pastas de workspaces conhecidos (ex.: "Abrir no explorador").
      const known = workspaces.all().some((w) => path.resolve(p).toLowerCase().startsWith(w.dir.toLowerCase()))
      if (!known || !fs.existsSync(p)) throw new Error('caminho não permitido')
      const err = await shell.openPath(p)
      if (err) throw new Error(err)
    })

    // ---------------------------------------------------------------- configuração
    handle('config:get', null, () => config.get())
    handle('config:setSettings', S.SettingsPatchReq, (patch) => config.setSettings(patch))
    handle('config:savePreset', S.PresetReq, (p) => config.savePreset(p))
    handle('config:deletePreset', S.IdReq, ({ id }) => config.deletePreset(id))
    handle('config:resetPresets', null, () => config.resetPresets())
    handle('config:saveRole', S.RoleReq, (r) => config.saveRole(r))
    handle('config:deleteRole', S.IdReq, ({ id }) => config.deleteRole(id))
    handle('agents:catalog', null, () => agentCatalog())
    handle('usage:get', S.UsageGetReq, ({ agents }) => this.usageReport(agents))
    handle('activity:list', S.ActivityListReq, ({ since }) => this.activity.list(since))
    handle('presets:availability', null, () => {
      const env = baseEnv()
      const out: Record<string, boolean> = {}
      for (const p of config.presets) out[p.id] = findExecutable(p.command, env) !== null
      return out
    })

    // ---------------------------------------------------------------- workspaces
    handle('workspace:pickDirectory', null, async () => {
      const win = this.bus.window
      const opts = { title: 'Escolha a pasta do projeto', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!
    })
    handle('workspace:list', null, () => workspaces.list())
    handle('workspace:open', S.DirReq, ({ dir }) => workspaces.open(dir))
    handle('workspace:restoreBackup', S.RestoreReq, ({ dir, backup }) => workspaces.restoreBackup(dir, backup))
    handle('workspace:active', null, () => {
      const ws = workspaces.active
      return ws ? { dir: ws.dir, doc: ws.doc, isGitRepo: fs.existsSync(path.join(ws.dir, '.git')) } : null
    })
    handle('workspace:applyOps', S.ApplyOpsReq, ({ dir, ops }) => {
      workspaces.applyOps(dir, ops as WorkspaceOp[], 'renderer')
    })
    handle('workspace:close', S.DirReq, async ({ dir }) => {
      await workspaces.close(dir)
      this.bus.emit('workspace:listChanged', workspaces.list())
    })
    handle('workspace:forget', S.DirReq, async ({ dir }) => {
      await workspaces.close(dir)
      workspaces.forget(dir)
      this.bus.emit('workspace:listChanged', workspaces.list())
    })

    // ---------------------------------------------------------------- terminais
    handle('pty:ensure', S.EnsureReq, ({ id, cols, rows }) => terminals.ensure(id, cols, rows))
    handle('pty:attach', S.IdReq, ({ id }) => ptys.attach(id))
    handle('pty:restart', S.IdReq, ({ id }) => terminals.restart(id))
    handle('pty:newSession', S.IdReq, ({ id }) => terminals.newSession(id))
    handle('pty:newTask', S.NewTaskReq, ({ dir, ids }) => {
      const result = terminals.newTask(ids)
      const n = result.restarted + result.later
      if (n > 0) this.activity.add({ kind: 'newTask', dir, who: '', detail: n === 1 ? '1 agente com conversa nova' : `${n} agentes com conversa nova` })
      return result
    })
    handle('pty:remoteBootstrap', S.IdReq, ({ id }) => {
      const result = this.maybeBootstrapRemote(id, true)
      if (result !== true) throw new Error(result)
    })
    handle('pty:kill', S.IdReq, ({ id }) => terminals.stop(id))
    handle('pty:hibernate', S.IdReq, ({ id }) => this.hibernation.hibernate(id, 'manual'))
    handle('pty:wake', S.IdReq, ({ id }) => {
      this.hibernation.wake(id)
      return ptys.info(id) ?? null
    })
    handle('pty:infoAll', null, () =>
      ptys
        .ids()
        .map((id) => ptys.info(id)!)
        .filter(Boolean)
    )
    handle('pty:readText', S.ReadTextReq, ({ id, lines, screen }) => (screen ? ptys.readScreen(id, lines) : ptys.readText(id, lines)) ?? '')
    // Mensagem do próprio usuário (paleta "Perguntar…"): entra como se tivesse sido digitada.
    handle('pty:sendMessage', S.SendMessageReq, async ({ id, text }) => {
      const node = terminals.node(id)
      if (!node) throw new Error('terminal não encontrado')
      await this.hibernation.wakeAndWait(id)
      const info = ptys.info(id)
      if (!info || info.status !== 'running') throw new Error('"' + node.name + '" não está em execução')
      const preset = terminals.presetFor(node)
      await ptys.inject(id, text, { inputMode: preset.inputMode, submitDelayMs: preset.submitDelayMs, isShell: preset.isShell })
    })

    // ---------------------------------------------------------------- rotinas
    handle('routines:list', S.DirReq, ({ dir }) => this.routines.state(dir))
    handle('routines:save', S.RoutineSaveReq, ({ dir, routine }) => this.routines.save(dir, routine))
    handle('routines:delete', S.DirIdReq, ({ dir, id }) => this.routines.delete(dir, id))
    handle('routines:runNow', S.DirIdReq, ({ dir, id }) => this.routines.runNow(dir, id))
    handle('routines:cancel', S.DirIdReq, ({ dir, id }) => this.routines.cancel(dir, id))

    // ---------------------------------------------------------------- floors
    handle('floors:create', S.FloorCreateReq, ({ dir, name, baseBranch }) => this.floors.create(dir, name, baseBranch))
    handle('floors:discard', S.FloorDiscardReq, ({ dir, id, force }) => this.floors.discard(dir, id, force))
    handle('floors:status', S.DirIdReq, ({ dir, id }) => this.floors.status(dir, id))
    handle('floors:branches', S.DirReq, ({ dir }) => this.floors.branches(dir))

    // ---------------------------------------------------------------- imagens coladas nos terminais
    handle('clipboard:saveImage', null, () => this.pastedImages.saveFromClipboard())

    // ---------------------------------------------------------------- chat ligado a um terminal
    handle('chat:open', S.IdReq, ({ id }) => this.chat.open(id))
    handle('chat:close', S.IdReq, ({ id }) => this.chat.close(id))
    // Chat destacado numa janela própria (pode ir para outro monitor).
    handle('chat:detach', S.ChatTabReq, ({ dir, tab }) => this.chatWindow.open(dir, tab))
    handle('chat:windowOpen', null, () => this.chatWindow.isOpen())
    handle('chat:route', S.ChatRouteReq, (r) => this.chatWindow.route(r))
    handle('chat:dock', S.ChatTabReq, ({ dir, tab }) => {
      this.chatWindow.setTab(dir, tab)
      this.chatWindow.dock()
    })
    handle('chat:tab', S.ChatTabReq, ({ dir, tab }) => this.chatWindow.setTab(dir, tab))
    handle('chat:focusCanvas', S.ChatFocusReq, ({ dir, id }) => {
      const win = this.bus.window
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
      this.bus.emitMain('canvas:focusNode', { dir, id })
    })
    handle('chat:send', S.ChatSendReq, async ({ id, text, images, files }) => {
      // Mensagem para um agente hibernando: acorda (retomando a conversa) e entrega quando ele estiver pronto.
      await this.hibernation.wakeAndWait(id)
      await this.chat.send(id, text, images, files)
    })
    handle('chat:fileThumb', S.ChatThumbReq, ({ path: file }) => pdfThumbnail(file))

    // ---------------------------------------------------------------- escritório
    handle('office:watch', S.OfficeWatchReq, ({ ids }) => this.office.watch(ids))
    // Fundos enviados pelo usuário: só em workspaces abertos, só dentro de .maestrinho/cenarios.
    const liveWs = (dir: string): WorkspaceStore => {
      const ws = workspaces.get(dir)
      if (!ws) throw new Error('workspace não está aberto')
      return ws
    }
    handle('office:backgrounds', S.DirReq, ({ dir }) => listBackgrounds(liveWs(dir).dir))
    handle('office:addBackground', S.DirReq, async ({ dir }) => {
      const ws = liveWs(dir)
      const win = this.bus.window
      const opts = {
        title: 'Escolha a imagem de fundo do escritório',
        properties: ['openFile'] as 'openFile'[],
        filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
      }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (res.canceled || !res.filePaths[0]) return null
      return importBackground(ws.dir, res.filePaths[0])
    })
    handle('office:readBackground', S.BackgroundReq, ({ dir, file }) => readBackground(liveWs(dir).dir, file))
    handle('office:characters', S.DirReq, ({ dir }) => listCharacters(liveWs(dir).dir))
    handle('office:addCharacter', S.DirReq, async ({ dir }) => {
      const ws = liveWs(dir)
      const win = this.bus.window
      const opts = {
        title: 'Escolha a folha de sprites do personagem',
        properties: ['openFile'] as 'openFile'[],
        filters: [{ name: 'Imagens com transparência', extensions: ['png', 'webp', 'gif'] }]
      }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (res.canceled || !res.filePaths[0]) return null
      return importCharacter(ws.dir, res.filePaths[0])
    })
    handle('office:readCharacter', S.CharacterReq, ({ dir, file }) => readCharacter(liveWs(dir).dir, file))
    handle('office:removeCharacter', S.CharacterReq, ({ dir, file }) => removeCharacter(liveWs(dir).dir, file))
    handle('office:saveCharacterTemplate', S.CharacterTemplateReq, async ({ dataUrl }) => {
      const win = this.bus.window
      const opts = { title: 'Salvar o modelo da folha de personagem', defaultPath: 'modelo-personagem.png', filters: [{ name: 'PNG', extensions: ['png'] }] }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return null
      await fsp.writeFile(res.filePath, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
      return res.filePath
    })
    handle('office:removeBackground', S.BackgroundReq, ({ dir, file }) => {
      const ws = liveWs(dir)
      removeBackground(ws.dir, file)
      if (ws.doc.officeScene === `arquivo:${file}`) this.applyMainOps(ws, [{ op: 'setOfficeScene', scene: null }])
    })

    // ---------------------------------------------------------------- aviso com o personagem
    handle('buddy:test', null, () => {
      const ws = workspaces.active
      const node = ws?.doc.nodes.find((n): n is TerminalNodeData => n.kind === 'terminal')
      const role = node?.roleId ? config.role(node.roleId) : undefined
      this.buddy.show(
        {
          terminalId: node?.id ?? 'exemplo',
          name: node?.name ?? 'agente',
          roleName: role?.name ?? '',
          roleColor: role?.color ?? '',
          look: node ? effectiveLook(node.look, node.id, role?.color || undefined) : defaultLook('exemplo'),
          kind: 'done',
          headline: 'Terminei!',
          text: 'Assim eu aviso quando termino uma tarefa ou preciso de você enquanto o Maestrinho está minimizado.',
          at: Date.now()
        },
        ws?.dir ?? ''
      )
    })

    // ---------------------------------------------------------------- partituras prontas (catálogo embutido)
    const catalog = new HubCatalog()
    handle('hub:list', S.HubListReq, ({ q }) => catalog.list(q))
    handle('hub:insert', S.HubInsertReq, async ({ dir, id, position }) => {
      const partitura = catalog.partitura(id)
      const file = await this.partituras.adoptData(dir, partitura)
      const report = await this.partituras.insert(dir, file, position)
      return { ...report, name: partitura.name }
    })

    // ---------------------------------------------------------------- revisão das mudanças (git)
    handle('changes:repos', S.DirReq, ({ dir }) => this.changes.repos(liveWs(dir).dir))
    handle('changes:status', S.ChangesRootReq, ({ dir, root }) => this.changes.status(liveWs(dir).dir, root))
    handle('changes:diff', S.ChangesDiffReq, ({ dir, root, path: file }) => this.changes.diff(liveWs(dir).dir, root, file))
    handle('changes:discard', S.ChangesDiscardReq, ({ dir, root, paths }) => this.changes.discard(liveWs(dir).dir, root, paths))
    handle('changes:commit', S.ChangesCommitReq, ({ dir, root, paths, message }) => this.changes.commit(liveWs(dir).dir, root, paths, message))
    handle('checkpoints:list', S.ChangesRootReq, async ({ dir, root }) => this.checkpoints.list(await this.changes.assertRoot(liveWs(dir).dir, root)))
    handle('checkpoints:preview', S.CheckpointReq, async ({ dir, root, id }) =>
      this.checkpoints.preview(await this.changes.assertRoot(liveWs(dir).dir, root), id)
    )
    handle('checkpoints:restore', S.CheckpointReq, async ({ dir, root, id }) =>
      this.checkpoints.restore(await this.changes.assertRoot(liveWs(dir).dir, root), id)
    )

    // ---------------------------------------------------------------- quadro de chamados
    handle('board:get', S.DirReq, ({ dir }) => this.board.get(liveWs(dir).dir))
    handle('board:apply', S.BoardApplyReq, ({ dir, action }) =>
      this.board.mutate(liveWs(dir).dir, (b) => {
        const board = applyBoardAction(b, action, new Date().toISOString())
        return { board, result: board }
      })
    )
    handle('board:assign', S.BoardAssignReq, async ({ dir, id, terminalId }) => {
      const ws = liveWs(dir)
      const node = terminals.node(terminalId)
      if (!node || this.workspaces.forNode(terminalId) !== ws) throw new Error('terminal não encontrado neste workspace')
      const board = await this.board.mutate(ws.dir, (b) => {
        const next = updateCard(b, id, { assignee: node.name }, 'você', new Date().toISOString()).board
        return { board: next, result: next }
      })
      const card = board.cards.find((c) => c.id === id)
      if (!card) throw new Error('cartão não encontrado')
      // Hibernando: acorda (retomando a conversa) antes de entregar.
      const info = await this.hibernation.wakeAndWait(terminalId)
      if (!info || info.status !== 'running')
        throw new Error('"' + node.name + '" não está em execução: o cartão ficou com ele, mas a mensagem não foi entregue')
      const preset = terminals.presetFor(node)
      await ptys.inject(terminalId, assignmentMessage(board, card, CLI_NAME), {
        inputMode: preset.inputMode,
        submitDelayMs: preset.submitDelayMs,
        isShell: preset.isShell
      })
      log.info('cartão passado a um agente', { card: card.id, terminal: terminalId })
      return board
    })

    // ---------------------------------------------------------------- busca e resumo
    handle('search:query', S.SearchReq, ({ q }) => this.search.query(q))
    handle('summary:run', S.IdReq, async ({ id }) => {
      const node = terminals.node(id)
      if (!node) throw new Error('terminal não encontrado')
      const summary = await this.summary.summarize(id, node.name)
      this.bus.emit('summary:ready', { id, summary })
      return summary
    })

    // ---------------------------------------------------------------- notas
    registerNotesIpc({ notes: this.notes, workspaces, bus: this.bus })

    // ---------------------------------------------------------------- partituras
    handle('partituras:list', S.DirReq, ({ dir }) => this.partituras.list(dir))
    handle('partituras:save', S.PartituraSaveReq, ({ dir, name, nodeIds }) => this.partituras.save(dir, name, nodeIds))
    handle('partituras:read', S.PartituraFileReq, ({ dir, file }) => this.partituras.read(dir, file))
    handle('partituras:import', S.PartituraImportReq, ({ dir, file, position }) => this.partituras.insert(dir, file, position))
    handle('partituras:delete', S.PartituraFileReq, ({ dir, file }) => this.partituras.remove(dir, file))
    handle('partituras:importFile', S.PartituraImportFileReq, async ({ dir, position }) => {
      const win = this.bus.window
      const opts = { title: 'Importar partitura', filters: [{ name: 'Partitura (JSON)', extensions: ['json'] }], properties: ['openFile'] as 'openFile'[] }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (res.canceled || !res.filePaths[0]) return null
      const file = await this.partituras.adoptFile(dir, res.filePaths[0])
      return this.partituras.insert(dir, file, position)
    })
    handle('partituras:exportFile', S.PartituraFileReq, async ({ dir, file }) => {
      const win = this.bus.window
      const opts = { title: 'Exportar partitura', defaultPath: file, filters: [{ name: 'Partitura (JSON)', extensions: ['json'] }] }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return false
      await this.partituras.exportTo(dir, file, res.filePath)
      return true
    })

    // ---------------------------------------------------------------- time pronto (exportar / importar)
    handle('team:export', S.TeamExportReq, async ({ dir, name, description, includeNotes }) => {
      const ws = liveWs(dir)
      const win = this.bus.window
      const opts = {
        title: 'Exportar time',
        defaultPath: `${branchSlug(name || ws.doc.name)}.time.json`,
        filters: [{ name: 'Time do Maestrinho (JSON)', extensions: ['json'] }]
      }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return null
      await this.team.exportTo(ws.dir, { name, description, includeNotes }, res.filePath)
      return res.filePath
    })
    handle('team:preview', S.DirReq, async ({ dir }) => {
      const ws = liveWs(dir)
      const win = this.bus.window
      const opts = {
        title: 'Importar time',
        filters: [{ name: 'Time ou partitura do Maestrinho (JSON)', extensions: ['json'] }],
        properties: ['openFile'] as 'openFile'[]
      }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (res.canceled || !res.filePaths[0]) return null
      return this.team.preview(ws.dir, res.filePaths[0])
    })
    handle('team:import', S.TeamImportReq, ({ dir, token, acceptPresets, applyBoard, position, reuseNotes }) =>
      this.team.import(liveWs(dir).dir, token, { acceptPresets, applyBoard, position, reuseNotes })
    )

    on('pty:write', S.WriteMsg, (p) => ptys.writeUser(p.id, p.data))
    on('portal:attach', S.PortalAttachMsg, (p) => void this.portals.attach(p.id, p.webContentsId))
    // Você abriu o terminal no app: o "!" some e o personagem dele sai andando.
    on('ui:focusedTerminal', S.FocusedTerminalMsg, ({ id }) => {
      this.focusedTerminal = id
      if (id) this.buddy.dismiss(id)
      // As duas janelas (principal e chat destacado) ficam sabendo: o aviso some em todas.
      this.bus.emit('attention:focus', { id })
    })
    on('pty:resize', S.ResizeMsg, (p) => ptys.resize(p.id, p.cols, p.rows))
    // O renderer trocou de tema: repinta os botões do sistema da janela dele.
    on('ui:theme', S.ThemeMsg, ({ theme }, event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) applyTitleBarTheme(win, theme)
    })
  }

  /** Abre o último workspace usado (se existir). */
  async restoreLastWorkspace(): Promise<void> {
    const last = this.config.settings.lastWorkspace
    if (!last || !fs.existsSync(last)) return
    try {
      const res = await this.workspaces.open(last)
      if (res.corrupted) log.warn('último workspace está corrompido; aguardando decisão do usuário')
    } catch (err) {
      log.warn('não foi possível reabrir o último workspace', err instanceof Error ? err : undefined)
    }
  }

  shutdown(): void {
    this.shuttingDown = true
    try {
      this.routines.stop()
      this.usageWatch.stop()
      this.fileTriggers.stopAll()
      this.chat.dispose()
      this.chatWindow.close()
      this.office.stop()
      this.hibernation.stop()
      this.handlers.dispose()
      this.notifier.dispose()
      this.buddy.dispose()
      void this.api.stop()
      void this.notes.closeAll()
      this.workspaces.flushAllSync()
      this.config.flushSync()
    } finally {
      this.terminals.stopAll()
      this.ptys.disposeAll()
    }
  }
}
