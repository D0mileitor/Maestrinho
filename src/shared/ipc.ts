import type { AttachResult, EdgeActivityEvent, PtyDataEvent, TerminalRuntimeInfo } from './runtime'
import type { ChatSnapshot, ChatUpdate } from './chat'
import type { OfficeActivity } from './office'
import type { HubPage } from './hub'
import type { UsagePause, UsageReport } from './usage'
import type { Checkpoint, CheckpointPlan } from './checkpoints'
import type { ActivityEvent } from './activity'
import type { BoardAction, BoardFile } from './board'
import type { ChangedFile, FileDiff } from './changes'
import type { TeamPreview } from './team'
import type { ChatRoute } from './chatWindow'
import type {
  AgentPreset,
  AppConfig,
  CanvasEdge,
  CanvasNode,
  Floor,
  OfficeSceneRef,
  Partitura,
  Role,
  Routine,
  RoutineRun,
  Settings,
  Viewport,
  WorkspaceDoc
} from './schemas'

/**
 * Contrato IPC entre renderer e main. Os nomes de canal são a lista branca usada pelo preload;
 * todo payload recebido no main é validado com zod (ver main/ipc/handlers.ts).
 */

export interface AppInfo {
  appName: string
  version: string
  platform: 'win32' | 'linux' | 'darwin' | (string & {})
  cliName: string
  userDataDir: string
  apiPort: number
  electron: string
  node: string
  chrome: string
}

export interface WorkspaceOpenResult {
  dir: string
  doc: WorkspaceDoc
  /** Preenchido quando o workspace.json estava corrompido e foi restaurado de um backup. */
  restoredFrom?: string
  /** Erro de leitura que impediu abrir (o usuário pode optar por restaurar um backup). */
  corrupted?: { error: string; backups: string[] }
  isGitRepo: boolean
}

export interface WorkspaceListItem {
  dir: string
  name: string
  /** Carregado nesta sessão (terminais podem estar rodando em segundo plano). */
  live: boolean
  active: boolean
  exists: boolean
}

export interface NoteInfo {
  file: string
  size: number
  mtimeMs: number
}

/** Operações de mutação do documento do workspace (main é a fonte da verdade). */
export type WorkspaceOp =
  | { op: 'addNodes'; nodes: CanvasNode[] }
  | { op: 'updateNode'; id: string; patch: Partial<CanvasNode> }
  | { op: 'removeNodes'; ids: string[] }
  | { op: 'addEdges'; edges: CanvasEdge[] }
  | { op: 'removeEdges'; ids: string[] }
  | { op: 'setViewport'; viewport: Viewport }
  | { op: 'setActiveFloor'; floorId: string | null }
  | { op: 'setName'; name: string }
  | { op: 'setFloors'; floors: Floor[] }
  | { op: 'setOfficeScene'; scene: OfficeSceneRef | null }

export interface EnsureTerminalRequest {
  id: string
  cols: number
  rows: number
}

export interface SavePartituraRequest {
  name: string
  nodeIds: string[]
}

export interface ImportPartituraRequest {
  file: string
  position: { x: number; y: number }
}

export interface PartituraImportReport {
  nodes: number
  edges: number
  rolesAdded: string[]
  notesCreated: string[]
  /** Terminais cujo preset não existe nesta máquina (viraram "shell"). */
  presetFallbacks: string[]
  insertedIds: string[]
}

export interface FloorCreateRequest {
  name: string
  baseBranch?: string
}

export interface FloorStatus {
  branch: string
  baseBranch: string
  ahead: number
  behind: number
  dirty: boolean
  mergeHint: string
}

/** Routine com estado de execução (para a interface). */
export interface RoutineView extends Routine {
  nextRunAt: number
  running: { step: number; total: number } | null
}

export interface RoutinesState {
  routines: RoutineView[]
  history: RoutineRun[]
}

export interface SearchResult {
  /** 'output' = um trecho da saída de um terminal (terminalId + linha do buffer). */
  kind: 'terminal' | 'note' | 'portal' | 'shape' | 'workspace' | 'floor' | 'action' | 'output'
  id: string
  terminalId?: string
  line?: number
  label: string
  detail?: string
  /** Workspace ao qual o item pertence. */
  dir?: string
  floorId?: string
  score: number
}

