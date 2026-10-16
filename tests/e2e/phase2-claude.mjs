// Aceite da Fase 2 com agentes reais: dois Claude Code conectados ("construtor" e "revisor").
// O construtor é instruído a pedir revisão com `orq send revisor ... --wait` e recebe a resposta.
// Requer o Claude Code instalado e autenticado (consome poucos tokens).
import path from 'node:path'
import {
  check,
  edge,
  launch,
  screen,
  seedConfig,
  seedWorkspace,
  shotDir,
  sleep,
  summary,
  tempEnv,
  terminalNode,
  typeInto,
  waitRunning,
  waitScreen
} from './helpers.mjs'

const env = tempEnv('f2')
seedConfig(env.userData, env.workspace)
seedWorkspace(env.workspace, {
  nodes: [
    terminalNode('c1', 'construtor', 'claude', 0, 0, { roleId: 'construtor', size: { w: 760, h: 560 } }),
    terminalNode('c2', 'revisor', 'claude', 820, 0, { roleId: 'revisor', size: { w: 760, h: 560 } }),
    terminalNode('s1', 'isolado', 'shell', 0, 640)
  ],
  edges: [edge('e1', 'c1', 'c2')]
})

const { app, win } = await launch(env.userData)
win.on('pageerror', (e) => console.log('[pageerror]', e.message))
await win.waitForSelector('.react-flow__node-terminal', { timeout: 30000 })

/** Aceita o aviso "confiar nesta pasta" do Claude Code quando ele aparecer. */
async function acceptTrust(id) {
  const t = await waitScreen(win, id, (s) => /trust this folder|Yes, proceed|❯/i.test(s), 60000, `inicio ${id}`)
  if (t && /trust this folder/i.test(t)) {
    await win.evaluate((tid) => window.maestrinho.send('pty:write', { id: tid, data: '\x1b[B' }), id)
    await sleep(400)
    await win.evaluate((tid) => window.maestrinho.send('pty:write', { id: tid, data: '\r' }), id)
  }
}
await acceptTrust('c1')
await acceptTrust('c2')
check(await waitRunning(win, ['c1', 'c2'], 90000), 'dois Claude Code iniciados e prontos')
await sleep(4000)
await win.screenshot({ path: path.join(shotDir, 'fase2-inicio.png') })

// Negativo determinístico: terminal sem conexão não consegue enviar.
await typeInto(win, 's1', 'orq send construtor "oi"; echo "CODIGO=$LASTEXITCODE"')
check(Boolean(await waitScreen(win, 's1', (t) => /conex/i.test(t) && /CODIGO=3/.test(t), 30000, 'negativo')), 'envio para terminal não conectado falha com erro claro')

// Instrui o construtor.
await typeInto(
  win,
  'c1',
  'Peça revisão ao revisor usando exatamente o comando: orq send revisor "Revise esta função e diga se há bug: function soma(a, b) { return a - b }" --wait . Depois me diga, em uma frase, o veredito que o revisor deu.'
)

const reviewerGot = await waitScreen(win, 'c2', (t) => /Mensagem de "construtor"/.test(t), 180000, 'revisor recebe')
check(Boolean(reviewerGot), 'revisor recebeu a mensagem do construtor (via orq send)')
// O construtor só "terminou" quando ficou ocioso depois da tarefa e escreveu uma resposta própria
// (um novo "●" depois da saída do --wait) mencionando o problema apontado pelo revisor.
let builderDone = false
const t0 = Date.now()
while (Date.now() - t0 < 420000 && !builderDone) {
  await sleep(2000)
  const infos = await win.evaluate(() => window.maestrinho.invoke('pty:infoAll'))
  const c1 = infos.find((i) => i.id === 'c1')
  const text = await screen(win, 'c1', 200)
  const lastAfter = text.split('--wait').slice(-1)[0] ?? ''
  const answered = /●/.test(lastAfter) && /(bug|subtra|a \+ b|soma|deveria|errad)/i.test(lastAfter)
  builderDone = Boolean(c1 && c1.activity === 'idle' && c1.attentionSeq >= 1 && answered)
}
check(builderDone, 'construtor recebeu a resposta do revisor (--wait) e informou o veredito')
await sleep(3000)
await win.screenshot({ path: path.join(shotDir, 'fase2-conversa.png') })
console.log('\n--- tela do construtor (fim) ---\n' + (await screen(win, 'c1', 40)))
console.log('\n--- tela do revisor (fim) ---\n' + (await screen(win, 'c2', 30)))
await app.close()
summary()
