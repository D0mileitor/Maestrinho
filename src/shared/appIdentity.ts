import { APP_NAME } from './constants'

/** AppUserModelID do app instalado (o instalador usa o mesmo em scripts/instalador.mjs). */
export const APP_USER_MODEL_ID = 'app.maestrinho.desktop'

/**
 * Identidade do app no Windows: o AppUserModelID (agrupa as janelas na barra de tarefas e liga as
 * notificações ao atalho) e o nome do atalho no menu Iniciar. O app instalado e o rodado do código-fonte
 * (npm start, testes) ficam separados: com a mesma identidade, um reescrevia o atalho do outro e a barra de
 * tarefas do app instalado mostrava o ícone do Electron.
 */
export function appIdentity(packaged: boolean): { id: string; shortcutName: string } {
  return packaged
    ? { id: APP_USER_MODEL_ID, shortcutName: `${APP_NAME}.lnk` }
    : { id: `${APP_USER_MODEL_ID}.dev`, shortcutName: `${APP_NAME} (dev).lnk` }
}