/** Modelos e esforços oferecidos ao criar/editar terminais, por tipo de agente. */
export interface AgentCatalog {
  claude: { models: AgentModelInfo[]; efforts: string[] }
  codex: { models: AgentModelInfo[]; efforts: string[] }
}
export interface AgentModelInfo {
  id: string
  label: string
  description?: string
  defaultEffort?: string
  /** Esforços aceitos por este modelo (vazio = os do tipo de agente). */
  efforts: string[]
}

/** Chamadas renderer -> main com resposta (ipcRenderer.invoke). */
export interface InvokeMap {
  'app:info': { req: void; res: AppInfo }
  'app:openExternal': { req: { url: string }; res: void }
  'app:openPath': { req: { path: string }; res: void }
  'config:get': { req: void; res: AppConfig }
  'config:setSettings': { req: Partial<Settings>; res: Settings }
  'config:savePreset': { req: AgentPreset; res: AgentPreset[] }
  'config:deletePreset': { req: { id: string }; res: AgentPreset[] }
  'config:resetPresets': { req: void; res: AgentPreset[] }
  'config:saveRole': { req: Role; res: Role[] }
  'config:deleteRole': { req: { id: string }; res: Role[] }
  /** Quais presets têm o comando encontrado no PATH. */
  'presets:availability': { req: void; res: Record<string, boolean> }
  /** Modelos e esforços de cada tipo de agente (Claude Code: apelidos; Codex: lista do próprio Codex). */
  'agents:catalog': { req: void; res: AgentCatalog }
  /** Uso da assinatura (5 h, semana) que cada agente guarda no disco; sem rede. */
  'usage:get': { req: { agents: boolean }; res: UsageReport }
  /** Linha do tempo (só metadados) desde `since` (ms). */
  'activity:list': { req: { since?: number }; res: ActivityEvent[] }
  'workspace:pickDirectory': { req: void; res: string | null }
  'workspace:list': { req: void; res: WorkspaceListItem[] }
  'workspace:open': { req: { dir: string }; res: WorkspaceOpenResult }
  'workspace:restoreBackup': { req: { dir: string; backup: string }; res: WorkspaceOpenResult }
  'workspace:active': { req: void; res: WorkspaceOpenResult | null }
  'workspace:applyOps': { req: { dir: string; ops: WorkspaceOp[] }; res: void }
  'workspace:close': { req: { dir: string }; res: void }
  'workspace:forget': { req: { dir: string }; res: void }
  'pty:ensure': { req: EnsureTerminalRequest; res: TerminalRuntimeInfo }
  'pty:attach': { req: { id: string }; res: AttachResult | null }
  'pty:restart': { req: { id: string }; res: TerminalRuntimeInfo | null }
  /** Reinicia o agente numa conversa nova (descarta a retomada da sessão anterior). */
  'pty:newSession': { req: { id: string }; res: TerminalRuntimeInfo | null }
  /** Nova tarefa: estes agentes começam uma conversa nova (shells ficam de fora; hibernados não acordam). */
  'pty:newTask': { req: { dir: string; ids: string[] }; res: { restarted: number; later: number } }
  /** Instala o orq remoto agora (terminais SSH), mesmo sem detectar o prompt. */
  'pty:remoteBootstrap': { req: { id: string }; res: void }
  'pty:kill': { req: { id: string }; res: void }
  /** Hiberna o agente (encerra o processo guardando a conversa); erro em pt-BR se não puder. */
  'pty:hibernate': { req: { id: string }; res: void }
  /** Acorda um agente hibernando (retoma a conversa). */
  'pty:wake': { req: { id: string }; res: TerminalRuntimeInfo | null }
  'pty:infoAll': { req: void; res: TerminalRuntimeInfo[] }
  'pty:readText': { req: { id: string; lines: number; screen?: boolean }; res: string }
  'pty:sendMessage': { req: { id: string; text: string }; res: void }
  /** Grava a imagem da área de transferência como PNG local e devolve o caminho (null se não houver imagem). */
  'clipboard:saveImage': { req: void; res: string | null }
  /** Abre o chat ligado a um terminal (histórico da sessão do Claude Code, ou só a tela). */
  'chat:open': { req: { id: string }; res: ChatSnapshot }
  'chat:close': { req: { id: string }; res: void }
  /** Digita a mensagem do chat no terminal (prints como caminhos colados, depois o texto e Enter). */
  /** `files`: PDFs anexados (o agente recebe o caminho e abre). */
  'chat:send': { req: { id: string; text: string; images: string[]; files?: string[] }; res: void }
  /** Miniatura de um PDF anexado (a do Windows; null se não houver). */
  'chat:fileThumb': { req: { path: string }; res: string | null }
  /** Destaca o chat numa janela própria (ou a traz para a frente), na aba indicada. */
  'chat:detach': { req: { dir: string; tab: string }; res: void }
  /** O chat está destacado numa janela própria? */
  'chat:windowOpen': { req: void; res: boolean }
  /** Janela principal → chat destacado: abrir aba, nota... e trazer a janela para a frente. */
  'chat:route': { req: ChatRoute; res: void }
  /** Chat destacado → janela principal: devolve o chat ao painel (na mesma aba). */
  'chat:dock': { req: { dir: string; tab: string }; res: void }
  /** Chat destacado informa a aba aberta (para devolver no mesmo lugar). */
  'chat:tab': { req: { dir: string; tab: string }; res: void }
  /** Chat destacado: mostrar o nó no canvas da janela principal. */
  'chat:focusCanvas': { req: { dir: string; id: string }; res: void }
  /** Escritório aberto: observa a atividade destes terminais (lista vazia = parar). */
  'office:watch': { req: { ids: string[] }; res: void }
  /** Imagens de fundo do escritório enviadas pelo usuário (pasta .maestrinho/cenarios do projeto). */
  'office:backgrounds': { req: { dir: string }; res: { file: string; bytes: number }[] }
  /** Abre a escolha de arquivo e copia a imagem para o projeto; null se cancelar. */
  'office:addBackground': { req: { dir: string }; res: string | null }
  /** Conteúdo da imagem como data URL (para desenhar no canvas). */
  'office:readBackground': { req: { dir: string; file: string }; res: string }
  'office:removeBackground': { req: { dir: string; file: string }; res: void }
  /** Personagens próprios do escritório (folhas de sprites em .maestrinho/personagens). */
  'office:characters': { req: { dir: string }; res: { file: string; bytes: number }[] }
  'office:addCharacter': { req: { dir: string }; res: string | null }
  'office:readCharacter': { req: { dir: string; file: string }; res: string }
  'office:removeCharacter': { req: { dir: string; file: string }; res: void }
  /** Salva (com a janela de salvar) a folha-modelo PNG gerada pela interface. */
  'office:saveCharacterTemplate': { req: { dataUrl: string }; res: string | null }
  /** Mostra um aviso de exemplo com o personagem (Configurações → Ver como fica). */
  'buddy:test': { req: void; res: void }
  /** Partituras prontas (catálogo embutido no app): lista com busca e inserção no canvas (guarda na biblioteca e insere). */
  'hub:list': { req: { q: string }; res: HubPage }
  'hub:insert': { req: { dir: string; id: string; position: { x: number; y: number } }; res: PartituraImportReport & { name: string } }
  'notes:list': { req: { dir: string }; res: NoteInfo[] }
  'notes:read': { req: { dir: string; file: string }; res: string }
  'notes:write': { req: { dir: string; file: string; content: string }; res: void }
  'notes:create': { req: { dir: string; file: string; content?: string }; res: string }
  'routines:list': { req: { dir: string }; res: RoutinesState }
  'routines:save': { req: { dir: string; routine: Routine }; res: RoutinesState }
  'routines:delete': { req: { dir: string; id: string }; res: RoutinesState }
  'routines:runNow': { req: { dir: string; id: string }; res: void }
  'routines:cancel': { req: { dir: string; id: string }; res: void }
  'floors:create': { req: { dir: string } & FloorCreateRequest; res: Floor }
  'floors:discard': { req: { dir: string; id: string; force?: boolean }; res: void }
  'floors:status': { req: { dir: string; id: string }; res: FloorStatus }
  'floors:branches': { req: { dir: string }; res: string[] }
  'partituras:list': { req: { dir: string }; res: { file: string; name: string; createdAt: string; nodes: number }[] }
  'partituras:save': { req: { dir: string } & SavePartituraRequest; res: string }
  'partituras:read': { req: { dir: string; file: string }; res: Partitura }
  'partituras:import': { req: { dir: string } & ImportPartituraRequest; res: PartituraImportReport }
  /** Abre um arquivo .json de partitura (diálogo), copia para a biblioteca e insere no canvas. */
  'partituras:importFile': { req: { dir: string; position: { x: number; y: number } }; res: PartituraImportReport | null }
  'partituras:exportFile': { req: { dir: string; file: string }; res: boolean }
  'partituras:delete': { req: { dir: string; file: string }; res: void }
  /** Time pronto: exporta o canvas inteiro (com presets e colunas do quadro) num arquivo; null se cancelar. */
  'team:export': { req: { dir: string; name: string; description: string; includeNotes: boolean }; res: string | null }
  /** Abre um arquivo de time (ou partitura) e devolve a prévia; null se cancelar. */
  'team:preview': { req: { dir: string }; res: TeamPreview | null }
  'team:import': {
    req: { dir: string; token: string; acceptPresets: string[]; applyBoard: boolean; position: { x: number; y: number }; reuseNotes?: string[] }
    res: PartituraImportReport & { presetsAdded: string[]; boardApplied: boolean }
  }
  'search:query': { req: { q: string }; res: SearchResult[] }
  /** Revisão das mudanças: repositórios do workspace, arquivos alterados, diff, descartar e commit. */
  'changes:repos': { req: { dir: string }; res: { root: string; label: string; branch: string }[] }
  'changes:status': { req: { dir: string; root: string }; res: { branch: string; files: ChangedFile[]; truncated: boolean } }
  'changes:diff': { req: { dir: string; root: string; path: string }; res: FileDiff }
  'changes:discard': { req: { dir: string; root: string; paths: string[] }; res: void }
  /** Checkpoints do repositório (antes de cada turno dos agentes), do mais novo para o mais antigo. */
  'checkpoints:list': { req: { dir: string; root: string }; res: Checkpoint[] }
  'checkpoints:preview': { req: { dir: string; root: string; id: string }; res: CheckpointPlan }
  'checkpoints:restore': { req: { dir: string; root: string; id: string }; res: { restored: number; removed: number } }
  'changes:commit': { req: { dir: string; root: string; paths: string[]; message: string }; res: { hash: string } }
  /** Quadro de chamados do workspace. */
  'board:get': { req: { dir: string }; res: BoardFile }
  'board:apply': { req: { dir: string; action: BoardAction }; res: BoardFile }
  /** Passa o cartão para um agente: vira o responsável e recebe a mensagem no terminal (acorda se hibernando). */
  'board:assign': { req: { dir: string; id: string; terminalId: string }; res: BoardFile }
  'summary:run': { req: { id: string }; res: string }
}

