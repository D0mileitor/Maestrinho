import { planNewTask } from '@shared/newTask'
import type { TerminalNodeData } from '@shared/schemas'
import { useApp } from '../store/appStore'
import { api, errorMessage } from '../lib/api'
import { teamChatText as G } from '../i18n/teamChat'

/**
 * Nova tarefa no andar em exibição: mostra quem recomeça (e quem seria interrompido) e, confirmado, pede ao
 * processo principal conversas novas nos agentes. O chat geral e as abas se limpam sozinhos: cada um mostra a
 * conversa atual do agente.
 */
export function askNewTask(): void {
  const s = useApp.getState()
  const active = s.active
  if (!active) return
  const floor = active.doc.activeFloorId ?? null
  const terminals = active.doc.nodes.filter((n): n is TerminalNodeData => n.kind === 'terminal' && (n.floorId ?? null) === floor)
  const presets = s.config?.presets ?? []
  // Preset que não existe mais: o terminal roda como shell, então fica de fora.
  const plan = planNewTask(terminals, (id) => presets.find((p) => p.id === id)?.isShell ?? true, (id) => s.runtime[id])
  const targets = [...plan.restart, ...plan.later]
  if (targets.length === 0) {
    s.toast('info', G.newTaskNone)
    return
  }
  const dir = active.dir
  const names = (list: { name: string }[]): string[] => list.map((t) => t.name)
  s.setDialog({
    kind: 'confirm',
    title: G.newTaskTitle,
    body: G.newTaskConfirm({ now: names(plan.restart), later: names(plan.later), busy: names(plan.busy), shells: names(plan.shells) }),
    confirmLabel: G.newTaskConfirmLabel,
    danger: plan.busy.length > 0,
    onConfirm: async () => {
      try {
        const r = await api.invoke('pty:newTask', { dir, ids: targets.map((t) => t.id) })
        useApp.getState().toast('info', G.newTaskDone(r.restarted + r.later))
      } catch (err) {
        useApp.getState().toast('error', errorMessage(err))
      }
    }
  })
}
