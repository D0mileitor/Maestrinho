// Tour visual pelos diálogos (gera screenshots em test-results/visual-*.png).
import path from 'node:path'
import { edge, gitInit, launch, noteNode, seedConfig, seedWorkspace, shotDir, sleep, tempEnv, terminalNode, waitRunning } from './helpers.mjs'

const env = tempEnv('visd')
gitInit(env.workspace)
seedConfig(env.userData, env.workspace)
seedWorkspace(env.workspace, {
  nodes: [terminalNode('t1', 'construtor', 'shell', 0, 0, { roleId: 'construtor' }), noteNode('n1', 'spec.md', 660, 0)],
  edges: [edge('e1', 't1', 'n1')],
  notes: { 'spec.md': '# Spec\n\n- [x] canvas\n- [ ] agentes\n\n| a | b |\n|---|---|\n| 1 | 2 |\n' }
})
const { app, win } = await launch(env.userData)
await win.waitForSelector('.react-flow__node-terminal', { timeout: 30000 })
await waitRunning(win, ['t1'], 40000)
await sleep(1000)

async function shot(name) {
  await sleep(600)
  await win.screenshot({ path: path.join(shotDir, `visual-${name}.png`) })
}
async function openTop(label, name) {
  await win.click(`.topbar-right button[aria-label="${label}"]`)
  await shot(name)
  await win.keyboard.press('Escape')
  await sleep(300)
}

await openTop('Presets de agentes', 'presets')
await openTop('Papéis', 'papeis')
await openTop('Rotinas', 'rotinas')
await openTop('Partituras', 'partituras')
await openTop('Configurações', 'config')

// Menu ⋯ do terminal e diálogo de edição
await win.click('.react-flow__node-terminal button[aria-label="Mais ações"]').catch(() => undefined)
await shot('menu-terminal')
await win.keyboard.press('Escape')
await win.click('.react-flow__node-terminal .node-header', { button: 'right', position: { x: 300, y: 12 } })
await shot('menu-contexto')
await win.keyboard.press('Escape')
await win.dblclick('.react-flow__node-terminal .node-header', { position: { x: 350, y: 12 } })
await shot('modo-foco')
await win.click('.lift-head button[aria-label="Voltar ao canvas"]').catch(() => undefined)
await sleep(500)
// Diálogo de nova nota e de floor
await win.click('.react-flow__pane', { button: 'right', position: { x: 600, y: 650 } })
await sleep(300)
await win.click('.ctx-item:has-text("Nova nota aqui")')
await shot('nova-nota')
await win.keyboard.press('Escape')
await win.click('.floor-tabs button[aria-label="Novo floor"]').catch(() => undefined)
await shot('novo-floor')
await win.keyboard.press('Escape')
await app.close()
console.log('screenshots em', shotDir)
