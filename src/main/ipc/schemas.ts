import { z } from 'zod'
import { HUB_ID_RE } from '@shared/hub'
import { BoardActionSchema } from '@shared/board'
import {
  AgentPresetSchema,
  CanvasNodeSchema,
  EdgeSchema,
  FloorSchema,
  IdSchema,
  OfficeSceneRefSchema,
  RoleSchema,
  RoutineSchema,
  SettingsSchema,
  ViewportSchema,
  BACKGROUND_FILE_RE,
  CHARACTER_FILE_RE
} from '@shared/schemas'

/** Validação dos payloads IPC recebidos do renderer. */

export const DirReq = z.object({ dir: z.string().min(1).max(4096) })
export const IdReq = z.object({ id: IdSchema })
export const DirIdReq = DirReq.extend({ id: IdSchema })
export const NewTaskReq = DirReq.extend({ ids: z.array(IdSchema).max(500) })

const PatchSchema = z.record(z.string().max(40), z.unknown()).refine((o) => Object.keys(o).length <= 30, 'patch grande demais')

export const WorkspaceOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addNodes'), nodes: z.array(CanvasNodeSchema).max(500) }),
  z.object({ op: z.literal('updateNode'), id: IdSchema, patch: PatchSchema }),
  z.object({ op: z.literal('removeNodes'), ids: z.array(IdSchema).max(2000) }),
  z.object({ op: z.literal('addEdges'), edges: z.array(EdgeSchema).max(2000) }),
  z.object({ op: z.literal('removeEdges'), ids: z.array(IdSchema).max(10_000) }),
  z.object({ op: z.literal('setViewport'), viewport: ViewportSchema }),
  z.object({ op: z.literal('setActiveFloor'), floorId: IdSchema.nullable() }),
  z.object({ op: z.literal('setName'), name: z.string().min(1).max(120) }),
  z.object({ op: z.literal('setFloors'), floors: z.array(FloorSchema).max(50) }),
  z.object({ op: z.literal('setOfficeScene'), scene: OfficeSceneRefSchema.nullable() })
])

export const ApplyOpsReq = DirReq.extend({ ops: z.array(WorkspaceOpSchema).min(1).max(200) })

export const EnsureReq = z.object({ id: IdSchema, cols: z.number().int().min(2).max(1000), rows: z.number().int().min(1).max(500) })

export const WriteMsg = z.object({ id: IdSchema, data: z.string().max(1_000_000) })
export const PortalAttachMsg = z.object({ id: IdSchema, webContentsId: z.number().int().positive() })
export const FocusedTerminalMsg = z.object({ id: IdSchema.nullable() })
export const ResizeMsg = EnsureReq
export const ThemeMsg = z.object({ theme: z.enum(['dark', 'light']) })

type SettingsShape = typeof SettingsSchema.shape
type SettingsPatchShape = { [K in keyof SettingsShape]: z.ZodOptional<SettingsShape[K] extends z.ZodDefault<infer T> ? T : SettingsShape[K]> }

/**
 * Atualização parcial das preferências. Não usar SettingsSchema.partial(): no zod 4 os campos com
 * .default() continuam recebendo o padrão mesmo opcionais, e um patch { officeScene } (ou { theme })
 * voltaria todo o resto ao padrão — inclusive a lista de workspaces recentes da barra lateral.
 */
export const SettingsPatchReq = z.object(
  Object.fromEntries(Object.entries(SettingsSchema.shape).map(([k, s]) => [k, (s instanceof z.ZodDefault ? s.unwrap() : s).optional()])) as SettingsPatchShape
)
export const PresetReq = AgentPresetSchema
export const RoleReq = RoleSchema

export const NoteFileReq = DirReq.extend({ file: z.string().min(1).max(200) })
export const NoteWriteReq = NoteFileReq.extend({ content: z.string().max(5_000_000) })
export const NoteCreateReq = NoteFileReq.extend({ content: z.string().max(5_000_000).optional() })

export const RoutineSaveReq = DirReq.extend({ routine: RoutineSchema })

export const FloorCreateReq = DirReq.extend({ name: z.string().min(1).max(60), baseBranch: z.string().max(200).optional() })
export const FloorDiscardReq = DirIdReq.extend({ force: z.boolean().optional() })

