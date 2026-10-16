// Utilitários para os testes ponta a ponta (Playwright + Electron).
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const shotDir = path.resolve(process.env.SHOT_DIR || 'test-results')
fs.mkdirSync(shotDir, { recursive: true })

/** Cria pastas temporárias isoladas para userData e para o workspace. */
export function tempEnv(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `maestrinho-${name}-`))
  const userData = path.join(root, 'userData')
  const workspace = path.join(root, 'ws')
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(workspace, { recursive: true })
  return { root, userData, workspace }
}

/** Grava um config.json inicial apontando para o workspace (abre direto nele). */
export function seedConfig(userData, workspace, extra = {}) {
  // Sem "presets"/"roles": o app completa com os presets e papéis de fábrica.
  const cfg = {
    version: 1,
    settings: { lastWorkspace: workspace, recentWorkspaces: [workspace], notifyOnIdle: false, ...extra }
  }
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify(cfg, null, 2))
}

/** Grava um workspace.json inicial (nós e conexões) e notas opcionais. */
export function seedWorkspace(workspace, { nodes = [], edges = [], notes = {}, floors = [] } = {}) {
  const meta = path.join(workspace, '.maestrinho')
  fs.mkdirSync(path.join(meta, 'notes'), { recursive: true })
  const doc = { version: 1, id: 'ws-e2e', name: path.basename(workspace), nodes, edges, viewport: { x: 40, y: 40, zoom: 0.6 }, floors }
  fs.writeFileSync(path.join(meta, 'workspace.json'), JSON.stringify(doc, null, 2))
  for (const [file, content] of Object.entries(notes)) fs.writeFileSync(path.join(meta, 'notes', file), content)
}

export function terminalNode(id, name, presetId, x, y, extra = {}) {
  return { id, kind: 'terminal', name, presetId, cwd: '', autoStart: true, position: { x, y }, size: { w: 600, h: 420 }, ...extra }
}

export function noteNode(id, file, x, y) {
  return { id, kind: 'note', file, position: { x, y }, size: { w: 400, h: 320 } }
}

export function edge(id, source, target) {
  return { id, source, target }
}

export function gitInit(dir) {
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 'e2e@example.com')
  run('config', 'user.name', 'E2E')
  run('config', 'commit.gpgsign', 'false')
  fs.writeFileSync(path.join(dir, 'README.md'), '# projeto de teste\n')
  run('add', 'README.md')
  run('commit', '-q', '-m', 'inicial')
  return run
}

export async function launch(userData, extraEnv = {}) {
  // Sem roubar o foco de quem está usando o computador; MAESTRINHO_E2E_JANELA (opcional) escolhe a posição.
  const env = { ...process.env, NODE_ENV: 'production', MAESTRINHO_USER_DATA: userData, MAESTRINHO_E2E_SEM_FOCO: '1', ...extraEnv }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: electronPath, args: ['.'], env })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  return { app, win }
}

export function readWorkspace(workspace) {
  return JSON.parse(fs.readFileSync(path.join(workspace, '.maestrinho', 'workspace.json'), 'utf8'))
}

export async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

let failures = 0
export function check(cond, label) {
  console.log(`${cond ? 'OK  ' : 'FALHA'} ${label}`)
  if (!cond) {
    failures += 1
    process.exitCode = 1
  }
}
export function summary() {
  console.log(failures === 0 ? '\nTODOS OS CHECKS PASSARAM' : `\n${failures} CHECK(S) FALHARAM`)
}

/** Lê o texto limpo da tela de um terminal pelo IPC do app. */
export async function screen(win, id, lines = 200) {
  return win.evaluate(([tid, n]) => window.maestrinho.invoke('pty:readText', { id: tid, lines: n }), [id, lines])
}

/** Digita no terminal como o usuário (raw + Enter). */
export async function typeInto(win, id, text) {
  await win.evaluate(([tid, t]) => window.maestrinho.invoke('pty:sendMessage', { id: tid, text: t }), [id, text])
}

/** Espera até `predicate(texto da tela)` ser verdadeiro. */
export async function waitScreen(win, id, predicate, timeoutMs = 30000, label = '') {
  const start = Date.now()
  let last = ''
  while (Date.now() - start < timeoutMs) {
    last = await screen(win, id)
    if (predicate(last)) return last
    await sleep(500)
  }
  console.log(`(timeout esperando ${label || id}); última tela:\n${last.split('\n').slice(-25).join('\n')}`)
  return null
}

/** Espera todos os terminais indicados estarem em execução. */
export async function waitRunning(win, ids, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const infos = await win.evaluate(() => window.maestrinho.invoke('pty:infoAll'))
    const ok = ids.every((id) => infos.find((i) => i.id === id && i.status === 'running' && i.ready))
    if (ok) return true
    await sleep(500)
  }
  return false
}
