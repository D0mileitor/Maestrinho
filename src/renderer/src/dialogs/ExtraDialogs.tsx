import type { DialogState } from '../store/appStore'
import { useApp } from '../store/appStore'
import { SettingsDialog } from './SettingsDialog'
import { RoutinesDialog } from './RoutinesDialog'
import { FloorCreateDialog, FloorManageDialog } from './FloorDialogs'
import { PartiturasDialog } from './PartiturasDialog'
import { PortalCreateDialog } from './PortalCreateDialog'
import { RolesDialog } from './RolesDialog'
import { EditTerminalDialog } from './EditTerminalDialog'
import { NoteCreateDialog } from './NoteCreateDialog'
import { TeamImportDialog } from './TeamDialogs'

/** Diálogos das fases 3–6 (papéis, rotinas, partituras, floors, notas, portais). */
export function ExtraDialogs({ dialog }: { dialog: DialogState }): React.JSX.Element | null {
  const setDialog = useApp((s) => s.setDialog)
  switch (dialog.kind) {
    case 'settings':
      return <SettingsDialog />
    case 'routines':
      return <RoutinesDialog />
    case 'floorCreate':
      return <FloorCreateDialog />
    case 'floorManage':
      return <FloorManageDialog floorId={dialog.floorId} />
    case 'partituras':
      return <PartiturasDialog />
    case 'portalCreate':
      return <PortalCreateDialog rect={dialog.rect} />
    case 'roles':
      return <RolesDialog />
    case 'editTerminal':
      return <EditTerminalDialog id={dialog.id} initialTab={dialog.tab} />
    case 'noteCreate':
      return <NoteCreateDialog rect={dialog.rect} />
    case 'teamImport':
      return <TeamImportDialog preview={dialog.preview} />
    default:
      // Todos os tipos de diálogo têm tela; um tipo desconhecido simplesmente fecha.
      queueMicrotask(() => setDialog({ kind: 'none' }))
      return null
  }
}
