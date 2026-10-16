import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS, type PreloadApi } from '@shared/ipc'

/**
 * Ponte mínima e tipada entre o renderer (sem Node) e o processo principal.
 * Apenas canais da lista branca são aceitos; o main valida todos os payloads.
 */

const invokeChannels = new Set<string>(INVOKE_CHANNELS)
const sendChannels = new Set<string>(SEND_CHANNELS)
const eventChannels = new Set<string>(EVENT_CHANNELS)

const api: PreloadApi = {
  invoke: ((channel: string, payload?: unknown) => {
    if (!invokeChannels.has(channel)) return Promise.reject(new Error(`canal IPC não permitido: ${channel}`))
    return ipcRenderer.invoke(channel, payload)
  }) as PreloadApi['invoke'],
  send: (channel, payload) => {
    if (!sendChannels.has(channel)) return
    ipcRenderer.send(channel, payload)
  },
  on: (channel, listener) => {
    if (!eventChannels.has(channel)) return () => undefined
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      ;(listener as (p: unknown) => void)(payload)
    }
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('maestrinho', api)
