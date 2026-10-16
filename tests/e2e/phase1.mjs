// Aceite da Fase 1: 4 terminais com agentes diferentes, reorganizar, fechar, reabrir e o layout volta igual.
import path from 'node:path'
import { check, launch, readWorkspace, seedConfig, shotDir, sleep, tempEnv } from './helpers.mjs'

const env = tempEnv('f1')
seedConfig(env.userData, env.workspace)

let { app, win } = await launch(env.userData)
await win.waitForSelector('.react-flow__pane', { timeout: 30000 })
await sleep(800)

// Afasta o zoom para caber os 4 terminais.
await win.click('.react-flow__pane', { position: { x: 600, y: 400 } })
await win.keyboard.press('Control+-')
await sleep(300)
await win.keyboard.press('Control+-')
await sleep(500)

const presets = ['Shell (PowerShell)', 'Claude Code', 'OpenCode', 'Codex']
const spots = [
  { x: 260, y: 160 },
  { x: 760, y: 160 },
  { x: 260, y: 560 },
  { x: 760, y: 560 }
]
for (let i = 0; i < presets.length; i++) {
  await win.dblclick('.react-flow__pane', { position: spots[i] })
  await win.waitForSelector('.preset-grid', { timeout: 5000 })
  await win.click(`.preset-card:has-text("${presets[i]}")`)
  await win.click('button:has-text("Criar terminal")')
  await sleep(700)
}
await sleep(4000)
const count = await win.locator('.react-flow__node-terminal').count()
check(count === 4, `4 terminais criados no canvas (encontrados: ${count})`)
await win.screenshot({ path: path.join(shotDir, 'fase1-criados.png') })

// Shell funcional dentro do nó.
const shellNode = win.locator('.react-flow__node-terminal').first()
await shellNode.locator('.xterm').click()
await win.keyboard.type('Write-Output ("NO-" + (20+22))\r')
await sleep(1500)
const shellText = await shellNode.locator('.xterm-rows').textContent()
check(/NO-42/.test(shellText ?? ''), 'shell responde dentro do nó do canvas')

// Reorganiza: arrasta o primeiro terminal pelo cabeçalho.
const header = shellNode.locator('.node-header')
const box = await header.boundingBox()
await win.mouse.move(box.x + 120, box.y + box.height / 2)
await win.mouse.down()
await win.mouse.move(box.x + 180, box.y + box.height / 2 + 60, { steps: 8 })
await win.mouse.move(box.x + 220, box.y + box.height / 2 + 90, { steps: 8 })
await win.mouse.up()
await sleep(1500)

const before = readWorkspace(env.workspace)
const layoutBefore = before.nodes
  .filter((n) => n.kind === 'terminal')
  .map((n) => ({ id: n.id, name: n.name, preset: n.presetId, x: n.position.x, y: n.position.y, w: n.size.w, h: n.size.h }))
console.log('layout salvo:', JSON.stringify(layoutBefore))
check(new Set(layoutBefore.map((n) => n.preset)).size === 4, 'os 4 terminais usam presets diferentes')

await app.close()
await sleep(1000)

// Reabre.
;({ app, win } = await launch(env.userData))
await win.waitForSelector('.react-flow__node-terminal', { timeout: 30000 })
await sleep(4000)
const after = await win.evaluate(async () => {
  const res = await window.maestrinho.invoke('workspace:active')
  return res.doc.nodes
    .filter((n) => n.kind === 'terminal')
    .map((n) => ({ id: n.id, name: n.name, preset: n.presetId, x: n.position.x, y: n.position.y, w: n.size.w, h: n.size.h }))
})
const domCount = await win.locator('.react-flow__node-terminal').count()
check(domCount === 4, `após reabrir, 4 terminais no canvas (encontrados: ${domCount})`)
check(JSON.stringify(after) === JSON.stringify(layoutBefore), 'layout idêntico após reabrir')
const infos = await win.evaluate(() => window.maestrinho.invoke('pty:infoAll'))
console.log('estados:', JSON.stringify(infos.map((i) => ({ id: i.id, status: i.status, error: i.error }))))
check(infos.filter((i) => i.status === 'running').length >= 2, 'terminais foram recriados (processos novos em execução)')
await win.screenshot({ path: path.join(shotDir, 'fase1-reaberto.png') })
await app.close()
console.log('workspace de teste:', env.workspace)
