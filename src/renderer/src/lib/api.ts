import type { PreloadApi } from '@shared/ipc'
import { t } from '../i18n'

/** Ponte tipada para o processo principal (exposta pelo preload). */
export const api: PreloadApi = window.maestrinho

/** Mensagem de erro legível a partir de um erro do IPC. */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return t.errors.ipc(raw)
}
