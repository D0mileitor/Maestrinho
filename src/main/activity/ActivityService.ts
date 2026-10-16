import type { ActivityEvent } from '@shared/activity'

/** Eventos guardados (de todos os workspaces); os mais antigos saem. */
const MAX_EVENTS = 1000

/**
 * Linha do tempo em memória (só metadados: quem, o quê, quando). Cada evento novo vai para a interface
 * na hora; ao abrir, a interface pede a lista.
 */
export class ActivityService {
  private seq = 0
  private readonly events: ActivityEvent[] = []

  constructor(private readonly emit: (e: ActivityEvent) => void) {}

  add(e: Omit<ActivityEvent, 'id' | 'at'>, at = Date.now()): ActivityEvent {
    const full: ActivityEvent = { ...e, id: ++this.seq, at }
    this.events.push(full)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    this.emit(full)
    return full
  }

  list(since = 0): ActivityEvent[] {
    return this.events.filter((e) => e.at >= since)
  }
}
