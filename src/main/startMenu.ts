import { app, shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { APP_NAME } from '@shared/constants'
import { appIdentity } from '@shared/appIdentity'
import { log } from './util/log'

/**
 * No Windows, as notificações (toasts) de um app não empacotado só aparecem se houver um atalho no
 * menu Iniciar com o mesmo AppUserModelID. Criamos (por usuário, sem admin) um atalho que abre o app:
 * no build empacotado aponta para o .exe; rodando do código-fonte, para o Electron com a pasta do projeto,
 * num atalho e com um id próprios ("Maestrinho (dev)"), para não mexer no do app instalado.
 */
export function ensureStartMenuShortcut(): void {
  if (process.platform !== 'win32') return
  try {
    const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    const identity = appIdentity(app.isPackaged)
    const link = path.join(programs, identity.shortcutName)
    const icon = path.join(app.getAppPath(), 'resources', 'icon.ico')
    const options: Electron.ShortcutDetails = {
      target: process.execPath,
      args: app.isPackaged ? '' : `"${app.getAppPath()}"`,
      cwd: app.isPackaged ? path.dirname(process.execPath) : app.getAppPath(),
      description: `${APP_NAME} — canvas local para orquestrar agentes de código`,
      appUserModelId: identity.id,
      icon: fs.existsSync(icon) ? icon : process.execPath,
      iconIndex: 0
    }
    if (fs.existsSync(link)) {
      const current = shell.readShortcutLink(link)
      if (current.target === options.target && current.args === options.args && current.appUserModelId === identity.id) return
      shell.writeShortcutLink(link, 'replace', options)
    } else {
      fs.mkdirSync(programs, { recursive: true })
      shell.writeShortcutLink(link, 'create', options)
    }
    log.info('atalho do menu Iniciar atualizado (necessário para notificações do Windows)')
  } catch (err) {
    log.warn('não foi possível criar o atalho do menu Iniciar', err instanceof Error ? err : undefined)
  }
}
