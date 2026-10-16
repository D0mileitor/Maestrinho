/**
 * Chat destacado numa janela própria (pode ir para outro monitor). Lógica pura: o que a janela principal
 * repassa para ela e onde ela reabre.
 */

/** Pedido que a janela principal repassa ao chat destacado (ex.: clique num agente do escritório). */
export type ChatRoute =
  | { kind: 'show'; dir: string }
  | { kind: 'agent'; dir: string; id: string }
  | { kind: 'note'; dir: string; id: string }
  | { kind: 'noteFile'; dir: string; file: string }

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export const CHAT_WINDOW_DEFAULT = { width: 600, height: 860 }
export const CHAT_WINDOW_MIN = { width: 420, height: 420 }

/**
 * Posição para reabrir a janela: a salva, se ela ainda aparece o suficiente em algum monitor (o
 * monitor pode ter sido desligado); senão, ao lado direito da janela principal, dentro do monitor dela.
 */
export function fitChatBounds(saved: Bounds | null, displays: readonly Bounds[], main: Bounds | null): Bounds {
  const visible = (b: Bounds): boolean =>
    displays.some((d) => {
      const w = Math.min(b.x + b.width, d.x + d.width) - Math.max(b.x, d.x)
      const h = Math.min(b.y + b.height, d.y + d.height) - Math.max(b.y, d.y)
      return w >= 120 && h >= 80
    })
  if (saved && saved.width >= CHAT_WINDOW_MIN.width && saved.height >= CHAT_WINDOW_MIN.height && visible(saved)) return saved
  const area =
    (main && displays.find((d) => main.x + main.width / 2 >= d.x && main.x + main.width / 2 < d.x + d.width && main.y + main.height / 2 >= d.y && main.y + main.height / 2 < d.y + d.height)) ??
    displays[0] ?? { x: 0, y: 0, width: 1280, height: 800 }
  const width = Math.min(CHAT_WINDOW_DEFAULT.width, area.width)
  const height = Math.min(CHAT_WINDOW_DEFAULT.height, area.height)
  const x = main ? Math.min(main.x + main.width - width - 24, area.x + area.width - width) : area.x + area.width - width
  const y = main ? Math.max(area.y, main.y + 60) : area.y
  return { x: Math.max(area.x, x), y: Math.min(y, area.y + area.height - height), width, height }
}
