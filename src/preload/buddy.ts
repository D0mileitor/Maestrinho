import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { BuddyBridge, BuddyCall } from '@shared/buddy'

/**
 * Preload da janela do personagem: só os canais do aviso. Esta página não alcança nenhum outro canal
 * do app (terminais, arquivos, workspace).
 */
const bridge: BuddyBridge = {
  onCalls: (listener) => {
    const wrapped = (_e: IpcRendererEvent, calls: BuddyCall[]): void => listener(calls)
    ipcRenderer.on('buddy:calls', wrapped)
    return () => {
      ipcRenderer.removeListener('buddy:calls', wrapped)
    }
  },
  action: (a) => ipcRenderer.send('buddy:action', a),
  rects: (rects) => ipcRenderer.send('buddy:rects', { rects }),
  ready: () => ipcRenderer.send('buddy:ready'),
  idle: () => ipcRenderer.send('buddy:idle'),
  onWalk: (listener) => {
    const wrapped = (_e: IpcRendererEvent, call: BuddyCall): void => listener(call)
    ipcRenderer.on('buddy:walk', wrapped)
    return () => {
      ipcRenderer.removeListener('buddy:walk', wrapped)
    }
  },
  exited: (terminalId) => ipcRenderer.send('buddy:exited', { terminalId })
}

contextBridge.exposeInMainWorld('maestrinhoBuddy', bridge)
