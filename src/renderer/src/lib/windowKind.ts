/**
 * Em qual janela este renderer roda: a principal ou o chat destacado (aberto com `?janela=chat`, com o
 * workspace e a aba iniciais na URL).
 */
const params = new URLSearchParams(window.location.search)

export const IS_CHAT_WINDOW = params.get('janela') === 'chat'

/** Workspace e aba com que o chat destacado abriu. */
export const CHAT_WINDOW_START = { dir: params.get('dir') ?? '', tab: params.get('tab') ?? 'geral' }
