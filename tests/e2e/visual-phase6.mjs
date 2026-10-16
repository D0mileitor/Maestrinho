// Verificação visual da Fase 6 (portal, formas, tema claro, paleta). Gera screenshots em test-results/.
import http from 'node:http'
import path from 'node:path'
import { launch, seedConfig, seedWorkspace, shotDir, sleep, tempEnv, terminalNode } from './helpers.mjs'

const server = http.createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end('<html><body style="font-family:sans-serif;padding:24px"><h1>Servidor de teste</h1><p>Portal carregado.</p></body></html>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`

const env = tempEnv('vis6')
seedConfig(env.userData, env.workspace)
seedWorkspace(env.workspace, {
  nodes: [
    terminalNode('t1', 'construtor', 'shell', 0, 0, { roleId: 'construtor' }),
    { id: 'w1', kind: 'portal', url, position: { x: 660, y: 0 }, size: { w: 620, h: 420 } },
    { id: 's1', kind: 'shape', shape: 'rect', text: 'Fluxo principal', color: '', position: { x: 0, y: 480 }, size: { w: 300, h: 140 } },
    { id: 's2', kind: 'shape', shape: 'text', text: 'Anotação livre no canvas', color: '', position: { x: 340, y: 500 }, size: { w: 300, h: 60 } },
    { id: 's3', kind: 'shape', shape: 'arrow', text: '', color: '', position: { x: 660, y: 480 }, size: { w: 260, h: 140 }, points: [[10, 10], [250, 130]], strokeWidth: 2 },
    {
      id: 's4',
      kind: 'shape',
      shape: 'drawing',
      text: '',
      color: '#d4a849',
      position: { x: 960, y: 480 },
      size: { w: 300, h: 160 },
      points: [[10, 80], [60, 20], [120, 120], [180, 30], [240, 110], [290, 60]],
      strokeWidth: 3
    }
  ]
})

const { app, win } = await launch(env.userData)
await win.waitForSelector('.react-flow__node-portal', { timeout: 30000 })
await sleep(4000)
// A página precisa ocupar o portal inteiro (sem display flex no <webview>, ela ficava com 150 px de altura).
const portal = await win.evaluate(async () => {
  const wv = document.querySelector('.portal-webview')
  return { area: wv.offsetHeight, pagina: await wv.executeJavaScript('innerHeight') }
})
console.log('portal: altura da área', portal.area, '| altura vista pela página', portal.pagina)
if (Math.abs(portal.area - portal.pagina) > 2) {
  console.error('FALHA: a página do portal não ocupa a área inteira')
  process.exitCode = 1
}
await win.screenshot({ path: path.join(shotDir, 'fase6-escuro.png') })
await win.click('.tool-btn[aria-label="Alternar tema claro/escuro"]')
await sleep(1200)
await win.screenshot({ path: path.join(shotDir, 'fase6-claro.png') })
await win.click('.react-flow__pane', { position: { x: 900, y: 750 } })
await win.keyboard.press('Control+k')
await sleep(500)
await win.keyboard.type('constr')
await sleep(800)
await win.screenshot({ path: path.join(shotDir, 'fase6-paleta.png') })
await app.close()
server.close()
console.log('screenshots em', shotDir)