/** Mensagens renderer -> main sem resposta (ipcRenderer.send) — alta frequência. */
export interface SendMap {
  'pty:write': { id: string; data: string }
  'pty:resize': { id: string; cols: number; rows: number }
  /** Terminal em foco no app (para o aviso com o personagem acompanhar o "!"). */
  'ui:focusedTerminal': { id: string | null }
  /** Tema efetivo da janela (para pintar os botões do sistema na barra de título). */
  'ui:theme': { theme: 'dark' | 'light' }
  /** A página de um portal carregou: o main guarda qual webview é de qual nó (orq portal). */
  'portal:attach': { id: string; webContentsId: number }
}

/** Eventos main -> renderer (webContents.send). */
export interface EventMap {
  'pty:data': PtyDataEvent
  'pty:info': TerminalRuntimeInfo
  'workspace:ops': { dir: string; ops: WorkspaceOp[] }
  'workspace:listChanged': WorkspaceListItem[]
  'workspace:activated': { dir: string | null }
  'edge:activity': EdgeActivityEvent
  'note:changed': { dir: string; file: string }
  'notes:listChanged': { dir: string }
  'routines:changed': { dir: string } & RoutinesState
  'config:changed': AppConfig
  'app:toast': { level: 'info' | 'warn' | 'error'; message: string }
  'canvas:focusNode': { dir: string; id: string }
  'summary:ready': { id: string; summary: string }
  'chat:update': ChatUpdate
  'office:activity': OfficeActivity
  'board:changed': { dir: string; board: BoardFile }
  /** Abrir o escritório com o chat na aba deste agente (ex.: "Abrir" no aviso do personagem). */
  'chat:openAgent': { dir: string; id: string }
  /** Janela principal: o chat destacado abriu/fechou (reopen = devolvido ao painel, nesta aba). */
  'chat:windowState': { open: boolean; reopen?: { dir: string; tab: string } }
  /** Chat destacado: pedido vindo da janela principal. */
  'chat:route': ChatRoute
  /** O terminal que você está vendo agora, em qualquer janela (canvas, escritório ou chat): o "!" dele some em todas. */
  'attention:focus': { id: string | null }
  /** A pausa automática por limite da assinatura começou ou acabou. */
  'usage:changed': { pause: UsagePause | null }
  /** Algo novo na linha do tempo. */
  'activity:new': ActivityEvent
}

