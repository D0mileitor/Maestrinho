import type { PreloadApi } from '../shared/ipc'

declare global {
  interface Window {
    maestrinho: PreloadApi
  }
}

export {}
