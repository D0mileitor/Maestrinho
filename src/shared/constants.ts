/**
 * Constantes de identidade do produto. Renomear o app ou o CLI = alterar apenas este arquivo
 * (e os shims em resources/bin, que são gerados a partir de CLI_NAME — ver main/cli/shims.ts).
 */
export const APP_NAME = 'Maestrinho'
export const APP_ID = 'maestrinho'
export const CLI_NAME = 'orq'
/** Prefixo das variáveis de ambiente injetadas nos terminais. */
export const ENV_PREFIX = 'ORQ'
/** Pasta de metadados dentro do diretório do workspace (projeto do usuário). */
export const WORKSPACE_META_DIR = '.maestrinho'
/** Onde saem as versões novas (o app não procura sozinho: o link fica em Configurações → Sobre). */
export const RELEASES_URL = 'https://github.com/D0mileitor/maestrinho/releases'

export const ENV = {
  port: `${ENV_PREFIX}_PORT`,
  token: `${ENV_PREFIX}_TOKEN`,
  /**
   * Cópia do token com nome sem "TOKEN": alguns agentes (ex.: sandbox do Codex) removem do
   * ambiente variáveis cujo nome contém KEY/SECRET/TOKEN.
   */
  session: `${ENV_PREFIX}_SESSION`,
  terminalId: `${ENV_PREFIX}_TERMINAL_ID`,
  terminalName: `${ENV_PREFIX}_TERMINAL_NAME`,
  workspaceDir: `${ENV_PREFIX}_WORKSPACE_DIR`,
  /** Executável usado pelos shims para rodar o CLI (o próprio Electron em modo Node). */
  node: `${ENV_PREFIX}_NODE`,
  /** Caminho do script JS do CLI. */
  cli: `${ENV_PREFIX}_CLI`
} as const

export const WORKSPACE_FILE = 'workspace.json'
export const NOTES_DIR = 'notes'
export const PARTITURAS_DIR = 'partituras'
export const ROUTINES_FILE = 'routines.json'
export const BACKUPS_DIR = 'backups'
export const MAX_BACKUPS = 20
export const CONFIG_FILE = 'config.json'

/** Marcadores usados para anexar/remover a seção do app em AGENTS.md sem tocar no conteúdo do usuário. */
export const AGENTS_MD_BEGIN = `<!-- ${APP_ID}:begin — seção gerada automaticamente pelo ${APP_NAME}; será removida ao fechar o terminal -->`
export const AGENTS_MD_END = `<!-- ${APP_ID}:end -->`

/** Limites de segurança da API local. */
export const API_MAX_BODY_BYTES = 2 * 1024 * 1024
export const API_LONG_POLL_MS = 25_000

export const DEFAULT_SCROLLBACK = 10_000
export const DEFAULT_COLS = 100
export const DEFAULT_ROWS = 30