export type InvokeChannel = keyof InvokeMap
export type SendChannel = keyof SendMap
export type EventChannel = keyof EventMap

/** Listas brancas usadas pelo preload (devem conter exatamente as chaves dos mapas acima). */
export const INVOKE_CHANNELS = [
  'app:info',
  'app:openExternal',
  'app:openPath',
  'config:get',
  'config:setSettings',
  'config:savePreset',
  'config:deletePreset',
  'config:resetPresets',
  'config:saveRole',
  'config:deleteRole',
  'presets:availability',
  'agents:catalog',
  'usage:get',
  'activity:list',
  'workspace:pickDirectory',
  'workspace:list',
  'workspace:open',
  'workspace:restoreBackup',
  'workspace:active',
  'workspace:applyOps',
  'workspace:close',
  'workspace:forget',
  'pty:ensure',
  'pty:attach',
  'pty:restart',
  'pty:newSession',
  'pty:newTask',
  'pty:remoteBootstrap',
  'pty:kill',
  'pty:hibernate',
  'pty:wake',
  'pty:infoAll',
  'pty:readText',
  'pty:sendMessage',
  'clipboard:saveImage',
  'chat:open',
  'chat:close',
  'chat:send',
  'chat:fileThumb',
  'chat:detach',
  'chat:windowOpen',
  'chat:route',
  'chat:dock',
  'chat:tab',
  'chat:focusCanvas',
  'office:watch',
  'office:backgrounds',
  'office:addBackground',
  'office:readBackground',
  'office:characters',
  'office:addCharacter',
  'office:readCharacter',
  'office:removeCharacter',
  'office:saveCharacterTemplate',
  'office:removeBackground',
  'buddy:test',
  'hub:list',
  'hub:insert',
  'notes:list',
  'notes:read',
  'notes:write',
  'notes:create',
  'routines:list',
  'routines:save',
  'routines:delete',
  'routines:runNow',
  'routines:cancel',
  'floors:create',
  'floors:discard',
  'floors:status',
  'floors:branches',
  'partituras:list',
  'partituras:save',
  'partituras:read',
  'partituras:import',
  'partituras:importFile',
  'partituras:exportFile',
  'partituras:delete',
  'team:export',
  'team:preview',
  'team:import',
  'search:query',
  'changes:repos',
  'changes:status',
  'changes:diff',
  'changes:discard',
  'checkpoints:list',
  'checkpoints:preview',
  'checkpoints:restore',
  'changes:commit',
  'board:get',
  'board:apply',
  'board:assign',
  'summary:run'
] as const satisfies readonly InvokeChannel[]