export const PartituraSaveReq = DirReq.extend({ name: z.string().min(1).max(120), nodeIds: z.array(IdSchema).min(1).max(500) })
export const PartituraFileReq = DirReq.extend({ file: z.string().min(1).max(200) })
const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() })
export const PartituraImportReq = PartituraFileReq.extend({ position: PointSchema })
export const PartituraImportFileReq = DirReq.extend({ position: PointSchema })

export const SearchReq = z.object({ q: z.string().max(500) })
export const UrlReq = z.object({ url: z.string().min(1).max(4096) })
export const PathReq = z.object({ path: z.string().min(1).max(4096) })
export const OfficeWatchReq = z.object({ ids: z.array(IdSchema).max(500) })
export const BackgroundReq = DirReq.extend({ file: z.string().regex(BACKGROUND_FILE_RE) })
export const HubListReq = z.object({ q: z.string().max(120) })
export const UsageGetReq = z.object({ agents: z.boolean() })
export const CharacterReq = DirReq.extend({ file: z.string().regex(CHARACTER_FILE_RE) })
export const CharacterTemplateReq = z.object({ dataUrl: z.string().max(2_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/) })
export const ActivityListReq = z.object({ since: z.number().int().min(0).optional() })
export const HubInsertReq = DirReq.extend({ id: z.string().regex(HUB_ID_RE), position: z.object({ x: z.number().finite(), y: z.number().finite() }) })
export const ChatSendReq = z.object({
  id: IdSchema,
  text: z.string().max(100_000),
  images: z.array(z.string().min(1).max(4096)).max(10),
  files: z.array(z.string().min(1).max(4096)).max(10).default([])
})
export const ChatThumbReq = z.object({ path: z.string().min(1).max(4096) })
/** `screen`: linhas físicas da tela como aparecem (para achar perguntas com opções); senão, linhas lógicas. */
export const ReadTextReq = z.object({ id: IdSchema, lines: z.number().int().min(1).max(5000), screen: z.boolean().optional() })
export const SendMessageReq = z.object({ id: IdSchema, text: z.string().min(1).max(200_000) })
const RootReq = DirReq.extend({ root: z.string().min(1).max(4096) })
const RelPath = z.string().min(1).max(4096)
export const ChangesRootReq = RootReq
export const ChangesDiffReq = RootReq.extend({ path: RelPath })
export const ChangesDiscardReq = RootReq.extend({ paths: z.array(RelPath).min(1).max(3000) })
export const ChangesCommitReq = ChangesDiscardReq.extend({ message: z.string().min(1).max(20_000) })
export const CheckpointReq = RootReq.extend({ id: z.string().regex(/^refs\/maestrinho\/checkpoints\/\d{13}-[A-Za-z0-9_-]{1,64}$/) })
export const TeamExportReq = DirReq.extend({ name: z.string().max(120), description: z.string().max(2000), includeNotes: z.boolean() })
export const TeamImportReq = DirReq.extend({
  token: z.string().regex(/^[0-9a-f]{24}$/),
  acceptPresets: z.array(IdSchema).max(50),
  applyBoard: z.boolean(),
  position: PointSchema,
  reuseNotes: z.array(z.string().min(1).max(200)).max(200).default([])
})
const ChatDir = z.string().min(1).max(4096)
const ChatTab = z.union([z.literal('geral'), IdSchema])
export const ChatTabReq = z.object({ dir: ChatDir, tab: ChatTab })
export const ChatFocusReq = z.object({ dir: ChatDir, id: IdSchema })
export const ChatRouteReq = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('show'), dir: ChatDir }),
  z.object({ kind: z.literal('agent'), dir: ChatDir, id: IdSchema }),
  z.object({ kind: z.literal('note'), dir: ChatDir, id: IdSchema }),
  z.object({ kind: z.literal('noteFile'), dir: ChatDir, file: z.string().min(1).max(200) })
])
export const BoardApplyReq = DirReq.extend({ action: BoardActionSchema })
export const BoardAssignReq = DirReq.extend({ id: IdSchema, terminalId: IdSchema })
export const RestoreReq = DirReq.extend({ backup: z.string().max(200) })
