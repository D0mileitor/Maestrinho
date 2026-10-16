// Fumaça do build portátil: abre release/Maestrinho-win32-x64/Maestrinho.exe e usa o orq num shell.
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import { check, edge, noteNode, seedConfig, seedWorkspace, sleep, summary, tempEnv, terminalNode, typeInto, waitRunning, waitScreen } from './helpers.mjs'

const exe = path.resolve('release', `Maestrinho-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'Maestrinho.exe' : 'Maestrinho')
const env = tempEnv('pack')
seedConfig(env.userData, env.workspace)
seedWorkspace(env.workspace, {
  nodes: [terminalNode('sh1', 'operador', 'shell', 0, 0), noteNode('n1', 'spec.md', 0, 520)],
  edges: [edge('e1', 'sh1', 'n1')],
  notes: { 'spec.md': '# Spec do build portátil\n' }
})
const runEnv = { ...process.env, MAESTRINHO_USER_DATA: env.userData }
delete runEnv.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: exe, args: [], env: runEnv })
const win = await app.firstWindow()
await win.waitForSelector('.react-flow__node-terminal', { timeout: 30000 })
check(await waitRunning(win, ['sh1'], 45000), 'build portátil abre e inicia o terminal')
await typeInto(win, 'sh1', 'orq note read spec.md')
check(Boolean(await waitScreen(win, 'sh1', (t) => /Spec do build port/.test(t), 20000, 'orq no pacote')), 'orq funciona no build portátil (sem Node)')
await sleep(500)
await app.close()
summary()