export const SEND_CHANNELS = ['pty:write', 'pty:resize', 'ui:focusedTerminal', 'ui:theme', 'portal:attach'] as const satisfies readonly SendChannel[]

export const EVENT_CHANNELS = [
  'pty:data',
  'pty:info',
  'workspace:ops',
  'workspace:listChanged',
  'workspace:activated',
  'edge:activity',
  'note:changed',
  'notes:listChanged',
  'routines:changed',
  'config:changed',
  'app:toast',
  'canvas:focusNode',
  'summary:ready',
  'chat:update',
  'office:activity',
  'board:changed',
  'chat:openAgent',
  'chat:windowState',
  'chat:route',
  'attention:focus',
  'usage:changed',
  'activity:new'
] as const satisfies readonly EventChannel[]

// Verificação em tempo de compilação: as listas cobrem todas as chaves.
type Missing<A extends string, L extends readonly string[]> = Exclude<A, L[number]>
const _invokeComplete: Missing<InvokeChannel, typeof INVOKE_CHANNELS> extends never ? true : never = true
const _sendComplete: Missing<SendChannel, typeof SEND_CHANNELS> extends never ? true : never = true
const _eventComplete: Missing<EventChannel, typeof EVENT_CHANNELS> extends never ? true : never = true
void _invokeComplete
void _sendComplete
void _eventComplete

/** API exposta pelo preload em `window.maestrinho`. */
export interface PreloadApi {
  invoke<K extends InvokeChannel>(channel: K, ...args: InvokeMap[K]['req'] extends void ? [] : [InvokeMap[K]['req']]): Promise<InvokeMap[K]['res']>
  send<K extends SendChannel>(channel: K, payload: SendMap[K]): void
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void
  /** Caminho de arquivo de um File arrastado para a janela (webUtils). */
  pathForFile(file: File): string
}
